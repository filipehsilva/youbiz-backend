const {knex} = require("../mysql");
const crypto = require("crypto");
const {aplicarFiltroPesquisa} = require("../functions/aplicarFiltroPesquisa");
const {TIPO_UTILIZADOR} = require("../conf/consts");
const {aplicarPaginacao, paramsPaginacao} = require("../functions/aplicarPaginacao");
const gerarExcel = require("../functions/gerarExcel");
const {detalhesSite} = require("./negocio");
const {obterMesFechado, obterComissoes, obterDataUltimoMovimento, obterMesAberto, listarPagamentos} = require("./financas");
const {estatisticasCartoesUtilizador, estatisticasMovimentosUtilizador, totalCarregadoEquipa} = require("./cartao");
const {estatisticasArvoreUtilizador} = require("../functions/arvores");
const {obterUtilizador} = require("../functions/obterUtilizador");
const moment = require("moment");

module.exports.obterBase = async (req, id) => {
    let utilizador = await obterUtilizador(req.db, id, req.session.user_type === TIPO_UTILIZADOR.ADMIN);

    utilizador.ultima_atualizacao = await obterDataUltimoMovimento(req);

    let mes_fechado = await obterMesFechado(req.db, req.session.user_site);
    utilizador.mes_fechado = {
        mes: {data: mes_fechado.data_inicio},
        pagamento: await req.db.knexOne(knex("pagamento").where({
            utilizador: utilizador.id,
            mes: mes_fechado.id
        }))
    };

    let mes_aberto = await obterMesAberto(req.db, req.session.user_site);
    utilizador.mes_aberto = {
        mes: {data: mes_aberto.data_inicio},
        pagamento: await obterComissoes(req, mes_aberto.id, {
            utilizador: utilizador.id,
        })
    };

    utilizador.valor_pagamento_pendente = (await req.db.knexOne(
        knex("pagamento")
            .sum("valor_a_pagar as valor")
            .where({utilizador: utilizador.id, site: utilizador.site})
            .whereIn("estado", ["pendente", "aguarda_recibo"])
    )).valor || 0;

    return utilizador;
}

module.exports.obterEstatisticas = async (req, id_utilizador, opcoes = {}) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);
    let site = await detalhesSite(req.db, utilizador.site);

    req.db.filtro_acesso = "1";

    let inicio = moment(utilizador.data_criacao).startOf("month");
    let fim = moment();

    if (req.query.ano) {
        if (req.query.mes) {
            inicio = moment().set({year: req.query.ano, month: req.query.mes - 1}).startOf("month");
            fim = moment(inicio).endOf("month");
        } else {
            inicio = moment(req.query.ano + "-01-01");
            fim = moment(req.query.ano + "-12-31");
        }
    }

    if (fim.isAfter(moment())) fim = moment();

    let pagamentos_periodo = await listarPagamentos(req.db, {
        site: utilizador.site,
        utilizador: utilizador.id,
        estado: ['vazio', 'em_aberto', 'aguarda_recibo', 'pendente', 'pago'].join(),
        ano: req.query.ano,
        mes: req.query.mes,
        desativar_paginacao: true
    });

    let comissoes_meses = [];
    while (inicio.isBefore(fim)) {
        let pagamento_mes = pagamentos_periodo.find(p => inicio.isSame(p.mes_inicio, "month"));
        let comissao_mes = {
            mes: inicio.format("YYYY-MM-DD"),
            valor_comissao: pagamento_mes ? pagamento_mes.valor_comissao : null,
            valores_comissao: pagamento_mes ? pagamento_mes.valores_comissao?.split(",").map(Number) : null,
            contagens_carregamentos: pagamento_mes ? pagamento_mes.contagens_carregamentos?.split(",").map(Number) : null,
            comissoes_contabilizadas: pagamento_mes ? pagamento_mes.comissoes_contabilizadas?.split(",").map(Number) : null,
            despesas: pagamento_mes ? pagamento_mes.valor_despesas_administrativas + pagamento_mes.valor_custos_operacionais : site.base_despesas_administracao,
            valor_premio: pagamento_mes ? pagamento_mes.valor_premio : 0,
        };

        let total_valores_comissao = comissao_mes.valores_comissao?.reduce((a, b) => a + b, 0) || 0;
        // Caso não exista pagamento para mês, ou a informação sobre as comissões por nível
        // não coincidir com o total de comissões, calcular comissões estimadas
        if (!pagamento_mes || Math.round(total_valores_comissao) !== Math.round(pagamento_mes.valor_comissao)) {
            let comissoes_mes = await obterComissoes(req, null, {
                utilizador: utilizador.id,
                obterNiveis: true,
                obterContagens: true,
                ano: inicio.year(),
                mes: inicio.month() + 1
            });
            comissao_mes.valores_comissao = new Array(3).fill(0).map((_, i) => {
                return comissoes_mes.find(c => c.nivel === i + 1)?.comissao || 0;
            });
            comissao_mes.contagens_carregamentos = new Array(3).fill(0).map((_, i) => {
                return comissoes_mes.find(c => c.nivel === i + 1)?.contagem || 0;
            });
            comissao_mes.valor_comissao = comissao_mes.valores_comissao.reduce((a, b) => a + b, 0);
            if (comissao_mes.valor_comissao > 0) comissao_mes.estimado = true;
        }

        comissao_mes.valor_a_receber = Math.max(0, comissao_mes.valor_comissao + comissao_mes.valor_premio - comissao_mes.despesas);
        comissao_mes.despesas_efetivas = Math.min(comissao_mes.despesas, comissao_mes.valor_comissao);

        comissoes_meses.push(comissao_mes);
        inicio.add(1, "month");
    }

    let ret = {
        comissoes: {
            comissoes_totais: comissoes_meses.reduce((a, b) => a + b.valor_comissao, 0),
            premios_totais: comissoes_meses.reduce((a, b) => a + b.valor_premio, 0),
            despesas_efetivas: Math.max(4, comissoes_meses.reduce((a, b) => a + (b.despesas_efetivas || 0), 0)),
            valor_a_receber: comissoes_meses.reduce((a, b) => a + (b.valor_a_receber || 0), 0),
            niveis: new Array(3).fill(0).map((_, i) => {
                return {
                    nivel: i + 1,
                    comissao: comissoes_meses.reduce((a, b) => {
                        return a + (b.valores_comissao[i] || 0)
                    }, 0),
                    contagem: comissoes_meses.reduce((a, b) => {
                        return a + (b.contagens_carregamentos[i] || 0)
                    }, 0),
                };
            }),
            estimado: !!comissoes_meses.find(c => c.estimado),
        },
        cartoes: await estatisticasCartoesUtilizador(req, utilizador.id, {
            ano: opcoes.ano,
            mes: opcoes.mes
        }),
    };

    if (opcoes.total_carregado)
        ret.total_carregado = await totalCarregadoEquipa(req, utilizador.id, {
            ano: opcoes.ano,
            mes: opcoes.mes
        });

    return ret;
}

module.exports.obterEquipa = async (req, id) => {
    let utilizador = await obterUtilizador(req.db, id);
    return await estatisticasArvoreUtilizador(req, utilizador.id);
}