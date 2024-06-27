const {knex} = require("../mysql");
const {aplicarFiltroPesquisa} = require("../functions/aplicarFiltroPesquisa");
const {aplicarPaginacao} = require("../functions/aplicarPaginacao");
const {query} = require("express-validator");
const moment = require("moment");
const {obterPatamares} = require("./negocio");
const {aumentarArvores} = require("../functions/arvores");
const {obterUtilizador} = require("../functions/obterUtilizador");
const htmlPDF = require("html-pdf");
const Ficheiro = require("../misc/ficheiro");
const {TIPO_UTILIZADOR} = require("../conf/consts");

module.exports.detalhesCartao = async (db, id) => {
    let cartao = await db.knexOne(knex("cartao").where("id", id));
    if (!cartao)
        throw {message: "Cartão não encontrado", code: 404};

    return cartao;
}

module.exports.listarCartoes = async (db, opcoes = {}) => {
    let query = knex("cartao")
        .select("cartao.*", "utilizador.nome as vendedor_nome", "utilizador.id as vendedor_id")
        .leftJoin("utilizador", "utilizador.id", "cartao.vendedor")
        .orderBy("cartao.data_criacao", "desc")
        .whereRaw(db.filtro_acesso);

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["sim", "telemovel"], opcoes.filtro, query);

    if (opcoes.ano)
        query.whereRaw("YEAR(cartao.data_criacao) = ?", opcoes.ano);

    return aplicarPaginacao(db, query, opcoes);
}

module.exports.estatisticasCartoesUtilizador = async (req, id_utilizador, opcoes = {}) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);

    let query_enviados = knex("cartao")
        .select(knex.raw("count(*) as count"))
        .where({vendedor: utilizador.id});

    let query_ativados = knex("cartao")
        .select(knex.raw("count(data_ativacao) as count"), "produto.nome")
        .join("produto", "produto.id", "cartao.produto")
        .where({vendedor: utilizador.id, "cartao.site": utilizador.site})
        .groupBy("cartao.produto");

    if (opcoes.ano) {
        opcoes.ano = parseInt(opcoes.ano);
        if (opcoes.mes) {
            opcoes.mes = parseInt(opcoes.mes) + "";
            query_enviados.whereRaw(`data_criacao LIKE "${opcoes.ano}-${opcoes.mes.padStart(2, "0")}-%"`);
            query_ativados.whereRaw(`cartao.data_ativacao LIKE "${opcoes.ano}-${opcoes.mes.padStart(2, "0")}-%"`);
        } else {
            query_enviados.whereRaw(`YEAR(data_criacao) = ?`, opcoes.ano);
            query_ativados.whereRaw(`YEAR(cartao.data_ativacao) = ?`, opcoes.ano);
        }
    }

    let cartoes = (await req.db.knexOne(query_enviados)).count;
    let clientes = await req.db.knex(query_ativados);
    let total_clientes = clientes.reduce((a, b) => a + b.count, 0) || 0

    return {
        cartoes,
        clientes: {
            total: total_clientes,
            detalhe: clientes
        },
        taxa_ativacao: cartoes > 0 ? (total_clientes * 100 / cartoes) : 0
    }
}

module.exports.totalCarregadoEquipa = async (req, id_utilizador, opcoes = {}) => {
    let utilizador = await obterUtilizador(req.db, id_utilizador);

    let query = knex("movimento_cartao")
        .join("equipa_utilizador", "movimento_cartao.cartao", "equipa_utilizador.cartao")
        .select(knex.raw("sum(movimento_cartao.valor) as sum"))
        .where({"equipa_utilizador.utilizador": utilizador.id})
        .where("movimento_cartao.cartao_expirado", 0)
        .where("equipa_utilizador.desativar_comissao", 0);

    if (opcoes.ano) {
        opcoes.ano = parseInt(opcoes.ano);
        if (opcoes.mes) {
            opcoes.mes = parseInt(opcoes.mes) + "";
            query.whereRaw(`movimento_cartao.data_movimento LIKE "${opcoes.ano}-${opcoes.mes.padStart(2, "0")}-%"`);
        } else {
            query.whereRaw(`YEAR(movimento_cartao.data_movimento) = ?`, opcoes.ano);
        }
    }

    return (await req.db.knexOne(query)).sum || 0;
}

/*** PEDIDOS ***/

module.exports.listarPedidosCartoes = async (db, opcoes = {}) => {
    let query = knex("pedido_cartoes")
        .select("pedido_cartoes.*",
            knex.raw("SUBSTRING(pedido_cartoes.comentario, 1, 100) as comentario"),
            "utilizador.nome as vendedor_nome",
            "utilizador.id as vendedor_id",
            "utilizador.numero_colaborador as vendedor_numero_colaborador",
            knex.raw("DATE(data_expedido) > DATE_SUB(NOW(), INTERVAL 45 DAY) " +
                " AND (SELECT count(*) = 0 FROM cartao WHERE pedido = pedido_cartoes.id AND data_ativacao IS NOT NULL)" +
                " AS pode_anular")
        )
        .leftJoin("utilizador", "utilizador.id", "pedido_cartoes.vendedor")
        .orderBy("pedido_cartoes.data_criacao", "desc")
        .whereRaw(db.filtro_acesso);

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["utilizador.numero_colaborador", "nome"], opcoes.filtro, query);

    if (opcoes.ano)
        query.whereRaw("YEAR(pedido_cartoes.data_criacao) = ?", opcoes.ano);

    if (opcoes.ids)
        query.whereIn("pedido_cartoes.id", opcoes.ids);

    if (opcoes.desativar_paginacao)
        return await db.knex(query);

    return aplicarPaginacao(db, query, opcoes);
}

module.exports.criarPedidoCartoes = async (req, utilizador, pedido_cartoes) => {
    utilizador = await obterUtilizador(req.db, utilizador);

    let produtos = [];
    if (!Array.isArray(pedido_cartoes))
        throw {code: 400, message: "Pedido deve ser uma lista de quantidade e produto"};
    await pedido_cartoes.asyncForEach(async ({quantidade, produto}) => {
        produto = await this.obterProduto(req.db, produto.id);
        if (!produto.quantidades.includes(parseInt(quantidade)) && req.session.user_type !== TIPO_UTILIZADOR.ADMIN)
            throw {code: 400, message: "Quantidade de produto inválida"};
        produtos.push({
            id_produto: produto.id,
            nome: produto.nome,
            quantidade: parseInt(quantidade),
        })
    });

    await req.db.knex(knex("pedido_cartoes").insert({
        vendedor: utilizador.id,
        produtos_pedido: JSON.stringify(produtos)
    }));
};

module.exports.expedirPedidoCartoes = async (req, id_pedido, cartoes_expedidos) => {
    let pedido = await req.db.knexOne(knex("pedido_cartoes").where("id", id_pedido));
    if (!pedido)
        throw {message: "Pedido não encontrado", code: 404};
    if (pedido.data_expedido)
        throw {code: 400, message: "O pedido já foi expedido"};
    if (pedido.data_rejeitado)
        throw {code: 400, message: "O pedido já foi rejeitado"};

    let ids_cartoes = [];

    await cartoes_expedidos.asyncForEach(async p => {
        let produto = await this.obterProduto(req.db, p.id);
        await p.codigos.asyncForEach(async codigo => {
            let cartao = await req.db.knexOne(knex("cartao").where("sim", codigo));
            if (cartao)
                throw {code: 400, message: "Já existe um cartão com o código " + codigo + " no sistema."};
            let {insertId} = await req.db.knex(knex("cartao").insert({
                sim: codigo,
                site: req.session.user_site,
                pedido: pedido.id,
                vendedor: pedido.vendedor,
                produto: produto.id
            }));
            ids_cartoes.push(insertId);
        });
    });

    await req.db.knex(knex("pedido_cartoes").where("id", id_pedido).update({
        data_expedido: knex.fn.now(),
        produtos_expedicao: JSON.stringify(cartoes_expedidos.map(c => ({id_produto: c.id, quantidade: c.codigos.length})))
    }));

    await aumentarArvores(req.db, pedido.vendedor, ids_cartoes);
};

module.exports.expedirPedidoCartoesAnular = async (req, id_pedido) => {
    let pedido = await req.db.knexOne(knex("pedido_cartoes")
        .select(
            "*",
            knex.raw("DATE(data_expedido) > DATE_SUB(NOW(), INTERVAL 45 DAY) " +
                " AND (SELECT count(*) = 0 FROM cartao WHERE pedido = pedido_cartoes.id AND data_ativacao IS NOT NULL)" +
                " AS pode_anular")
        )
        .where("id", id_pedido));
    if (!pedido)
        throw {message: "Pedido não encontrado", code: 404};
    if (!pedido.data_expedido)
        throw {code: 400, message: "O pedido não foi expedido"};
    if (pedido.data_rejeitado)
        throw {code: 400, message: "O pedido foi rejeitado"};
    if (!pedido.pode_anular)
        throw {code: 400, message: "Já passaram mais de 45 dias desde a expedição do pedido, ou já existem cartões ativos associados a esse pedido"};

    let cartoes = await req.db.knex(knex("cartao").where("pedido", pedido.id));
    let ids_cartoes = cartoes.map(c => c.id);

    // Remover cartões das equipas
    await req.db.knex(knex("equipa_utilizador").whereIn("cartao", ids_cartoes).del());
    // Remover cartões
    await req.db.knex(knex("cartao").whereIn("id", ids_cartoes).del());

    await req.db.knex(knex("pedido_cartoes").where("id", pedido.id).update({
        data_expedido: null,
        produtos_expedicao: null
    }));
};

module.exports.imprimirMoradasPedidosCartoes = async (db, ids_pedidos) => {
    let pedidos = await this.listarPedidosCartoes(db, {
        ids: ids_pedidos,
        desativar_paginacao: true
    });

    db.filtro_acesso = "1";

    let html = `<html style="zoom:0.75"><body style="margin:0; padding: 14mm 10mm"><table width="100%" style="border-collapse: collapse">`;
    for (let i = 0; i < pedidos.length; i += 3) {
        html += `<tr style="page-break-inside: avoid; height: 3.81cm;">`; // Dimensão é fantasiosa, mas foi ajustada para caberem 7 linhas por folha A4
        for (let j = i; j < i + 3; j++) {
            if (j < pedidos.length) {
                let vendedor = await obterUtilizador(db, pedidos[j].vendedor);
                let nome = vendedor.nome.split(" ");
                html += `<td style="padding: 0px 14px; font-size: 12px; line-height: 1.4; page-break-inside: avoid; width: 33.333%">
                A/C Exmo(a) Sr(a)<br/>
                ${nome[0]} ${nome[nome.length - 1]}<br/>
                ${vendedor.morada}<br/>
                ${vendedor.codigo_postal} ${vendedor.localidade}
            </td>`;
            } else
                html += `<td></td>`;
        }
        html += `</tr>`;
    }

    html += `</table></body></html>`;

    let buff = await new Promise((resolve, reject) => {
        htmlPDF.create(html, {
            format: 'A4',
            border: 0
        }).toBuffer(function (err, buffer) {
            if (err) return reject(err);
            resolve(buffer);
        });
    });

    return new Ficheiro(`moradas.pdf`, "application/pdf", buff);
};

/*** PRODUTOS ***/

module.exports.listarProdutos = async (db, opcoes = {}) => {
    let query = knex("produto")
        .select("*")
        .orderBy("codigo")
        .whereNull("data_apagado")
        .whereRaw(db.filtro_acesso);

    if (opcoes.filtro)
        aplicarFiltroPesquisa(["codigo", "nome"], opcoes.filtro, query);

    if (opcoes.contar_vendidos)
        query.select(
            knex.raw("(SELECT count(*) FROM cartao WHERE cartao.produto = produto.id) as contagem_cartoes"),
            knex.raw(`(SELECT count(*) FROM pedido_cartoes where JSON_CONTAINS(produtos_pedido, CONCAT('{"id_produto": "', produto.id,'"}'))) as contagem_pedidos`)
        );

    return aplicarPaginacao(db, query, opcoes);
}

module.exports.obterProduto = async (db, id, contar_utilizacoes = false) => {
    let query = knex("produto")
        .select("*")
        .whereNull("data_apagado")
        .where("id", id);

    if (contar_utilizacoes)
        query.select(
            knex.raw("(SELECT count(*) FROM cartao WHERE cartao.produto = produto.id) as contagem_cartoes"),
            knex.raw(`(SELECT count(*) FROM pedido_cartoes where JSON_CONTAINS(produtos_pedido, CONCAT('{"id_produto": "', produto.id,'"}'))) as contagem_pedidos`)
        );

    let produto = await db.knexOne(query);

    if (!produto)
        throw {code: 404, message: "Produto não encontrado"};

    produto.quantidades = produto.quantidades.split(",").map(Number);

    return produto;
}

module.exports.obterProdutoCodigo = async (db, codigo) => {
    let produto = await db.knexOne(knex("produto").where("codigo", codigo).whereNull("data_apagado"));
    if (!produto)
        return null;
    return this.obterProduto(db, produto.id);
}

module.exports.criarProduto = async (req, detalhes) => {
    if (await this.obterProdutoCodigo(req.db, detalhes.codigo))
        throw {code: 400, message: "Já existe um produto com o código indicado"};

    await req.db.knex(knex("produto").insert({
        codigo: detalhes.codigo,
        nome: detalhes.nome,
        quantidades: detalhes.quantidades.map(Number).join(","),
        posicao: detalhes.posicao,
        ativado: detalhes.ativado,
        site: req.session.user_site
    }));
}

module.exports.editarProduto = async (db, id, detalhes) => {
    let produto = await this.obterProduto(db, id);

    await db.knex(knex("produto").where("id", produto.id)
        .update({
            codigo: detalhes.codigo,
            nome: detalhes.nome,
            quantidades: detalhes.quantidades.map(Number).join(","),
            posicao: detalhes.posicao,
            ativado: detalhes.ativado
        }));
}

module.exports.apagarProduto = async (db, id) => {
    let produto = await this.obterProduto(db, id, true);
    // Verificar se o produto já está a ser utilizado por algum cartão ou pedido
    if (produto.contagem_cartoes > 0 || produto.contagem_pedidos > 0)
        throw {code: 400, message: "O produto está a ser utilizado por um ou mais cartões ou pedidos"};

    await db.knex(knex("produto").where("id", produto.id).del());
}

module.exports.obterCartaoAtualizarDados = async (db, numero_sim, numero_telemovel, data_ativacao) => {
    let cartao = await db.knex(knex("cartao")
        .where("sim", numero_sim)
        .orWhere("num_telemovel", numero_telemovel));
    let cartao_sim = cartao.find(c => c.sim === "" + numero_sim);
    if (cartao_sim) {
        // Registar data de ativação
        if (!cartao_sim.data_ativacao) {
            await db.knex(knex("cartao").where("id", cartao_sim.id).update({
                data_ativacao: data_ativacao
            }));
            cartao_sim.data_ativacao = new Date();
        }

        // Encontrou um cartão com o mesmo SIM. Tem o mesmo telemóvel?
        if (cartao_sim.num_telemovel === numero_telemovel) {
            return cartao_sim;
        } else {
            // Não tem o mesmo telemóvel, confirmar que telemóvel não está associado a outro vendedor e atualizar telemóvel
            let cartao_telemovel = cartao.find(c => c.num_telemovel === numero_telemovel);
            if (!cartao_telemovel) {
                await db.knex(knex("cartao").where("id", cartao_sim.id).update({
                    num_telemovel: numero_telemovel,
                }));
                cartao_sim.num_telemovel = numero_telemovel;
                return cartao_sim;
            } else {
                // Telemóvel já está associado a outro cartão, mesmo assim registar movimento no SIM encontrado.
                return cartao_sim;
                /**
                 if (cartao_telemovel.vendedor === cartao_sim.vendedor) {
                    console.log("MIGRAR CARTAO", cartao_telemovel, cartao_sim);
                    // Cartão com o mesmo telemóvel encontrado, e está associado ao mesmo vendedor.
                    // Migrar movimentos
                    await db.knex(knex("movimento_cartao").where("cartao", cartao_telemovel.id).update({
                        cartao: cartao_sim.id
                    }));
                    // Atualizar cartão e
                    await db.knex(knex("cartao").where("id", cartao_sim.id).update({
                        num_telemovel: numero_telemovel
                    }));
                    // Remover cartão antigo
                    await db.knex(knex("cartao").where("id", cartao_telemovel.id).del());
                    cartao_sim.num_telemovel = numero_telemovel;
                    return cartao_sim;
                }
                 throw {code: 500, message: `O número de telemóvel não corresponde a este SIM e está associado a outro vendedor. SIM: ${numero_sim}, Telemovel: ${numero_telemovel}`};
                 **/
            }
        }
    }
    throw {message: "Cartão não encontrado", code: 404};
}