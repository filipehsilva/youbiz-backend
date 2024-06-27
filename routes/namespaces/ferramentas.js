const express = require('express');
const router = express.Router();
const routeWrapper = require("../../misc/route_wrapper");
const {validarPermissao} = require("../../functions/permissoes");
const {listarUtilizadores, atualizarUtilizador} = require("../../models/utilizador");
const {paramsPaginacao} = require("../../functions/aplicarPaginacao");
const {listarMeses, verificarMudancasPatamar, listarPagamentos, obterComissoes, atualizarPagamento, obterMes, atualizarMes} = require("../../models/financas");
const {knex} = require("../../mysql");
const {obterPatamarLimiar, detalhesSite} = require("../../models/negocio");
const {recalcularArvoreUtilizador, estatisticasArvoreUtilizador} = require("../../functions/arvores");
const {obterUtilizador} = require("../../functions/obterUtilizador");

router.get('/reconstruir_arvores', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    if (!req.query.utilizador)
        throw {code: 400, message: "Falta o parâmetro 'utilizador'"};

    let utilizadores;
    if (req.query.utilizador === "TODOS")
        utilizadores = await listarUtilizadores(req.db, {
            tipo: "colaborador",
            desativar_paginacao: true
        });
    else {
        utilizadores = [await obterUtilizador(req.db, req.query.utilizador)];
    }

    let count = 0;
    for (let utilizador of utilizadores) {
        await recalcularArvoreUtilizador(req, utilizador.id);
        count++;
        if (count % 100 === 0)
            console.log(count, "DONE");
        await req.db.commit();
        await req.db.startTransaction();
    }
}));

router.get('/comparar_arvores', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    if (!req.query.utilizador)
        throw {code: 400, message: "Falta o parâmetro 'utilizador'"};

    let utilizadores;
    if (req.query.utilizador === "TODOS")
        utilizadores = await listarUtilizadores(req.db, {
            tipo: "colaborador",
            desativar_paginacao: true
        });
    else {
        utilizadores = [await obterUtilizador(req.db, req.query.utilizador)];
    }

    let count = 0;
    let resultado = [];
    for (let utilizador of utilizadores) {
        let estatisticas_originais = await estatisticasArvoreUtilizador(req, utilizador.id);
        await recalcularArvoreUtilizador(req, utilizador.id);
        let estatisticas_novas = await estatisticasArvoreUtilizador(req, utilizador.id);
        resultado.push({
            utilizador: utilizador.id,
            estatisticas_originais,
            estatisticas_novas,
            diferente: JSON.stringify(estatisticas_originais) !== JSON.stringify(estatisticas_novas)
        })
        count++;
        if (count % 100 === 0)
            console.log(count, "DONE");
        await req.db.rollback();
        await req.db.startTransaction();
    }

    console.log(JSON.stringify(resultado));
    return resultado;
}));

router.get('/atribuir_patamares', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    return;
    let meses = await listarMeses(req.db, {
        desativar_paginacao: true
    });
    meses.sort((a, b) => a.id - b.id);

    let count = 0;
    for (let mes of meses) {
        await verificarMudancasPatamar(req, mes);
        count++;
        if (count % 10 === 0)
            console.log(count, "DONE");
        await req.db.commit();
        await req.db.startTransaction();
    }
}));

router.get('/atribuir_patamares_pagamentos', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    let pagamentos = await listarPagamentos(req.db, {
        desativar_paginacao: true,
        utilizador: 0
    });
    pagamentos.sort((a, b) => a.mes - b.mes);

    for (let pagamento of pagamentos) {
        if (pagamento.patamar)
            continue;
        let comissoes = await obterComissoes(req, pagamento.mes, {
            utilizador: pagamento.utilizador,
            obterContagens: true
        });

        let patamar = await obterPatamarLimiar(req.db, req.session.user_site, comissoes?.contagem || 0);
        await req.db.knex(knex("pagamento")
            .where("id", pagamento.id)
            .update({
                patamar: knex.raw("(SELECT greatest(coalesce(max(patamar),0),?) FROM pagamento WHERE utilizador = ? AND site = ? AND mes < ?)", [patamar.id, pagamento.utilizador, pagamento.site, pagamento.mes])
            })
        );

        await req.db.commit();
        await req.db.startTransaction();
    }
}));

router.get('/atribuir_patamares_especificos', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    let users = [
        {id: 0, patamar: 3},
    ];

    for (let user of users) {
        await atualizarUtilizador(req.db, user.id, {patamar: user.patamar});
    }
}));

router.get('/recalcular_pagamentos', validarPermissao("ferramentas.admin"), routeWrapper(async (req) => {
    let users = [
        {id: 0, meses: [0]}
    ];

    let site = await detalhesSite(req.db, req.session.user_site);

    for (let user of users) {
        for (let mes of user.meses) {
            let comissoes = await obterComissoes(req, mes, {utilizador: user.id, obterContagens: true, obterNiveis: true});
            if (comissoes.length === 0)
                continue;

            let utilizador = await obterUtilizador(req.db, user.id);
            if (utilizador.data_desativado)
                continue;

            let comissoes_utilizador = [...comissoes];
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

            let pagamento_atual = await req.db.knexOne(knex("pagamento")
                .where({utilizador: user.id, mes: mes, acerto: 0})
                .whereNot("estado", "anulado"));

            console.log("Pagamento atual: ", pagamento_atual);
            console.log("Novos valores: ", comissao_total, comissoes_contabilizadas, contagem_carregamentos, valores_comissao);

            let acerto = pagamento_atual.estado === 'pago';

            if (acerto || pagamento_atual.valor_comissao !== comissao_total || pagamento_atual.comissoes_contabilizadas !== comissoes_contabilizadas.join(",") || pagamento_atual.contagens_carregamentos !== contagem_carregamentos.join(",") || pagamento_atual.valores_comissao !== valores_comissao.join(",")) {
                console.log("Updating Payment for user: ", user.id, " and month: ", mes);

                // Anular pagamento anterior ou acerto anterior
                if (acerto) {
                    await req.db.knex(knex("pagamento")
                        .where({utilizador: user.id, mes: mes, acerto: 1})
                        .whereNot("estado", "pago")
                        .update({estado: "anulado"}));
                } else {
                    await req.db.knex(knex("pagamento")
                        .where({utilizador: user.id, mes: mes})
                        .update({estado: "anulado"}));
                }

                // Criar pagamento
                let {insertId} = await req.db.knex(knex("pagamento").insert({
                    site: site.id,
                    utilizador: utilizador.id,
                    mes: mes,
                    nif: pagamento_atual.nif,
                    patamar: pagamento_atual.patamar,
                    comissoes_contabilizadas: comissoes_contabilizadas.join(","),
                    contagens_carregamentos: contagem_carregamentos.join(","),
                    valores_comissao: valores_comissao.join(","),
                    valor_comissao: comissao_total,
                    valor_premio: acerto ? 0 : pagamento_atual.valor_premio,
                    valor_despesas_administrativas: acerto ? 0 : pagamento_atual.valor_despesas_administrativas,
                    valor_custos_operacionais: acerto ? pagamento_atual.valor_comissao : 0,
                    percentagem_impostos: 0,
                    percentagem_retencao: 0,
                    estado: "aguarda_recibo",
                    acerto: acerto ? 1 : 0
                }));

                await atualizarPagamento(req, insertId);
            } else {
                console.log("No changes for user: ", user.id, " and month: ", mes);
            }
        }
    }
}));

router.get('/preencher_valor_fornecedor', routeWrapper(async (req) => {
    for (let id_mes of []) {
        let mes = await obterMes(req.db, id_mes);
        await atualizarMes(req, mes);
    }
}))

module.exports = router;