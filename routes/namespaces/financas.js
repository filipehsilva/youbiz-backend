const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const routeWrapper = require("../../misc/route_wrapper");
const {validarPermissao} = require("../../functions/permissoes");
const {gerarToken, listarUtilizadores, aceitarColaborador} = require("../../models/utilizador");
const {body} = require("express-validator");
const {obterUtilizadorToken} = require("../../models/utilizador");
const {knex} = require("../../mysql");
const {listarCartoes, detalhesCartao, listarPedidosCartoes, criarPedidoCartoes, expedirPedidoCartoes, imprimirMoradasPedidosCartoes, listarProdutos, criarProduto, editarProduto, apagarProduto} = require("../../models/cartao");
const {paramsPaginacao} = require("../../functions/aplicarPaginacao");
const {importarReport, listarPagamentos, marcarPagamento, obterPagamento, listarMeses, fecharMes, obterMes, atualizarPagamento, obterMesFechado, relatorioConfrontacao} = require("../../models/financas");

/**
 * @api {post} /financas/importar_report Importar relatório
 * @apiName Importar relatório
 * @apiGroup Finanças
 * @apiDescription Importa um relatório de carregamentos de cartão e cria movimentos.
 * @apiBody {File} relatorio Arquivo XLSX
 * @apiBody {Number} mes Id do Mês
 */
router.post('/importar_report', validarPermissao("financas.importar_report"),
    routeWrapper(async (req) => {
        if (!req.files?.relatorio)
            throw {code: 400, message: "Não foi fornecido um ficheiro de relatório"};
        return await importarReport(req, req.files.relatorio);
    }));

/**
 * @api {get} /financas/pagamentos/listar Listar pagamentos
 * @apiName Listar pagamentos
 * @apiGroup Finanças
 * @apiDescription Lista pagamentos aos colaboradores. Possibilidade de filtrar por estado e de procurar por texto
 * @apiBody {String} [estado] Estado do pagamento
 * @apiQuery {String} [pesquisa] Texto a pesquisar
 */
router.get('/pagamentos/listar', validarPermissao("pagamento.ler"),
    routeWrapper(async (req) => {
        return await listarPagamentos(req.db, {
            utilizador: req.query.utilizador,
            estado: req.query.estado,
            filtro: req.query.pesquisa,
            preencher_ate_mes: typeof req.query.exportar_excel !== 'undefined' ? await obterMesFechado(req.db, req.session.user_site) : null,
            exportar_excel: typeof req.query.exportar_excel !== 'undefined',
            ano: req.query.ano,
            ...paramsPaginacao(req)
        });
    }));

/**
 * @api {get} /financas/pagamentos/:id/editar Editar pagamento
 * @apiName Editar pagamento
 * @apiGroup Finanças
 * @apiDescription Edita informações de um pagamento
 * @apiParam {Number} id ID do pagamento
 * @apiBody {Number} [custos_operacionais] Custos operacionais
 * @apiBody {Number} [custos_administrativos] Custos administrativos
 * @apiBody {Number} [premios] Prémios
 */
router.post('/pagamentos/:id/editar', validarPermissao("pagamento.editar", "params.id"),
    [
        body('valor_custos_operacionais').isFloat({min: 0}).withMessage("Custos operacionais são obrigatórios"),
        body('valor_despesas_administrativas').isFloat({min: 0}).withMessage("Custos administrativos são obrigatórios"),
        body('valor_premio').isFloat({min: 0}).withMessage("Indique o valor dos prémios")
    ],
    routeWrapper(async (req) => {
        let pagamento = await obterPagamento(req.db, req.params.id);

        if (pagamento.estado !== "em_aberto")
            throw {code: 400, message: "Pagamento já não está no estado EM ABERTO"};

        await req.db.knex(knex('pagamento').where('id', req.params.id).update({
            valor_custos_operacionais: req.body.valor_custos_operacionais,
            valor_despesas_administrativas: req.body.valor_despesas_administrativas,
            valor_premio: req.body.valor_premio
        }));

        await atualizarPagamento(req, pagamento.id);
    }));

/**
 * @api {post} /financas/pagamentos/:id/:acao Marcar estado de pagamento
 * @apiName Marcar estado de pagamento
 * @apiGroup Finanças
 * @apiDescription Modifica o estado de um pagamento
 * @apiParam {Number} id ID do pagamento
 * @apiParam {String} acao Estado do pagamento
 */
router.post('/pagamentos/:id/:acao', validarPermissao("pagamento.marcar", "params.id"),
    routeWrapper(async (req) => {
        let novo_estado = req.params.acao.replace("marcar_", "");
        return await marcarPagamento(req.db, req.params.id, novo_estado);
    }));

/**
 * @api {get} /financas/meses/listar Listar meses
 * @apiName Listar meses
 * @apiGroup Finanças
 * @apiDescription Lista todos os meses de comissões. Possibilidade de procurar por texto
 * @apiQuery {String} [pesquisa] Texto a pesquisar
 * @apiQuery {Number} [ano] Filtrar meses por ano
 */
router.get('/meses/listar', validarPermissao("financas.ler_meses"),
    routeWrapper(async (req) => {
        return await listarMeses(req.db, {
            filtro: req.query.pesquisa,
            ano: req.query.ano,
            exportar_excel: typeof req.query.exportar_excel !== 'undefined',
            ...paramsPaginacao(req)
        });
    }))

/**
 * @api {get} /financas/meses/:id/detalhes Detalhes do mês
 * @apiName Detalhes do mês
 * @apiGroup Finanças
 * @apiDescription Detalhes do mês de comissões
 * @apiParam {Number} id ID do mês
 */
router.get('/meses/:id/detalhes', validarPermissao("financas.ler_meses", "params.id"),
    routeWrapper(async (req) => {
        return await obterMes(req.db, req.params.id);
    }));

/**
 * @api {post} /financas/meses/:id/fechar Fechar mês
 * @apiName Fechar mês
 * @apiGroup Finanças
 * @apiDescription Fecha o mês de comissões
 * @apiParam {Number} id ID do mês
 */
router.post('/meses/:id/fechar', validarPermissao("financas.fechar_mes", "params.id"),
    routeWrapper(async (req) => {
        return await fecharMes(req, req.params.id);
    }));

/**
 * @api {get} /financas/relatorios/confrontacao Relatório de confrontação de créditos acumulados vs valores pagos
 * @apiName Relatório de confrontação de créditos acumulados vs valores pagos
 * @apiGroup Finanças
 * @apiDescription Gerar relatório de confrontação de créditos acumulados vs valores pagos
 */
router.get('/relatorios/confrontacao', validarPermissao("financas.relatorio_confrontacao"),
    routeWrapper(async (req) => {
        return relatorioConfrontacao(req);
    }));

module.exports = router;