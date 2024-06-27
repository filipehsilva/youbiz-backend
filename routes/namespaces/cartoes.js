const express = require('express');
const router = express.Router();
const routeWrapper = require("../../misc/route_wrapper");
const {validarPermissao} = require("../../functions/permissoes");
const {body} = require("express-validator");
const {listarCartoes, detalhesCartao, listarPedidosCartoes, criarPedidoCartoes, expedirPedidoCartoes, imprimirMoradasPedidosCartoes, listarProdutos, criarProduto, editarProduto, apagarProduto, expedirPedidoCartoesAnular} = require("../../models/cartao");
const {paramsPaginacao} = require("../../functions/aplicarPaginacao");
const {knex} = require("../../mysql");
const {TIPO_UTILIZADOR} = require("../../conf/consts");

/**
 * @api {get} /cartoes/listar Listar cartões
 * @apiName Listar cartões
 * @apiGroup Cartões
 * @apiDescription Lista todos os cartões existentes. Possibilidade de filtrar por texto.
 * @apiQuery {String} [pesquisa] Termo de pesquisa
 * @apiQuery {Number} [ano] Filtrar cartões por ano de criação
 */
router.get('/listar', validarPermissao("cartao.ler"), routeWrapper(async (req) => {
    return await listarCartoes(req.db, {
        filtro: req.query.pesquisa,
        ano: req.query.ano,
        ...paramsPaginacao(req)
    });
}));

/**
 * @api {get} /cartoes/pedidos/listar Listar pedidos de cartões
 * @apiName Listar pedidos de cartões
 * @apiGroup Cartões
 * @apiDescription Lista todos os pedidos de cartões.
 * @apiQuery {Number} [ano] Filtrar pedidos por ano
 */
router.get('/pedidos/listar', validarPermissao("cartao.ler_pedidos"), routeWrapper(async (req) => {
    return await listarPedidosCartoes(req.db, {
        filtro: req.query.pesquisa,
        ano: req.query.ano,
        ...paramsPaginacao(req)
    });
}));

/**
 * @api {post} /cartoes/pedidos/criar Criar pedido de cartões
 * @apiName Criar pedido de cartões
 * @apiGroup Cartões
 * @apiDescription Cria um pedido de cartões.
 * @apiBody {String} pedido_cartoes Cartões que serão pedidos
 * @apiBody {String} [utilizador] Utilizador que criou o pedido
 */
router.post('/pedidos/criar', validarPermissao("cartao.criar_pedido", "body.utilizador"),
    [
        body("pedido_cartoes").exists().withMessage("Obrigatório indicar as informações do pedido de cartões"),
        body("utilizador").isNumeric().optional({nullable: true})
    ],
    routeWrapper(async (req) => {
        let utilizador_pedido = req.session.user_type === TIPO_UTILIZADOR.ADMIN ? req.body.utilizador : req.session.user_id;
        if (!utilizador_pedido)
            throw {code: 400, message: "Indique o utilizador associado ao pedido de cartões"};
        return await criarPedidoCartoes(req, utilizador_pedido, req.body.pedido_cartoes);
    }));

/**
 * @api {post} /cartoes/pedidos/:id/expedir Expedir pedido de cartões
 * @apiName Expedir pedido de cartões
 * @apiGroup Cartões
 * @apiDescription Expede um pedido de cartões.
 * @apiParam {Number} id ID do pedido de cartões
 * @apiBody {String} cartoes_expedidos Informações dos cartões que serão expedidos
 */
router.post('/pedidos/:id/expedir', validarPermissao("cartao.expedir_pedido", "params.id"),
    [
        body("cartoes_expedidos").exists().withMessage("Obrigatório indicar as informações sobre a expedição de cartões"),
    ],
    routeWrapper(async (req) => {
        return await expedirPedidoCartoes(req, req.params.id, req.body.cartoes_expedidos);
    }));

/**
 * @api {post} /cartoes/pedidos/:id/anular_expedicao Anular expedição de cartões
 * @apiName Anular expedição de cartões
 * @apiGroup Cartões
 * @apiDescription Anula a expedição de cartões e remove os cartões expedidos do sistema
 * @apiParam {Number} id ID do pedido de cartões
 */
router.post('/pedidos/:id/anular_expedicao', validarPermissao("cartao.expedir_pedido", "params.id"),
    routeWrapper(async (req) => {
        return await expedirPedidoCartoesAnular(req, req.params.id);
    }));

/**
 * @api {post} /cartoes/pedidos/:id/recusar Recusar expedição de cartões
 * @apiName Recusar expedição de cartões
 * @apiGroup Cartões
 * @apiDescription Marca o pedido de cartões como recusado
 * @apiParam {Number} id ID do pedido de cartões
 */
router.post('/pedidos/:id/recusar', validarPermissao("cartao.recusar_pedido", "params.id"),
    routeWrapper(async (req) => {
        let pedido = await req.db.knexOne(knex("pedido_cartoes").where({id: req.params.id}));
        if (pedido.data_expedido)
            throw {code: 400, message: "O pedido já foi expedido"};
        if (pedido.data_rejeitado)
            throw {code: 400, message: "O pedido já foi rejeitado"};

        await req.db.knex(knex("pedido_cartoes").where({id: pedido.id}).update({
            data_rejeitado: knex.fn.now(),
        }));
    }));

/**
 * @api {post} /cartoes/pedidos/:id/anular_recusar Anular recusa de expedição de cartões
 * @apiName Anular recusa de expedição de cartões
 * @apiGroup Cartões
 * @apiDescription Desmarca o pedido de cartões como recusado
 * @apiParam {Number} id ID do pedido de cartões
 */
router.post('/pedidos/:id/anular_recusar', validarPermissao("cartao.recusar_pedido", "params.id"),
    routeWrapper(async (req) => {
        let pedido = await req.db.knexOne(knex("pedido_cartoes").where({id: req.params.id}));
        if (pedido.data_expedido)
            throw {code: 400, message: "O pedido já foi expedido"};
        if (!pedido.data_rejeitado)
            throw {code: 400, message: "O pedido não foi rejeitado"};

        await req.db.knex(knex("pedido_cartoes").where({id: pedido.id}).update({
            data_rejeitado: null
        }));
    }));

/**
 * @api {get} /cartoes/pedidos/:ids/imprimir_moradas Imprimir moradas de cartões
 * @apiName Imprimir moradas de cartões
 * @apiGroup Cartões
 * @apiDescription Gera um documento PDF com as moradas dos pedidos selecionados.
 * @apiParam {Number} ids IDs dos cartões
 */
router.get('/pedidos/:ids/imprimir_moradas', validarPermissao("cartao.ler_pedidos"),
    routeWrapper(async (req) => {
        let ids = req.params.ids.split(",").map(Number);
        return await imprimirMoradasPedidosCartoes(req.db, ids);
    }));

/**
 * @api {get} /cartoes/pedidos/ultimo_pedido/:id_colaborador Último pedido de colaborador
 * @apiName Último pedido de colaborador
 * @apiGroup Cartões
 * @apiDescription Devolve o último pedido de cartões de um colaborador
 * @apiParam {Number} id_colaborador ID do colaborador
 */
router.get('/pedidos/ultimo_pedido/:id_colaborador', validarPermissao("cartao.ler_pedidos"),
    routeWrapper(async (req) => {
        let id_colaborador = req.params.id_colaborador;
        let pedido = await req.db.knexOne(knex("pedido_cartoes")
            .where({vendedor: id_colaborador})
            .orderBy("data_criacao", "desc")
            .limit(1));
        if (pedido)
            return JSON.parse(pedido.produtos_expedicao || pedido.produtos_pedido);
        return [];
    }));

/**
 * @api {get} /cartoes/produtos/listar Listar produtos
 * @apiName Listar produtos
 * @apiGroup Cartões
 * @apiDescription Lista todos os produtos existentes. Possibilidade de filtrar por texto.
 * @apiQuery {String} [pesquisa] Termo de pesquisa
 */
router.get('/produtos/listar', validarPermissao("produto.ler"), routeWrapper(async (req) => {
    return await listarProdutos(req.db, {
        filtro: req.query.pesquisa,
        ...paramsPaginacao(req)
    });
}));

/**
 * @api {post} /cartoes/produtos/criar Criar produto
 * @apiName Criar produto
 * @apiGroup Cartões
 * @apiDescription Cria um produto.
 * @apiBody {String} codigo Código do produto
 * @apiBody {String} nome Nome do produto
 * @apiBody {String} quantidades Quantidades do produto
 * @apiBody {Number} posicao Posição do produto
 * @apiBody {Boolean} ativado Indica se o produto está ativo
 */
router.post('/produtos/criar', validarPermissao("produto.criar"),
    [
        body("codigo").isString().withMessage("Obrigatório indicar o código do produto"),
        body("nome").isString().withMessage("Obrigatório indicar o nome do produto"),
        body("quantidades").isArray().withMessage("Obrigatório indicar as quantidades disponíveis no produto"),
        body("posicao").isNumeric().optional({nullable: true}).withMessage("A posição do produto é inválida"),
        body("ativado").isBoolean().withMessage("Obrigatório indicar se o produto está ativo"),
    ],
    routeWrapper(async (req) => {
        return await criarProduto(req, req.body);
    }));

/**
 * @api {post} /cartoes/produtos/:id/editar Editar produto
 * @apiName Editar produto
 * @apiGroup Cartões
 * @apiDescription Edita um produto.
 * @apiParam {Number} id ID do produto
 * @apiBody {String} codigo Código do produto
 * @apiBody {String} nome Nome do produto
 * @apiBody {String} quantidades Quantidades do produto
 * @apiBody {Number} posicao Posição do produto
 * @apiBody {Boolean} ativado Indica se o produto está ativo
 */
router.post('/produtos/:id/editar', validarPermissao("produto.editar", "params.id"),
    [
        body("codigo").isString().withMessage("Obrigatório indicar o código do produto"),
        body("nome").isString().withMessage("Obrigatório indicar o nome do produto"),
        body("quantidades").isArray().withMessage("Obrigatório indicar as quantidades disponíveis no produto"),
        body("posicao").isNumeric().optional({nullable: true}).withMessage("A posição do produto é inválida"),
        body("ativado").isBoolean().withMessage("Obrigatório indicar se o produto está ativo"),
    ],
    routeWrapper(async (req) => {
        return await editarProduto(req.db, req.params.id, req.body);
    }));

/**
 * @api {post} /cartoes/produtos/:id/apagar Apagar produto
 * @apiName Apagar produto
 * @apiGroup Cartões
 * @apiDescription Apaga um produto, caso não esteja associado a nenhum pedido ou cartão
 * @apiParam {Number} id ID do produto
 */
router.post('/produtos/:id/apagar', validarPermissao("produto.apagar", "params.id"),
    routeWrapper(async (req) => {
        return await apagarProduto(req.db, req.params.id);
    }));

/**
 * @api {get} /cartoes/:id/detalhes Detalhes do cartão
 * @apiName Detalhes do cartão
 * @apiGroup Cartões
 * @apiDescription Detalhes do cartão.
 * @apiParam {Number} id ID do cartão
 */
router.get('/:id/detalhes', validarPermissao("cartao.ler", "params.id"), routeWrapper(async (req) => {
    return await detalhesCartao(req.db, req.params.id);
}));

module.exports = router;