const {knex} = require("../mysql");
const {aplicarFiltroPesquisa} = require("../functions/aplicarFiltroPesquisa");
const {aplicarPaginacao} = require("../functions/aplicarPaginacao");
const moment = require("moment");
require("moment/locale/pt");
const XLSX = require('xlsx');
const gerarExcel = require("../functions/gerarExcel");
const {obterCartaoAtualizarDados} = require("./cartao");
const CryptoJS = require("crypto-js");
const {detalhesSite, obterPatamar, obterPatamarLimiar, obterPatamares} = require("./negocio");
const {atualizarComissoesArvore, desativarComissoesOutrosUtilizadores} = require("../functions/arvores");
const {obterUtilizador} = require("../functions/obterUtilizador");
const {TIPO_UTILIZADOR} = require("../conf/consts");
const excel = require("exceljs");
const DocumentoExcel = require("../misc/documento_excel");

moment.locale("pt");

module.exports.importarReport = async (req, ficheiro) => {
    let site = await detalhesSite(req.db, req.session.user_site);

    let mes = await this.obterMes(req.db, req.body.mes);
    if (mes.data_fechado)
        throw {code: 400, message: "Mês já foi fechado"};

    let inicio_mes = moment(mes.data_inicio);
    let fim_mes = moment(mes.data_fim);

    if (ficheiro.mimetype !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        throw {code: 400, message: "O ficheiro deve ser do tipo Excel/XLSX"};

    // Criar importação na base de dados
    let {insertId} = await req.db.knex(knex("importacao_bd").insert({
        site: req.session.user_site,
        data_inicio: knex.fn.now(),
        ficheiro: ficheiro.name,
        mes: mes.id
    }));

    let id_importacao = insertId;

    let filename = `${moment().format("YYYYMMDD")}_import_${id_importacao}.xlsx`;
    let path = `data/reports/${filename}`;

    await new Promise((resolve, reject) => {
        ficheiro.mv(path, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });

    // Atualizar importação na base de dados
    req.db.knex(knex("importacao_bd").where({id: id_importacao}).update({
        ficheiro: filename
    }));

    let report = '';
    let ignorados = 0;
    let importados = 0;
    let duplicados = 0;
    let ids_movimentos = {};

    function logReport(type, content) {
        if (typeof content !== 'string')
            content = JSON.stringify(content);
        report += `${type.toUpperCase()} [${new Date().toISOString()}]: ${content}\n`;
    }

    logReport('info', `Iniciando importação do ficheiro ${filename}...`);
    let workbook = await XLSX.readFile(path);
    let data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    logReport('info', `${data.length} movimentos lidos. Iniciando processamento...`);
    await data.asyncForEach(async (produto) => {
        ['Data Recarga', 'Sim', 'Msisdn Activação', 'Valor Recarga', 'Contract Date With Optimus'].forEach((key) => {
            if (produto[key] === undefined)
                throw {code: 400, message: `Foi detetada uma coluna em falta no ficheiro: ${key}`};
        });
        let data_movimento = new Date(Math.round((produto['Data Recarga'] - 25569) * 86400 * 1000));
        let data_ativacao = new Date(Math.round((produto['Contract Date With Optimus'] - 25569) * 86400 * 1000));
        if (inicio_mes.isAfter(data_movimento, "day") || fim_mes.isBefore(data_movimento, "day")) {
            logReport('info', `Movimento ignorado, pois pertence a outro mês (data: ${data_movimento}`);
            ignorados++;
            return;
        }
        let numero_sim = produto['Sim'];
        let numero_telemovel = produto['Msisdn Activação'].startsWith("351") ? produto['Msisdn Activação'].substring(3) : produto['Msisdn Activação'];
        let cartao;
        try {
            cartao = await obterCartaoAtualizarDados(req.db, numero_sim, numero_telemovel, data_ativacao);
        } catch (e) {
            if (e.code === 404) {
                let {insertId} = await req.db.knex(knex("cartao").insert({
                    sim: numero_sim,
                    site: site.id,
                    vendedor: (await req.db.knexOne(knex("cartao")
                        .where("site", site.id)
                        .where("num_telemovel", "936362323")))?.utilizador
                }));
                cartao = {
                    id: insertId,
                    data_ativacao: new Date()
                }

                logReport('info', `Novo cartão criado e associado ao número Youbiz (numero_sim: ${numero_sim}, numero_telemovel: ${numero_telemovel})`);
                return;
            } else if (e.code === 500) {
                logReport('info', e.message);
                ignorados++;
                return;
            } else
                throw e;
        }
        let valor = produto['Valor Recarga'];

        let id_movimento = CryptoJS.MD5(`${data_movimento.toISOString()}_${numero_sim}_${numero_telemovel}_${valor}`).toString();
        if (!ids_movimentos[id_movimento])
            ids_movimentos[id_movimento] = 0;
        ids_movimentos[id_movimento]++;
        if (ids_movimentos[id_movimento] > 1)
            id_movimento += `_${ids_movimentos[id_movimento]}`;

        // Criar movimento
        try {
            await req.db.knex(knex("movimento_cartao").insert({
                site: site.id,
                importacao: id_importacao,
                mes: mes.id,
                cartao: cartao.id,
                valor: valor,
                valor_sem_iva: valor / (1 + site.taxa_iva_relatorio / 100),
                data_movimento: moment(data_movimento).format("YYYY-MM-DD"),
                id_movimento: id_movimento,
                cartao_expirado: moment(cartao.data_ativacao).add(site.meses_alvo_comissionamento, "month").isBefore(data_movimento) ? 1 : 0
            }));
        } catch (e) {
            if (e.errno === 1062) {
                logReport('info', `Movimento duplicado (numero_sim: ${numero_sim}, numero_telemovel: ${numero_telemovel}, data_movimento: ${data_movimento}, valor: ${valor})`);
                duplicados++;
                return;
            }
            throw  e;
        }

        importados++;
    });
    logReport('info', `Importação finalizada. ${importados} movimentos importados. ${ignorados} ignorados. ${duplicados} duplicados.`);

    await req.db.knex(knex("importacao_bd").where({id: id_importacao}).update({
        relatorio: report,
        resultado: JSON.stringify({
            ignorados,
            importados,
            duplicados
        }),
        data_finalizado: knex.fn.now()
    }));

    await this.verificarMudancasPatamar(req, mes);

    await this.atualizarMes(req, mes);

    return {
        report,
        ignorados,
        importados,
        duplicados
    };
}

module.exports.obterDataUltimoMovimento = async (req) => {
    let ultimo_movimento = await req.db.knexOne(knex("movimento_cartao")
        .select("data_movimento")
        .where("site", req.session.user_site)
        .orderBy("data_movimento", "desc")
        .limit(1));
    return ultimo_movimento.data_movimento;
}

module.exports.obterComissoes = async (req, id_mes, opcoes = {}) => {
    let meses;
    if (id_mes)
        meses = [(await this.obterMes(req.db, id_mes)).id];
    else
        meses = (await this.listarMeses(req.db, {ano: opcoes.ano, mes: opcoes.mes, desativar_paginacao: true})).map(m => m.id)

    let site = await detalhesSite(req.db, req.session.user_site);
    let query = knex("equipa_utilizador")
        .select(knex.raw("sum(equipa_utilizador.percent_comissao * movimento_cartao.valor_sem_iva) as comissao"))
        .join("movimento_cartao", "equipa_utilizador.cartao", "movimento_cartao.cartao")
        .where("movimento_cartao.site", site.id)
        .whereIn("movimento_cartao.mes", meses)
        .where("movimento_cartao.cartao_expirado", 0)
        .where("equipa_utilizador.desativar_comissao", 0)

    let single = true;

    if (opcoes.utilizador)
        query.where("equipa_utilizador.utilizador", opcoes.utilizador)
            .groupBy("equipa_utilizador.utilizador");

    if (opcoes.obterNiveis) {
        query.select("equipa_utilizador.nivel", "equipa_utilizador.percent_comissao")
            .groupBy("equipa_utilizador.nivel");
        single = false;
    }

    if (opcoes.obterContagens) {
        query.select(knex.raw("count(*) as contagem"))
    }

    if (opcoes.obterUtilizadores) {
        query.select("equipa_utilizador.utilizador")
            .groupBy("equipa_utilizador.utilizador");
        single = false;
    }

    if (single) {
        if (opcoes.obterContagens)
            return await req.db.knexOne(query);
        return (await req.db.knexOne(query))?.comissao || 0;
    }
    return await req.db.knex(query);
};

/*** PAGAMENTOS ***/

module.exports.listarPagamentos = async (db, opcoes = {}) => {
    let query = knex("pagamento")
        .select("pagamento.*", "mes.designacao as mes_designacao", "mes.data_inicio as mes_inicio", "utilizador.nome as utilizador_nome", "utilizador.id as utilizador_id", "utilizador.numero_colaborador", "patamar.designacao as patamar_designacao")
        .join("utilizador", "pagamento.utilizador", "=", "utilizador.id")
        .join("mes", "pagamento.mes", "=", "mes.id")
        .leftJoin("patamar", "patamar.id", "pagamento.patamar")
        .orderBy("pagamento.mes", "desc")
        .orderBy("pagamento.id", "desc")
        .whereRaw(db.filtro_acesso);

    if (opcoes.ano) {
        query.whereRaw("YEAR(mes.data_inicio) = ?", opcoes.ano);
        if (opcoes.mes)
            query.whereRaw("MONTH(mes.data_inicio) = ?", opcoes.mes);
    }

    if (opcoes.utilizador)
        query.where("utilizador", opcoes.utilizador);

    if (opcoes.estado)
        query.whereIn("pagamento.estado", opcoes.estado.split(","));

    if (opcoes.site)
        query.where("pagamento.site", opcoes.site);

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["utilizador.nome", "telemovel", "mes.designacao", "utilizador.numero_colaborador"], opcoes.filtro, query);

    if (opcoes.exportar_excel) {
        let resultados = await db.knex(query);

        if (opcoes.preencher_ate_mes) {
            let data_inicio = moment(resultados[0].mes_inicio + "-01-01");
            let data_fim = moment(opcoes.preencher_ate_mes.data_inicio).endOf("month");

            let patamar = {id: 1, designacao: "Colaborador"};

            // Preencher meses não existentes até ao atual
            while (!data_inicio.isAfter(data_fim, "month")) {
                let pagamento = resultados.find(p => moment(p.mes_inicio).isSame(data_inicio, "month"));
                if (pagamento) {
                    patamar = {
                        id: pagamento.patamar,
                        designacao: pagamento.patamar_designacao,
                    };
                } else {
                    resultados.push({
                        mes_designacao: opcoes.preencher_ate_mes.designacao,
                        valor_comissao: 0,
                        valor_a_pagar: 0,
                        estado: "vazio"
                    });
                }
                data_inicio.add(1, "month");
            }

            resultados.sort((a, b) => moment(b.mes_inicio).diff(moment(a.mes_inicio)));
        }

        return gerarExcel("pagamentos", resultados);
    }

    if (opcoes.desativar_paginacao === true)
        return db.knex(query);
    return aplicarPaginacao(db, query, opcoes);
}

module.exports.obterPagamento = async (db, id_pagamento) => {
    let pagamento = await db.knexOne(knex("pagamento").where({id: id_pagamento}));
    if (!pagamento)
        throw {code: 404, message: "Pagamento não encontrado"};
    return pagamento;
}

module.exports.marcarPagamento = async (db, id_pagamento, novo_estado) => {
    let pagamento = await this.obterPagamento(db, id_pagamento);
    let estados_pagamento = ['vazio', 'em_aberto', 'aguarda_recibo', 'pendente', 'pago'];
    if (estados_pagamento.indexOf(pagamento.estado) >= estados_pagamento.indexOf(novo_estado) && !(pagamento.estado === 'pendente' && novo_estado === "aguarda_recibo"))
        throw {code: 400, message: "O pagamento não pode ser alterado para este estado"};

    let dados_novos = {estado: novo_estado};

    if (novo_estado === 'pago')
        dados_novos.data_pagamento = knex.fn.now();
    if (novo_estado === 'aguarda_recibo')
        dados_novos.data_fechado = knex.fn.now();

    await db.knex(knex("pagamento").where({id: pagamento.id}).update(dados_novos));
}

/*** MESES ***/

module.exports.listarMeses = async (db, opcoes = {}) => {
    let query = knex("mes")
        .select("mes.*",
            knex.raw("(SELECT data_finalizado FROM importacao_bd WHERE mes = mes.id ORDER BY data_finalizado DESC LIMIT 1) as ultima_importacao"),
            knex.raw("(SELECT sum(valor_premio) FROM pagamento WHERE mes = mes.id) as premios"),
            knex.raw("(SELECT sum(valor_despesas_administrativas) FROM pagamento WHERE valor_a_pagar > 0 AND mes = mes.id) as da"),
            knex.raw("(SELECT sum(valor_custos_operacionais) FROM pagamento WHERE valor_a_pagar > 0 AND mes = mes.id) as co"),
            knex.raw("(SELECT sum(valor_a_pagar) FROM pagamento WHERE mes = mes.id) as total_a_pagar")
        )
        .orderBy("data_inicio", "desc")
        .whereRaw(db.filtro_acesso);

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["designacao"], opcoes.filtro, query);

    if (opcoes.ano) {
        query.whereRaw("YEAR(data_inicio) = ?", opcoes.ano);
        if (opcoes.mes)
            query.whereRaw("MONTH(data_inicio) = ?", opcoes.mes);
    }

    if (opcoes.exportar_excel)
        return gerarExcel("meses", await db.knex(query));

    if (opcoes.desativar_paginacao === true)
        return db.knex(query);

    return aplicarPaginacao(db, query, opcoes);
}

module.exports.obterMes = async (db, id_mes) => {
    let mes = await db.knexOne(knex("mes")
        .select("*",
            knex.raw("(SELECT data_finalizado FROM importacao_bd WHERE mes = mes.id ORDER BY data_finalizado DESC LIMIT 1) as ultima_importacao"),
            knex.raw("(SELECT sum(valor_premio) FROM pagamento WHERE mes = mes.id) as premios"),
            knex.raw("(SELECT sum(valor_despesas_administrativas) FROM pagamento WHERE valor_a_pagar > 0 AND mes = mes.id) as da"),
            knex.raw("(SELECT sum(valor_custos_operacionais) FROM pagamento WHERE valor_a_pagar > 0 AND mes = mes.id) as co"),
            knex.raw("(SELECT sum(valor_a_pagar) FROM pagamento WHERE mes = mes.id) as total_a_pagar"),
        )
        .where({id: id_mes}));
    if (!mes)
        throw {code: 404, message: "Mês não encontrado"};
    return mes;
}

module.exports.obterMesFechado = async (db, site) => {
    let mes = await db.knexOne(knex("mes").where("site", site).whereNotNull("data_fechado").orderBy("id", "desc").limit(1));
    if (!mes)
        throw {code: 404, message: "Mês não encontrado"};
    return this.obterMes(db, mes.id);
}

module.exports.obterMesAberto = async (db, site) => {
    let mes = await db.knexOne(knex("mes")
        .where("site", site).whereNull("data_fechado").orderBy("id", "desc").limit(1));
    if (!mes)
        throw {code: 404, message: "Mês não encontrado"};
    return this.obterMes(db, mes.id);
}

module.exports.fecharMes = async (req, id_mes) => {
    let mes = await this.obterMes(req.db, id_mes);

    if (mes.data_fechado)
        throw {code: 400, message: "Mês já foi fechado"};

    await req.db.knex(knex("mes").where({id: id_mes}).update({
        data_fechado: knex.fn.now()
    }));

    let novo_mes = moment(mes.data_inicio).add(1, "month").startOf("month");

    await req.db.knex(knex("mes").insert({
        designacao: novo_mes.format("MMM YYYY"),
        data_inicio: novo_mes.toDate(),
        data_fim: novo_mes.clone().endOf("month").toDate(),
        site: mes.site
    }));

    await this.gerarPagamentos(req, mes.id);
}

module.exports.atualizarMes = async (req, mes) => {
    let comissoes = await this.obterComissoes(req, mes.id);

    // Somatório de valor de carregamento sem iva para cartões ativados até um ano antes do fim do mês
    let total_carregamentos_fornecedor = await req.db.knexOne(knex("movimento_cartao")
        .join("cartao", "cartao.id", "movimento_cartao.cartao")
        .where("movimento_cartao.mes", mes.id)
        .andWhereRaw("DATE_ADD(cartao.data_ativacao, INTERVAL 1 YEAR) >= ?", mes.data_inicio)
        .sum("valor_sem_iva as total_carregamento"));

    await req.db.knex(knex("mes").where({id: mes.id}).update({
        comissoes,
        fornecedor: total_carregamentos_fornecedor.total_carregamento * 0.3
    }));
}

module.exports.gerarPagamentos = async (req, id_mes) => {
    let site = await detalhesSite(req.db, req.session.user_site);
    let comissoes = await this.obterComissoes(req, id_mes, {obterUtilizadores: true, obterContagens: true, obterNiveis: true});

    let comissoes_utilizadores = {};
    for (let comissao of comissoes) {
        if (!comissoes_utilizadores[comissao.utilizador])
            comissoes_utilizadores[comissao.utilizador] = [];
        comissoes_utilizadores[comissao.utilizador].push(comissao);
    }

    for (let utilizador in comissoes_utilizadores) {
        utilizador = await obterUtilizador(req.db, utilizador);
        if (utilizador.data_desativado)
            continue;

        let comissoes_utilizador = comissoes_utilizadores[utilizador.id];
        comissoes_utilizador.sort((a, b) => a.nivel - b.nivel);

        let comissao_total = comissoes_utilizador.map(c => c.comissao).reduce((a, b) => a + b, 0);

        let comissoes_contabilizadas = [];
        let contagem_carregamentos = [];
        let valores_comissao = [];

        new Array(Math.max(3, comissoes_utilizador[comissoes_utilizador.length - 1].nivel)).fill(0).forEach((v, i) => {
            let nivel_comissao = comissoes_utilizador.find(c => c.nivel === i + 1);
            comissoes_contabilizadas.push(nivel_comissao?.percent_comissao * 100 || utilizador.comissoes[i] || 0);
            contagem_carregamentos.push(nivel_comissao?.contagem || 0);
            valores_comissao.push(nivel_comissao?.comissao || 0);
        });

        // Criar pagamento
        let {insertId} = await req.db.knex(knex("pagamento").insert({
            site: req.session.user_site,
            utilizador: utilizador.id,
            mes: id_mes,
            nif: utilizador.nif || 0,
            patamar: utilizador.patamar.id,
            comissoes_contabilizadas: comissoes_contabilizadas.join(","),
            contagens_carregamentos: contagem_carregamentos.join(","),
            valores_comissao: valores_comissao.join(","),
            valor_comissao: comissao_total,
            valor_premio: utilizador.premio_mensal || 0,
            valor_despesas_administrativas: utilizador.despesas_administrativas_mensais ?? site.base_despesas_administracao,
            valor_custos_operacionais: 0,
            percentagem_impostos: 0,
            percentagem_retencao: 0,
            estado: "aguarda_recibo"
        }));

        await this.atualizarPagamento(req, insertId);
    }

    // Criar pagamentos para utilizadores ativos sem comissões nesse mês
    // Por questões de eficiência não deverão haver registos desnecessários
    return;
    await req.db.knex(knex.into(knex.raw(`pagamento (
            site,
            utilizador,
            mes,
            nif,
            patamar,
            comissoes_contabilizadas,
            contagens_carregamentos,
            valores_comissao,
            valor_comissao,
            valor_premio,
            valor_despesas_administrativas,
            valor_custos_operacionais,
            percentagem_impostos,
            percentagem_retencao,
            estado
        )`))
        .insert(builder => {
            builder
                .select(knex.raw(`
                    ${req.session.user_site} as site,
                    id as utilizador,
                    ${id_mes} as mes,
                    coalesce(nif, '') as nif,
                    patamar,
                    '' as comissoes_contabilizadas,
                    '' as contagens_carregamentos,
                    '' as valores_comissao,
                    0 as valor_comissao,
                    0 as valor_premio,
                    ${site.base_despesas_administracao} as valor_despesas_administrativas,
                    0 as valor_custos_operacionais,
                    0 as percentagem_impostos,
                    0 as percentagem_retencao,
                    'vazio' as estado
                `))
                .from('utilizador')
                .where("site", req.session.user_site)
                .where("tipo", TIPO_UTILIZADOR.COLABORADOR)
                .whereNull("data_desativado")
                .whereNotIn("id", knex.raw("(select utilizador from pagamento where mes = ?)", [id_mes]))
        }));
}

module.exports.atualizarPagamento = async (req, id_pagamento) => {
    let {
        id,
        valor_comissao,
        valor_premio,
        valor_despesas_administrativas,
        valor_custos_operacionais,
        percentagem_impostos,
        percentagem_retencao,
        estado
    } = await req.db.knexOne(knex("pagamento").where("id", id_pagamento));

    let rendimento = valor_comissao + valor_premio - valor_despesas_administrativas - valor_custos_operacionais;
    if (rendimento < 0)
        rendimento = 0;
    let valor_impostos = rendimento * percentagem_impostos / 100;
    let valor_retencao = rendimento * percentagem_retencao / 100;
    let valor_a_pagar = rendimento + valor_impostos - valor_retencao;

    if (valor_a_pagar === 0 && estado === 'em_aberto')
        estado = 'vazio';

    await req.db.knex(knex("pagamento").where({id}).update({
        valor_impostos,
        valor_retencao,
        valor_a_pagar,
        estado
    }));
}

module.exports.atualizarPatamarUtilizador = async (req, id_utilizador, novo_patamar) => {
    await req.db.knex(knex("utilizador").where({id: id_utilizador}).update({
        patamar: novo_patamar.id
    }));

    if (novo_patamar.ultimo) {
        // Ùltimo patamar atingido, outros utilizadores deixam de receber comissões sobre a sua equipa
        await desativarComissoesOutrosUtilizadores(req.db, id_utilizador);
    }

    await atualizarComissoesArvore(req, id_utilizador);
}

module.exports.verificarMudancasPatamar = async (req, mes, atualizar_meses = false) => {
    // Obter número de movimentos da equipa de cada utilizador no mês e patamar atual de cada utilizador
    let movimentos_utilizadores = await req.db.knex(
        knex(knex.raw("(SELECT utilizador, count(*) as numero_movimentos FROM movimento_cartao " +
            "JOIN equipa_utilizador ON equipa_utilizador.cartao = movimento_cartao.cartao " +
            "WHERE movimento_cartao.mes = ? AND cartao_expirado = 0 group by utilizador) " +
            "as movimentos_mes_utilizador", mes.id))
            .select("utilizador.id as utilizador", "utilizador.patamar", "numero_movimentos")
            .join("utilizador", "movimentos_mes_utilizador.utilizador", "utilizador.id"));

    // Obter patamares. Patamares com limiares mais altos deverão estar primeiro
    let patamares = await obterPatamares(req.db, req.session.user_site);
    patamares.sort((a, b) => b.limiar_atribuicao - a.limiar_atribuicao);

    for (let movimentos_utilizador of movimentos_utilizadores) {
        let patamar_limiar = patamares.find(p => p.limiar_atribuicao <= movimentos_utilizador.numero_movimentos);
        if (patamar_limiar.id !== movimentos_utilizador.patamar) {
            // Verificar mudanças de patamar
            let utilizador = await obterUtilizador(req.db, movimentos_utilizador.utilizador);
            if (utilizador.data_desativado)
                continue;
            if (patamar_limiar.limiar_atribuicao > utilizador.patamar.limiar_atribuicao) {
                // Utilizador atingiu novo patamar
                await this.atualizarPatamarUtilizador(req, utilizador.id, patamar_limiar);
            }
        }
    }
}

module.exports.relatorioConfrontacao = async (req) => {
    let ano_inicio = await req.db.knexOne(knex("pagamento").min("data_criacao as data"));
    ano_inicio = moment(ano_inicio.data).year();
    let ano_fim = await req.db.knexOne(knex("pagamento").max("data_criacao as data"));
    ano_fim = moment(ano_fim.data).year();
    const workbook = new excel.Workbook();

    for (let ano = ano_fim; ano >= ano_inicio; ano--) {
        const worksheet = workbook.addWorksheet("" + ano);
        worksheet.columns = [
            {header: "Colaborador", key: "numero_colaborador", width: 11},
            {header: "Mês", key: "mes", width: 10},
            {header: "Total ganho", key: "valor_a_pagar", style: {numFmt: '#,##0.00 €'}, width: 14},
            {header: "Total recebido", key: "valor_recebido", style: {numFmt: '#,##0.00 €'}, width: 14},
            {header: "Diferença", key: "diferenca", style: {numFmt: '#,##0.00 €'}, width: 14},
            {header: "Data recebimento", key: "data_pagamento", width: 15}
        ]
        let pagamentos_ano = await this.listarPagamentos(req.db, {
            site: req.session.user_site,
            estado: ['aguarda_recibo', 'pendente', 'pago'].join(),
            ano: ano,
            desativar_paginacao: true
        });
        let soma_a_pagar = 0;
        let soma_recebido = 0;
        let soma_diferenca = 0;
        pagamentos_ano.forEach(pagamento => {
            let valor_recebido = pagamento.estado === 'pago' ? pagamento.valor_a_pagar : 0;
            if (pagamento.valor_a_pagar === 0)
                return;
            worksheet.addRow({
                numero_colaborador: pagamento.numero_colaborador,
                mes: moment(pagamento.mes_inicio).format("MMM YYYY"),
                valor_a_pagar: pagamento.valor_a_pagar,
                valor_recebido: valor_recebido,
                diferenca: pagamento.valor_a_pagar - valor_recebido,
                data_pagamento: pagamento.data_pagamento
            });
            soma_a_pagar += pagamento.valor_a_pagar;
            soma_recebido += valor_recebido;
            soma_diferenca += pagamento.valor_a_pagar - valor_recebido;
        })
        worksheet.addRow({
            numero_colaborador: "Total",
            valor_a_pagar: soma_a_pagar,
            valor_recebido: soma_recebido,
            diferenca: soma_diferenca
        });
    }

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    return new DocumentoExcel(`relatorio_confrontacoes_${new Date().toISOString().slice(0, -5).replace(/\D/g, "")}.xlsx`, xlsxBuffer);
}