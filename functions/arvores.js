const {knex} = require("../mysql");
const {obterPatamares} = require("../models/negocio");
const {obterUtilizador} = require("./obterUtilizador");

module.exports.aumentarArvores = async (db, vendedor, cartoes) => {
    let utilizador = await obterUtilizador(db, vendedor);
    if (!utilizador.cartao_associado)
        throw {code: 400, message: "O vendedor não tem cartão associado."};

    // Adicionar à árvore do utilizador
    console.log("AUMENTAR_ARVORE", utilizador.id, utilizador.comissoes);
    await db.knex(knex("equipa_utilizador").insert(cartoes.map(c => ({
        cartao: c,
        utilizador: utilizador.id,
        nivel: 1,
        percent_comissao: utilizador.comissoes[0] / 100
    }))));

    let desativar_comissoes_outras_arvores = utilizador.patamar.ultimo;

    // Obter árvores onde o utilizador está incluido e adicionar cartões a essas árvores
    let arvores = await db.knex(knex("equipa_utilizador").where("cartao", utilizador.cartao_associado.id));
    await arvores.asyncForEach(async ({utilizador, nivel}) => {
        let novo_nivel = nivel + 1;
        // Não adicionar quarto nível
        if (novo_nivel > 3)
            return;
        utilizador = await obterUtilizador(db, utilizador);
        await db.knex(knex("equipa_utilizador").insert(cartoes.map(c => ({
            cartao: c,
            utilizador: utilizador.id,
            nivel: novo_nivel,
            percent_comissao: (utilizador.comissoes[novo_nivel - 1] || 0) / 100,
            desativar_comissao: desativar_comissoes_outras_arvores
        }))));
    });
}

module.exports.recalcularArvoreUtilizador = async (req, id_utilizador) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);
    let comissoes = utilizador.comissoes;

    // Obter patamares. Patamares com limiares mais altos deverão estar primeiro
    let patamares = await obterPatamares(req.db, req.session.user_site);
    let patamar_maximo = patamares.find(p => p.ultimo);

    async function buildUserTree(root_user_id, current_user = null, level = 1, desativar_comissao = false) {
        if (!current_user)
            current_user = root_user_id;

        let comissao = (comissoes[level - 1] || 0) / 100;

        let cartoes = await req.db.knex(knex("cartao")
            .select("cartao.*", "utilizador.patamar")
            .leftJoin("utilizador", "cartao.utilizador", "utilizador.id")
            .where("vendedor", current_user)
            .where("cartao.site", req.session.user_site)
            .whereRaw("(select count(*) = 0 from equipa_utilizador where equipa_utilizador.utilizador = ? AND cartao.id = equipa_utilizador.cartao)", [root_user_id]));

        // Limite de níveis
        if (level > 127)
            return;

        // Otimização: calcular apenas até ao terceiro nível a menos que o utilizador tenha mais comissões configuradas
        if (level > Math.max(3, comissoes.length))
            return;

        if (cartoes.length > 0) {
            await req.db.knex(knex("equipa_utilizador").insert(cartoes.map(c => ({
                utilizador: root_user_id,
                cartao: c.id,
                nivel: level,
                percent_comissao: comissao,
                desativar_comissao: desativar_comissao ? 1 : 0
            }))));
            for (let c = 0; c < cartoes.length; c++) {
                if (cartoes[c].utilizador)
                    await buildUserTree(root_user_id, cartoes[c].utilizador, level + 1, (desativar_comissao || cartoes[c].patamar === patamar_maximo.id));
            }
        }
    }

    await req.db.knex(knex("equipa_utilizador").where({
        utilizador: utilizador.id
    }).del());

    await buildUserTree(utilizador.id);
};

module.exports.estatisticasArvoreUtilizador = async (req, id_utilizador) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);

    return await req.db.knex(knex("equipa_utilizador")
        .select("nivel", knex.raw("count(*) as contagem"))
        .join("cartao", "cartao.id", "equipa_utilizador.cartao")
        .where("equipa_utilizador.utilizador", utilizador.id)
        .whereNotNull("cartao.data_ativacao")
        .groupBy("nivel"));
};

module.exports.atualizarComissoesArvore = async (req, id_utilizador) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);
    let comissoes = utilizador.comissoes;

    await comissoes.asyncForEach(async (c, idx) => {
        await req.db.knex(knex("equipa_utilizador")
            .where("equipa_utilizador.utilizador", id_utilizador)
            .where("equipa_utilizador.nivel", idx + 1)
            .update({percent_comissao: c / 100}));
    });

    // Restantes comissões devem ser zero
    await req.db.knex(knex("equipa_utilizador")
        .where("equipa_utilizador.utilizador", id_utilizador)
        .where("equipa_utilizador.nivel", ">", comissoes.length)
        .update({percent_comissao: 0}));
};

module.exports.desativarComissoesOutrosUtilizadores = async (db, id_utilizador) => {
    // Marca comissões de outros utilizadores como desativadas, se o nível hierarquico do membro da equipa do outro
    // utilizador for menor que o nível hierarquico do membro da equipa do utilizador
    await db.knex(
        knex("equipa_utilizador as equipa_outros_utilizadores")
            .join("equipa_utilizador", "equipa_utilizador.cartao", "equipa_outros_utilizadores.cartao")
            .where("equipa_utilizador.utilizador", id_utilizador)
            .whereNot("equipa_outros_utilizadores.utilizador", knex.raw("equipa_utilizador.utilizador"))
            .where("equipa_outros_utilizadores.nivel", ">", knex.raw("equipa_utilizador.nivel"))
            .update({"equipa_outros_utilizadores.desativar_comissao": 1})
    )

};