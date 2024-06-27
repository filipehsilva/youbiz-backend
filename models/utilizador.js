const {knex} = require("../mysql");
const crypto = require("crypto");
const {aplicarFiltroPesquisa} = require("../functions/aplicarFiltroPesquisa");
const {TIPO_UTILIZADOR} = require("../conf/consts");
const {aplicarPaginacao} = require("../functions/aplicarPaginacao");
const gerarExcel = require("../functions/gerarExcel");
const {detalhesSite, obterPatamar, obterPatamarLimiar} = require("./negocio");
const {aumentarArvores, atualizarComissoesArvore} = require("../functions/arvores");
const {obterUtilizador} = require("../functions/obterUtilizador");
const bcrypt = require("bcrypt");

module.exports.obterUtilizadorToken = async (db, Token) => {
    let query = knex("utilizador")
        .select("id", "nome", "email")
        .where("token_acesso", Token);

    let utilizador = await db.knexOne(query);

    if (!utilizador)
        throw {message: "Utilizador não encontrado", code: 404};

    return utilizador;
};

module.exports.gerarToken = async (db) => {
    let token = null;

    for (let i = 0; i < 10; i++) {
        let aux = crypto.randomBytes(64).toString('hex').toUpperCase();
        try {
            await this.obterUtilizadorToken(db, aux);
        } catch (e) {
            token = aux;
            break;
        }
    }

    if (!token)
        throw {code: 500, message: "Não foi possível gerar um token único para o utilizador. Tente novamente."};
    return token;
};

module.exports.listarUtilizadores = async (db, opcoes = {}) => {
    let query = knex("utilizador")
        .select(
            "id",
            "numero_colaborador",
            "site",
            "email",
            "nome",
            "telemovel",
            "tipo",
            "patamar",
            "data_criacao",
            "nif",
            "notificacao_sms",
            "notificacao_email",
            "marketing",
            "data_desativado",
        )
        .orderBy(knex.raw("nome = ''"), "desc")
        .orderBy("nome")
        .whereRaw(db.filtro_acesso);

    if (opcoes.tipo) {
        query.where("tipo", opcoes.tipo);
        if (opcoes.tipo === TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
            query.select("telemovel_ascendente", "morada", "localidade", "codigo_postal", "data_aprovacao")
                .clearOrder()
                .orderBy("data_criacao", "desc");
    }

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["nome", "email", "numero_colaborador", "nif"], opcoes.filtro, query);

    if (opcoes.exportar_excel)
        return gerarExcel("utilizadores", await db.knex(query));

    if (opcoes.desativar_paginacao === true)
        return db.knex(query);

    return aplicarPaginacao(db, query, opcoes);
}

module.exports.aceitarColaborador = async (db, id, dados) => {
    let utilizador = await obterUtilizador(db, id);

    if (utilizador.tipo !== TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
        throw {code: 400, message: "Apenas registos pendentes podem ser convertidos em colaboradores"};

    await db.knex(knex("utilizador")
        .where("id", id)
        .update({
            tipo: TIPO_UTILIZADOR.COLABORADOR,
            data_aprovacao: knex.fn.now(),
            patamar: (await obterPatamarLimiar(db, utilizador.site, 0)).id
        }));

    await this.atualizarUtilizador(db, id, dados);

    if (!dados.numero_telemovel_youbiz)
        dados.numero_telemovel_youbiz = dados.telemovel;

    // Criar ou associar cartão a utilizador a partir do número de telemóvel
    let cartao = await db.knexOne(knex("cartao")
        .where("site", utilizador.site)
        .where("num_telemovel", dados.numero_telemovel_youbiz));
    if (cartao) {
        if (cartao.utilizador && cartao.utilizador !== utilizador.id)
            throw {code: 400, message: "O número de cartão youbiz não é válido, pois já está associado a outro utilizador."};
        await db.knex(knex("cartao")
            .where("id", cartao.id)
            .where("site", utilizador.site)
            .update({utilizador: utilizador.id}));
    } else {
        let cartao_ascendente = dados.numero_ascendente ? await db.knexOne(knex("cartao")
            .select("cartao.*")
            .where("cartao.site", utilizador.site)
            .join("utilizador", "utilizador.id", "cartao.utilizador")
            .where("utilizador.tipo", TIPO_UTILIZADOR.COLABORADOR)
            .whereNull("utilizador.data_desativado")
            .where("cartao.num_telemovel", dados.numero_ascendente)) : null;

        // Cartão do ascendente é o cartão do youbiz por defeito
        if (!cartao_ascendente)
            cartao_ascendente = await db.knexOne(knex("cartao")
                .where("site", utilizador.site)
                .where("num_telemovel", "936362323"));

        let {insertId} = await db.knex(knex("cartao").insert({
            site: utilizador.site,
            sim: "novo_" + dados.numero_telemovel_youbiz,
            num_telemovel: dados.numero_telemovel_youbiz,
            utilizador: utilizador.id,
            vendedor: cartao_ascendente?.utilizador,
            data_ativacao: knex.fn.now()
        }));

        if (cartao_ascendente)
            await aumentarArvores(db, cartao_ascendente.utilizador, [insertId]);
    }
}

module.exports.atualizarUtilizador = async (db, id, dados) => {
    let utilizador = await obterUtilizador(db, id);

    let atualizar = {};

    Object.keys(dados).forEach(key => {
        if (["email", "nome", "telemovel", "data_nascimento", "morada", "codigo_postal", "localidade", "doc_identificacao_tipo", "doc_identificacao_numero", "doc_identificacao_emissao", "doc_identificacao_validade", "doc_identificacao_local_emissao", "nif", "iban"].includes(key))
            atualizar[key] = dados[key];
    });

    if (utilizador.email.trim() !== dados.email.trim()) {
        let existe = await db.knexOne(knex("utilizador").where("email", dados.email));
        if (existe)
            throw {code: 400, message: "O e-mail indicado já está a ser utilizado por outro utilizador."};
    }

    if (dados.comissoes_personalizadas !== undefined) {
        atualizar.comissoes = dados.comissoes_personalizadas ? dados.comissoes.join(",") : null;
    }
    if (dados.patamar) {
        let novo_patamar = await obterPatamar(db, utilizador.site, dados.patamar);
        /*if (novo_patamar.limiar_atribuicao < utilizador.patamar.limiar_atribuicao)
            throw {code: 400, message: "O patamar do colaborador não pode ser reduzido"};*/
        atualizar.patamar = novo_patamar.id;
    }

    if (dados.despesas_administrativas_mensais !== undefined)
        atualizar.despesas_administrativas_mensais = isNaN(parseFloat(dados.despesas_administrativas_mensais)) ? null : parseFloat(dados.despesas_administrativas_mensais);
    if (dados.premio_mensal !== undefined)
        atualizar.premio_mensal = isNaN(parseFloat(dados.premio_mensal)) ? null : parseFloat(dados.premio_mensal);

    if (dados.notificacao_sms !== undefined)
        atualizar.notificacao_sms = dados.notificacao_sms ? (utilizador.notificacao_sms || knex.fn.now()) : null;
    if (dados.notificacao_email !== undefined)
        atualizar.notificacao_email = dados.notificacao_email ? (utilizador.notificacao_email || knex.fn.now()) : null;
    if (dados.marketing !== undefined)
        atualizar.marketing = dados.marketing ? (utilizador.marketing || knex.fn.now()) : null;
    if (dados.ativo !== undefined)
        atualizar.data_desativado = dados.ativo ? null : (utilizador.data_desativado || knex.fn.now());

    if (dados.password_nova && dados.password_atual) {
        let password = await db.knexOne(knex("utilizador").select("password").where("id", id));
        if (!await bcrypt.compare(dados.password_atual, password.password))
            throw {code: 400, message: "A password atual não é válida"};
        atualizar.password = await bcrypt.hash(dados.password_nova, 12);
    }

    await db.knex(knex("utilizador").where("id", id).update(atualizar));

    if (utilizador.patamar.id !== atualizar.patamar || atualizar.comissoes && !utilizador.comissoes_personalizadas || atualizar.comissoes !== utilizador.comissoes.join(","))
        await atualizarComissoesArvore({db}, utilizador.id);
}

module.exports.eliminarUtilizador = async (db, id) => {
    let utilizador = await obterUtilizador(db, id);

    if (utilizador.tipo !== TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
        throw {code: 400, message: "Apenas é possível eliminar pedidos pendentes."};

    await db.knex(knex("utilizador")
        .where("id", id)
        .where('tipo', TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
        .delete());
}