const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const routeWrapper = require("../../misc/route_wrapper");
const {validarPermissao} = require("../../functions/permissoes");
const {gerarToken, listarUtilizadores, aceitarColaborador, atualizarUtilizador, eliminarUtilizador} = require("../../models/utilizador");
const {body} = require("express-validator");
const {obterUtilizadorToken} = require("../../models/utilizador");
const {knex} = require("../../mysql");
const Email = require("../../email/index");
const request = require('request');
const verificarNif = require("../../functions/verificarNif");
const {TIPO_UTILIZADOR} = require("../../conf/consts");
const {paramsPaginacao} = require("../../functions/aplicarPaginacao");
const Perfil = require("../../models/perfil");
const {criarPedidoCartoes} = require("../../models/cartao");
const {obterUtilizador} = require("../../functions/obterUtilizador");

/**
 * @api {post} /utilizador/login Login
 * @apiName Login
 * @apiGroup Utilizador
 * @apiDescription Faz o login do utilizador.
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} password Password do utilizador
 **/

router.post('/login',
    [
        body("utilizador").isString().withMessage("O utilizador é obrigatório"),
        body("password").isString().withMessage("A password é obrigatória")
    ]
    , routeWrapper(async (req) => {
        let query = knex("utilizador")
            .where("email", req.body.utilizador)
            .limit(1);

        let utilizador = await req.db.knexOne(query);

        if (!utilizador || !(await bcrypt.compare(req.body.password, utilizador.password)))
            throw {message: "As credenciais estão erradas", code: 401};

        if (utilizador.data_desativado)
            throw {message: "A sua conta não está ativa, entre em contacto com a equipa.", code: 401};

        if (utilizador.tipo === TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
            throw {message: "O seu registo está pendente de aprovação, por favor aguarde e volte a tentar mais tarde", code: 401};

        if (utilizador.tipo === TIPO_UTILIZADOR.CLIENTE)
            throw {message: "Para utilizar esta plataforma deve registar-se como colaborador", code: 401};

        req.session.user_id = utilizador.id;
        req.session.user_type = utilizador.tipo;
        req.session.user_site = utilizador.site;       

        // Salva a sessão explicitamente
        req.session.save((err) => {
            if (err) {
                console.error('Erro ao salvar a sessão:', err);
                return res.status(500).json({ message: 'Erro ao salvar a sessão.' });
            }
        });

        return {utilizador: await obterUtilizador(req.db, utilizador.id)};     
    }));

/**
 * @api {post} /utilizador/logout Logout do Utilizador
 * @apiName Logout do Utilizador
 * @apiGroup Utilizador
 * @apiDescription Faz o logout do utilizador
 */
router.post('/logout', routeWrapper(async (req) => {
    req.session.destroy();
}));

/**
 * @api {post} /utilizador/registo Registo
 * @apiName Registo
 * @apiGroup Utilizador
 * @apiDescription Utilizador faz registo que será posteriormente completado e aceite pelo administrador.
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} nome Nome completo
 * @apiBody {String} telemovel Telemovel
 * @apiBody {String} password Password
 * @apiBody {String} numero_ascendente Número de telemóvel do ascendente
 * @apiBody {String} morada Morada
 * @apiBody {String} codigo_postal Código Postal
 * @apiBody {String} localidade Localidade
 * @apiBody {Boolean} tos_pp Concorda com os termos e condições e a política de privacidade
 **/

router.post('/registo',
    [
        body("email").isEmail().withMessage("O email é obrigatório"),
        body("nome").isString().withMessage("O nome é obrigatório"),
        body("telemovel").isString().withMessage("O telemovel é obrigatório"),
        body("password").isString().withMessage("A password é obrigatória"),
        body("numero_ascendente").custom(value => (value.trim().length > 0 && value.length === 9 && value.replace(/[^0-9.]/g, '').length === 9)).withMessage("O número de telemóvel do ascendente é obrigatório e deverá ter 9 dígitos"),
        body("morada").isString().withMessage("A morada é obrigatória"),
        body("codigo_postal").isString().withMessage("O código postal é obrigatório"),
        body("localidade").isString().withMessage("A localidade é obrigatória"),
        body("notificacao_sms").isBoolean().withMessage("Indique se recebe atualizações de negócio via SMS"),
        body("notificacao_email").isBoolean().withMessage("Indique se pretende receber notificações por email"),
        body("marketing").isBoolean().withMessage("Indique se pretende ou não receber notificações de marketing"),
        body("tos_pp").isBoolean().custom(value => value === true).withMessage("É obrigatório aceitar os termos e condições e a política de privacidade")
    ]
    , routeWrapper(async (req) => {
        // Validar recaptcha
        let captchaResponse = await (new Promise((resolve, reject) => {
            request.post({
                url: "https://www.google.com/recaptcha/api/siteverify",
                form: {
                    secret: process.env.GOOGLE_RECAPTCHA_SECRET,
                    response: req.body.captcha,
                    remoteip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null
                }
            }, (err, res, body) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(JSON.parse(body));
            });
        }));

        if (!captchaResponse.success)
            throw {message: "Erro na validação do captcha", code: 400};

        let utilizadorExiste = await req.db.knexOne(knex("utilizador").where("email", req.body.email));
        if (utilizadorExiste)
            throw {code: 400, message: "O e-mail introduzido já está em uso. Tente recuperar a password, ou aguarde que o seu registo seja processado"};

        let numero_colaborador = await req.db.knexOne(knex("utilizador").select(knex.raw("max(numero_colaborador)+1 as numero_colaborador")));
        numero_colaborador = numero_colaborador.numero_colaborador;

        let query = knex("utilizador").insert({
            email: req.body.email,
            nome: req.body.nome,
            password: await bcrypt.hash(req.body.password, 12),
            telemovel: req.body.telemovel,
            telemovel_ascendente: req.body.numero_ascendente,
            morada: req.body.morada.trim(),
            codigo_postal: req.body.codigo_postal.trim(),
            localidade: req.body.localidade.trim(),
            notificacao_sms: req.body.notificacao_sms ? knex.fn.now() : null,
            notificacao_email: req.body.notificacao_email ? knex.fn.now() : null,
            marketing: req.body.marketing ? knex.fn.now() : null,
            site: process.env.SITE_ID,
            numero_colaborador,
            tipo: TIPO_UTILIZADOR.COLABORADOR_PENDENTE
        });

        let {insertId} = await req.db.knex(query);

        // TODO enviar e-mail de registo com sucesso

        return true;
    }));

/**
 * @api {post} /utilizador/recuperar_password/pedir Recuperar Password
 * @apiName Recuperar Password
 * @apiGroup Utilizador
 * @apiDescription Utilizador faz pedido de recuperação de password.
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} captcha Resposta Google Recaptcha
 */

router.post('/recuperar_password/pedir', [
        body("email").isString().withMessage("O e-mail é obrigatório"),
        body("captcha").isString().withMessage("O valor do captcha é obrigatório")
    ],
    routeWrapper(async (req) => {
        // Validar recaptcha
        let captchaResponse = await (new Promise((resolve, reject) => {
            request.post({
                url: "https://www.google.com/recaptcha/api/siteverify",
                form: {
                    secret: process.env.GOOGLE_RECAPTCHA_SECRET,
                    response: req.body.captcha,
                    remoteip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null
                }
            }, (err, res, body) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(JSON.parse(body));
            });
        }));

        if (!captchaResponse.success)
            throw {message: "Erro na validação do captcha", code: 400};

        // Obter utilizador através de telemóvel ou e-mail
        let utilizador = await req.db.knexOne(knex("utilizador").where("email", req.body.email));

        // Mesmo que o utilizador não exista, o cliente não deverá ser informado de que o registo não foi encontrado.
        if (!utilizador)
            return true;

        let token_acesso = await gerarToken(req.db);
        await req.db.knex(knex("utilizador")
            .where("id", utilizador.id)
            .update({token_acesso: token_acesso}));

        // Enviar e-mail de recuperação, ou SMS.
        if (utilizador.email) {
            let email = new Email(utilizador.email);
            await email.enviarResetPasswordEmail(utilizador.nome, `${process.env.URL_FRONT_END}/?reset=${token_acesso}`);
        }
    }));

/**
 * @api {post} /utilizador/recuperar_password/definir_password Definir Password
 * @apiName Definir Password
 * @apiGroup Utilizador
 * @apiDescription Utilizador define nova password.
 * @apiBody {String} token_acesso Token de acesso enviado para o e-mail
 * @apiBody {String} password Nova password
 * @apiBody {String} captcha Resposta Google Recaptcha
 */

router.post('/recuperar_password/definir_password', [
        body("token_acesso").isString().withMessage("O e-mail é obrigatório"),
        body("password").isString().withMessage("Indique a password que pretende utilizar"),
        body("captcha").isString().withMessage("O valor do captcha é obrigatório")
    ],
    routeWrapper(async (req) => {
        let {token_acesso, password} = req.body;

        // Validar recaptcha
        let captchaResponse = await (new Promise((resolve, reject) => {
            request.post({
                url: "https://www.google.com/recaptcha/api/siteverify",
                form: {
                    secret: process.env.GOOGLE_RECAPTCHA_SECRET,
                    response: req.body.captcha,
                    remoteip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null
                }
            }, (err, res, body) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(JSON.parse(body));
            });
        }));

        if (!captchaResponse.success)
            throw {message: "Erro na validação do captcha", code: 400};

        let utilizador = await obterUtilizadorToken(req.db, token_acesso);

        let queryUpdatePassword = knex("utilizador")
            .where("id", utilizador.id)
            .update({
                password: await bcrypt.hash(password, 12),
                token_acesso: null
            });

        await req.db.knex(queryUpdatePassword);

        return true;
    }));

/**
 * @api {get} /utilizador/detalhes Detalhes
 * @apiName Detalhes
 * @apiGroup Utilizador
 * @apiDescription Detalhes do utilizador autenticado
 */
router.get('/detalhes', validarPermissao("utilizador.ler"), routeWrapper(async (req) => {
    return {
        utilizador: await obterUtilizador(req.db, req.session.user_id)
    };
}));

/**
 * @api {get} /utilizador/listar Listar Utilizadores
 * @apiName Listar Utilizadores
 * @apiGroup Utilizador
 * @apiDescription Lista todos os utilizadores, ou de um determinado tipo. Possibilidade de filtrar por texto.
 * @apiBody {String} [tipo] Tipo de utilizador
 * @apiQuery {String} [pesquisa] Termo de pesquisa
 */
router.get('/listar/:tipo?', validarPermissao("utilizador.ler"), routeWrapper(async (req) => {
    return await listarUtilizadores(req.db, {
        tipo: req.params.tipo,
        filtro: req.query.pesquisa,
        exportar_excel: typeof req.query.exportar_excel !== 'undefined',
        ...paramsPaginacao(req)
    });
}));

/**
 * @api {get} /utilizador/existem_novos Existem novos registos?
 * @apiName Existem novos registos?
 * @apiGroup Utilizador
 * @apiDescription Verifica se existem registos de utilizadores por aprovar.
 */
router.get('/existem_novos', validarPermissao("utilizador.aceitar_colaborador"), routeWrapper(async (req) => {
    return {
        contagem: (await req.db.knexOne(knex("utilizador")
            .where("tipo", TIPO_UTILIZADOR.COLABORADOR_PENDENTE)
            .count("* as count"))).count
    };
}));

/**
 * @api {get} /utilizador/:id/aceitar_colaborador Aceitar Colaborador
 * @apiName Aceitar Colaborador
 * @apiGroup Utilizador
 * @apiDescription Converte o registo de COLABORADOR_PENDENTE para COLABORADOR
 * @apiParam {Number} id Id do utilizador
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} nome Nome completo
 * @apiBody {String} telemovel  Telemovel
 * @apiBody {String} data_nascimento Data de Nascimento
 * @apiBody {String} morada Morada
 * @apiBody {String} codigo_postal Código Postal
 * @apiBody {String} localidade Localidade
 * @apiBody {String} doc_identificacao_tipo Documento de identificação
 * @apiBody {String} doc_identificacao_numero Nº documento de identificação
 * @apiBody {String} doc_identificacao_emissao Data de emissão
 * @apiBody {String} doc_identificacao_validade Data de validade
 * @apiBody {String} doc_identificacao_local_emissao Local de emissão
 * @apiBody {Number} nif NIF
 * @apiBody {String} iban IBAN
 * @apiBody {Object} pedido_cartoes Informação sobre os cartões que o colaborador deve receber
 * @apiBody {String} [numero_telemovel_youbiz] Número de telemóvel do Youbiz
 * @apiBody {String} [numero_ascendente] Número de telemóvel do ascendente
 * @apiBody {Boolean} [notificacao_sms] Recebe atualizações de negócio via SMS
 * @apiBody {Boolean} [notificacao_email] Recebe atualizações de negócio via Email
 * @apiBody {Boolean} [marketing] Aceita os termos de marketing
 */
router.post('/:id/aceitar_colaborador', validarPermissao("utilizador.aceitar_colaborador", "params.id"),
    [
        body("email").isEmail().withMessage("O email é obrigatório"),
        body("nome").isString().withMessage("O nome é obrigatório"),
        body("telemovel").custom(value => (value.trim().length > 0 && (value.length === 9 || value.replace(/[^0-9.]/g, '').length === 9))).withMessage("O telemovel é obrigatório e deverá ter 9 dígitos"),
        body("data_nascimento").optional({nullable: true}).isISO8601().withMessage("A data de nascimento é obrigatória").toDate(),
        body("morada").optional({nullable: true}).isString().withMessage("A morada é obrigatória"),
        body("codigo_postal").optional({nullable: true}).isString().withMessage("O código postal é obrigatório"),
        body("localidade").optional({nullable: true}).isString().withMessage("A localidade é obrigatória"),
        body("doc_identificacao_tipo").optional({nullable: true}).isString().withMessage("O tipo de documento de identificação é obrigatório"),
        body("doc_identificacao_numero").optional({nullable: true}).isString().withMessage("O nº de documento de identificação é obrigatório"),
        body("doc_identificacao_emissao").optional({nullable: true}).isISO8601().withMessage("A data de emissão do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_validade").optional({nullable: true}).isISO8601().withMessage("A data de validade do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_local_emissao").optional({nullable: true}).isString().withMessage("O local de emissão do documento de identificação é obrigatório"),
        body("nif").optional({nullable: true}).custom((valor) => valor.trim() === '' || verificarNif(valor)).withMessage("O NIF inserido não é válido"),
        body("iban").optional({nullable: true}).isString().withMessage("O IBAN é obrigatório"),
        body("pedido_cartoes").exists().withMessage("Obrigatório indicar as informações do pedido de cartões"),
        body("numero_ascendente").optional({nullable: true}).custom(value => (value.trim().length > 0 && (value.length === 9 || value.replace(/[^0-9.]/g, '').length === 9))).withMessage("O número de telemóvel do ascendente deverá ter 9 dígitos"),
        body("numero_telemovel_youbiz").optional({nullable: true}).custom(value => (value.trim().length > 0 && (value.length === 9 || value.replace(/[^0-9.]/g, '').length === 9))).withMessage("O número de telemóvel do Youbiz deverá ter 9 dígitos"),
    ],
    routeWrapper(async (req) => {
        await aceitarColaborador(req.db, req.params.id, req.body);
        await criarPedidoCartoes(req, req.params.id, req.body.pedido_cartoes);
    }));

/**
 * @api {get} /utilizador/:id/perfil/base Perfil do Utilizador (base)
 * @apiName Perfil do Utilizador (base)
 * @apiGroup Utilizador
 * @apiDescription Obtém o perfil do utilizador - Informações Base
 * @apiParam {Number} id Id do utilizador
 */
router.get('/:id/perfil/base', validarPermissao("utilizador.ler_perfil", "params.id"),
    routeWrapper(async (req) => {
        return Perfil.obterBase(req, req.params.id);
    }));

/**
 * @api {get} /utilizador/:id/perfil/equipa Perfil do Utilizador (equipa)
 * @apiName Perfil do Utilizador (equipa)
 * @apiGroup Utilizador
 * @apiDescription Obtém o perfil do utilizador - Informações da Equipa
 * @apiParam {Number} id Id do utilizador
 */
router.get('/:id/perfil/equipa', validarPermissao("utilizador.ler_perfil", "params.id"),
    routeWrapper(async (req) => {
        return Perfil.obterEquipa(req, req.params.id);
    }));


/**
 * @api {get} /utilizador/:id/perfil/cartoes Perfil do Utilizador (cartoes)
 * @apiName Perfil do Utilizador (cartoes)
 * @apiGroup Utilizador
 * @apiDescription Obtém o perfil do utilizador - Informações dos Cartões
 * @apiParam {Number} id Id do utilizador
 */
router.get('/:id/perfil/estatisticas', validarPermissao("utilizador.ler_perfil", "params.id"),
    routeWrapper(async (req) => {
        return Perfil.obterEstatisticas(req, req.params.id, {
            ano: req.query.ano,
            mes: req.query.mes,
            total_carregado: req.session.user_type === TIPO_UTILIZADOR.ADMIN
        },);
    }));

/**
 * @api {get} /utilizador/:id/detalhes Detalhes do Utilizador
 * @apiName Detalhes do Utilizador
 * @apiGroup Utilizador
 * @apiDescription Obtém os detalhes do utilizador
 * @apiParam {Number} id Id do utilizador
 */
router.get('/:id/detalhes', validarPermissao("utilizador.ler", "params.id"),
    routeWrapper(async (req) => {
        return obterUtilizador(req.db, req.params.id);
    }));

/**
 * @api {post} /utilizador/:id/editar Editar Utilizador
 * @apiName Editar Utilizador
 * @apiGroup Utilizador
 * @apiDescription Edita os detalhes do utilizador
 * @apiParam {Number} id Id do utilizador
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} nome Nome completo
 * @apiBody {String} telemovel  Telemovel
 * @apiBody {String} data_nascimento Data de Nascimento
 * @apiBody {String} morada Morada
 * @apiBody {String} codigo_postal Código Postal
 * @apiBody {String} localidade Localidade
 * @apiBody {String} doc_identificacao_tipo Documento de identificação
 * @apiBody {String} doc_identificacao_numero Nº documento de identificação
 * @apiBody {String} doc_identificacao_emissao Data de emissão
 * @apiBody {String} doc_identificacao_validade Data de validade
 * @apiBody {String} doc_identificacao_local_emissao Local de emissão
 * @apiBody {Number} nif NIF
 * @apiBody {String} iban IBAN
 * @apiBody {Boolean} [notificacao_sms] Recebe atualizações de negócio via SMS
 * @apiBody {Boolean} [notificacao_email] Recebe atualizações de negócio via Email
 * @apiBody {Boolean} [marketing] Aceita os termos de marketing
 * @apiBody {Boolean} [ativo] Ativo
 * @apiBody {Number} [despesas_administrativas_mensais] Despesas administrativas a aplicar mensalmente
 * @apiBody {Number} [premio_mensal] Prémio a aplicar mensalmente
 **/
router.post('/:id/editar', validarPermissao("utilizador.editar", "params.id"),
    [
        body("email").isEmail().withMessage("O email é obrigatório"),
        body("nome").isString().withMessage("O nome é obrigatório"),
        body("telemovel").isString().withMessage("O telemovel é obrigatório"),
        body("data_nascimento").optional({nullable: true}).isISO8601().withMessage("A data de nascimento é obrigatória").toDate(),
        body("morada").optional({nullable: true}).isString().withMessage("A morada é obrigatória"),
        body("codigo_postal").optional({nullable: true}).matches(/^\d{4}(-\d{3})?$/).withMessage("O código postal é inválido"),
        body("localidade").optional({nullable: true}).isString().withMessage("Indique a localidade"),
        body("doc_identificacao_tipo").optional({nullable: true}).isString().withMessage("O tipo de documento de identificação é obrigatório"),
        body("doc_identificacao_numero").optional({nullable: true}).isString().withMessage("O nº de documento de identificação é obrigatório"),
        body("doc_identificacao_emissao").optional({nullable: true}).isISO8601().withMessage("A data de emissão do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_validade").optional({nullable: true}).isISO8601().withMessage("A data de validade do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_local_emissao").optional({nullable: true}).isString().withMessage("O local de emissão do documento de identificação é obrigatório"),
        body("nif").optional({nullable: true}).custom((valor) => valor.trim() === '' || verificarNif(valor)).withMessage("O NIF inserido não é válido"),
        body("iban").optional({nullable: true}).isString().withMessage("O IBAN é obrigatório"),
        body("despesas_administrativas_mensais").optional({checkFalsy: true}).isNumeric().withMessage("O valor das despesas administrativas é inválido"),
        body("premio_mensal").optional({checkFalsy: true}).isNumeric().withMessage("O prémio mensal é inválido")
    ],
    routeWrapper(async (req) => {
        await atualizarUtilizador(req.db, req.params.id, req.body);
    }));

/**
 * @api {post} /utilizador/editar_dados_pessoais Editar Dados Pessoais
 * @apiName Editar Dados Pessoais
 * @apiGroup Utilizador
 * @apiDescription Edita os dados pessoais do próprio utilizador
 * @apiBody {String} email Email do utilizador
 * @apiBody {String} nome Nome completo
 * @apiBody {String} telemovel  Telemovel
 * @apiBody {String} data_nascimento Data de Nascimento
 * @apiBody {String} morada Morada
 * @apiBody {String} codigo_postal Código Postal
 * @apiBody {String} localidade Localidade
 * @apiBody {String} doc_identificacao_tipo Documento de identificação
 * @apiBody {String} doc_identificacao_numero Nº documento de identificação
 * @apiBody {String} doc_identificacao_emissao Data de emissão
 * @apiBody {String} doc_identificacao_validade Data de validade
 * @apiBody {String} doc_identificacao_local_emissao Local de emissão
 * @apiBody {Number} nif NIF
 * @apiBody {String} iban IBAN
 * @apiBody {String} [password_atual] Password atual
 * @apiBody {String} [password_nova] Password nova
 * @apiBody {Boolean} [notificacao_sms] Recebe atualizações de negócio via SMS
 * @apiBody {Boolean} [notificacao_email] Recebe atualizações de negócio via Email
 * @apiBody {Boolean} [marketing] Aceita os termos de marketing
 **/
router.post('/editar_dados_pessoais', validarPermissao("utilizador.atualizar_dados_pessoais"),
    [
        body("email").isEmail().withMessage("O email é inválido"),
        body("telemovel").isString().isLength({min: 9}).withMessage("O telemovel é inválido"),
        body("data_nascimento").optional({nullable: true}).isISO8601().withMessage("A data de nascimento é obrigatória").toDate(),
        body("morada").isString().not().isEmpty().withMessage("A morada é obrigatória"),
        body("codigo_postal").matches(/^\d{4}(-\d{3})?$/).withMessage("O código postal é inválido"),
        body("localidade").isString().not().isEmpty().withMessage("Indique a localidade"),
        body("doc_identificacao_tipo").optional({nullable: true}).isString().withMessage("O tipo de documento de identificação é obrigatório"),
        body("doc_identificacao_numero").optional({nullable: true}).isString().withMessage("O nº de documento de identificação é obrigatório"),
        body("doc_identificacao_emissao").optional({nullable: true}).isISO8601().withMessage("A data de emissão do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_validade").optional({nullable: true}).isISO8601().withMessage("A data de validade do documento de identificação é obrigatória").toDate(),
        body("doc_identificacao_local_emissao").optional({nullable: true}).isString().withMessage("O local de emissão do documento de identificação é obrigatório"),
        body("nif").custom((valor) => valor.trim() === '' || verificarNif(valor)).withMessage("O NIF inserido não é válido"),
        body("iban").isString().not().isEmpty().withMessage("O IBAN é obrigatório"),
        body("password_atual").isString().withMessage("Preencha a password atual"),
        body("password_nova").optional({nullable: true}).isString().isLength({min: 6}).withMessage("A password nova deve ter pelo menos 6 caracteres"),
    ],
    routeWrapper(async (req) => {
        await atualizarUtilizador(req.db, req.session.user_id, [
            "email", "telemovel", "data_nascimento", "morada", "codigo_postal", "localidade", "doc_identificacao_tipo",
            "doc_identificacao_numero", "doc_identificacao_emissao", "doc_identificacao_validade", "doc_identificacao_local_emissao",
            "nif", "iban", "notificacao_sms", "notificacao_email", "marketing", "password_nova", "password_atual"
        ].reduce((acc, f) => {
            acc[f] = req.body[f];
            return acc;
        }, {}));
    }));

/**
 * @api {post} /utilizador/:id/editar_notas Editar Notas do Utilizador
 * @apiName Editar Notas do Utilizador
 * @apiGroup Utilizador
 * @apiDescription Edita as notas do utilizador
 * @apiParam {Number} id Id do utilizador
 * @apiBody {String} notas Notas do utilizador
 */

router.post('/:id/editar_notas', validarPermissao("utilizador.editar_notas", "params.id"),
    [
        body("notas").isString().withMessage("É obrigatório indicar as notas do utilizador")
    ],
    routeWrapper(async (req) => {
        await req.db.knex(knex('utilizador')
            .where('id', req.params.id)
            .update({notas: req.body.notas})
        );
    }));

/**
 * @api {post} /utilizador/:id/apaghar Apagar Utilizador
 * @apiName Apagar Utilizador
 * @apiGroup Utilizador
 * @apiDescription Apaga um utilizador, caso seja do tipo "Colaborador Pendente"
 * @apiParam {Number} id Id do utilizador
 */

router.post('/:id/apagar', validarPermissao("utilizador.apagar", "params.id"),
    routeWrapper(async (req) => {
        await eliminarUtilizador(req.db, req.params.id);
    }));

module.exports = router;