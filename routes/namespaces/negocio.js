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
const {importarReport, listarPagamentos, marcarPagamento, obterPagamento, listarMeses, fecharMes, obterMes} = require("../../models/financas");
const {detalhesSite, editarSite} = require("../../models/negocio");
const {obterDashboard} = require("../../models/dashboard");

/**
 * @api {get} /negocio/links_uteis/listar Listar links úteis
 * @apiName Listar links úteis
 * @apiGroup Negocio
 * @apiDescription Lista os links úteis configurados
 */
router.get('/links_uteis/listar', validarPermissao("link_util.ler"),
    routeWrapper(async (req) => {
        return await req.db.knex(knex("link_util").whereRaw(req.db.filtro_acesso));
    }));

/**
 * @api {post} /negocio/links_uteis/criar Criar link útil
 * @apiName Criar link útil
 * @apiGroup Negocio
 * @apiDescription Cria um link útil
 * @apiBody {String} titulo Título do link
 * @apiBody {String} url URL do link
 * @apiBody {Boolean} visivel Visível no site?
 */
router.post('/links_uteis/criar', validarPermissao("link_util.criar"),
    [
        body("titulo").isString().withMessage("O título é obrigatório"),
        body("url").isString().withMessage("A URL é obrigatória"),
        body("visivel").isBoolean().withMessage("Indique se o link deverá ser visível")
    ],
    routeWrapper(async (req) => {
        let {titulo, url, visivel} = req.body;
        return req.db.knex(knex("link_util")
            .insert({titulo, url, visivel, site: req.session.user_site}));
    }));

/**
 * @api {post} /negocio/links_uteis/:id/editar Editar link útil
 * @apiName Editar link útil
 * @apiGroup Negocio
 * @apiDescription Edita um link útil
 * @apiParam {Number} id ID do link
 * @apiBody {String} titulo Título do link
 * @apiBody {String} url URL do link
 * @apiBody {Boolean} visivel Visível no site?
 */
router.post('/links_uteis/:id/editar', validarPermissao("link_util.editar", "params.id"),
    [
        body("titulo").isString().withMessage("O título é obrigatório"),
        body("url").isString().withMessage("A URL é obrigatória"),
        body("visivel").isBoolean().withMessage("Indique se o link deverá ser visível")
    ],
    routeWrapper(async (req) => {
        let {titulo, url, visivel} = req.body;

        let link = await req.db.knexOne(knex("link_util").where("id", req.params.id));
        if (!link)
            throw {status: 404, message: "Link não encontrado"};

        await req.db.knex(knex("link_util")
            .where("id", req.params.id)
            .update({titulo, url, visivel}));
    }));

/**
 * @api {post} /negocio/links_uteis/:id/apagar Apagar link útil
 * @apiName Apagar link útil
 * @apiGroup Negocio
 * @apiDescription Apaga um link útil
 * @apiParam {Number} id ID do link
 */
router.post('/links_uteis/:id/apagar', validarPermissao("link_util.apagar", "params.id"),
    routeWrapper(async (req) => {
        let link = await req.db.knexOne(knex("link_util").where("id", req.params.id));
        if (!link)
            throw {status: 404, message: "Link não encontrado"};

        await req.db.knex(knex("link_util").where("id", req.params.id).del());
    }));

/**
 * @api {get} /negocio/configuracao/obter Obter regras do negócio
 * @apiName Obter configuração do negócio
 * @apiGroup Negocio
 * @apiDescription Obtém as regras do negócio
 */
router.get('/configuracao/obter', validarPermissao("negocio.ler_configuracao"),
    routeWrapper(async (req) => {
        return await detalhesSite(req.db, req.session.user_site);
    }));

/**
 * @api {post} /negocio/configuracao/editar Editar regras do negócio
 * @apiName Editar configuração do negócio
 * @apiGroup Negocio
 * @apiDescription Edita as regras do negócio
 */
router.post('/configuracao/editar', validarPermissao("negocio.editar_configuracao"),
    [
        body("nib").isString().withMessage("O NIB é obrigatório"),
        body("base_despesas_administracao").isNumeric().withMessage("Indique a base de despesas administrativas"),
        body("taxa_iva_relatorio").isNumeric().withMessage("Indique o valor de IVA a retirar dos movimentos na importação de relatório"),
        body("patamares").isArray().withMessage("Indique a configuração dos patamares do negócio"),
    ],
    routeWrapper(async (req) => {
        await editarSite(req.db, req.session.user_site, req.body);
    }));

/**
 * @api {get} /negocio/dashboard/:modulo Obter seccção de dashboard
 * @apiName Obter seccção de dashboard
 * @apiGroup Negocio
 * @apiDescription Obtém uma seccção do dashboard
 * @apiParam {String} modulo Nome da secção a obter
 */

router.get('/dashboard/:modulo', validarPermissao("negocio.dashboard"),
    routeWrapper(async (req) => {
        return obterDashboard(req, req.params.modulo);
    }));

module.exports = router;