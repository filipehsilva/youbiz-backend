const {obterMesAberto, obterMesFechado, obterDataUltimoMovimento, obterComissoes} = require("./financas");
const {knex} = require("../mysql");
const moment = require("moment");
const {TIPO_UTILIZADOR} = require("../conf/consts");
const {aplicarPaginacao, paramsPaginacao} = require("../functions/aplicarPaginacao");

async function ranking(req) {
    let ano = parseInt(req.query.ano);
    let mes = parseInt(req.query.mes);

    let data_inicio = moment().year(ano || 2014).startOf("year");
    let data_fim = moment().year(ano || new Date().getFullYear()).endOf("year");
    if (!isNaN(mes)) {
        data_inicio.month(mes - 1)
        data_fim.month(mes - 1)
    }
    data_inicio = data_inicio.startOf("month").format("YYYY-MM-DD");
    data_fim = data_fim.endOf("month").format("YYYY-MM-DD");

    function filterData(campo) {
        if (!isNaN(ano)) {
            if (!isNaN(mes)) {
                return knex.raw(`YEAR(${campo}) = ${ano} AND MONTH(${campo}) = ${mes}`);
            } else {
                return knex.raw(`YEAR(${campo}) = ${ano}`);
            }
        }
        return knex.raw("1");
    }

    let ultimos_pedidos = knex("pedido_cartoes")
        .select(knex.raw("coalesce(produtos_expedicao, produtos_pedido) as pedido"), "pedido_cartoes.vendedor", "pedido_cartoes.data_criacao")
        .join(knex("pedido_cartoes")
            .select(knex.raw("max(id) as id"), "vendedor")
            .groupBy("vendedor")
            .as("max"), "max.id", "pedido_cartoes.id")
        .as("ultimos_pedidos");

    let cartoes = knex("cartao")
        .select(knex.raw("count(*) as cartoes"), "vendedor")
        .where("cartao.site", req.session.user_site)
        .where("cartao.data_criacao", ">=", data_inicio)
        .where("cartao.data_criacao", "<=", data_fim)
        .whereRaw(filterData('cartao.data_criacao'))
        .groupBy("vendedor")
        .as("cartoes");

    let produtos_ativados = knex.select(knex.raw("group_concat(tabela.produto) as produtos_ativados"), "vendedor", knex.raw("sum(tabela.contagem_produto) as total"))
        .from(knex("cartao")
            .select(knex.raw("JSON_OBJECT('produto', produto.nome, 'contagem', count(*)) as  produto"), "vendedor", knex.raw("count(*) as contagem_produto"))
            .join("produto", "produto.id", "cartao.produto")
            .where("cartao.site", req.session.user_site)
            .whereNotNull("data_ativacao")
            .where("cartao.data_ativacao", ">=", data_inicio)
            .where("cartao.data_ativacao", "<=", data_fim)
            .whereRaw(filterData('cartao.data_ativacao'))
            .groupBy("cartao.vendedor").groupBy("cartao.produto").as("tabela"))
        .groupBy("tabela.vendedor")
        .as("produtos_ativados");

    let query = knex("utilizador")
        .select("nome", "numero_colaborador", "id",
            "ultimos_pedidos.pedido", "ultimos_pedidos.data_criacao as data_ultimo_pedido",
            "produtos_ativados.total as ativacoes", "cartoes.cartoes",
            "produtos_ativados.produtos_ativados"
        )
        .leftJoin(ultimos_pedidos, "ultimos_pedidos.vendedor", "utilizador.id")
        .leftJoin(cartoes, "cartoes.vendedor", "utilizador.id")
        .join(produtos_ativados, "produtos_ativados.vendedor", "utilizador.id")
        .where("site", req.session.user_site)
        .where("tipo", TIPO_UTILIZADOR.COLABORADOR)
        .orderBy('produtos_ativados.total', "desc")

    req.query.numero_resultados = Math.min(parseInt(req.query.numero_resultados) || 10, 50);
    req.query.pagina = Math.max(parseInt(req.query.pagina) || 0, 0);

    let paginado = req.query.numero_resultados > 0 ?
        await aplicarPaginacao(req.db, query, paramsPaginacao(req))
        : {resultados: await req.db.knex(query)};

    let i = 0;
    for (let resultado of paginado.resultados || paginado) {
        resultado.produtos_ativados = JSON.parse("[" + resultado.produtos_ativados + "]");
        resultado.pedido = JSON.parse(resultado.pedido);
        resultado.posicao = ++i + req.query.pagina * Math.max(0, req.query.numero_resultados);
    }
    return paginado;
}

module.exports.obterDashboard = async (req, seccao) => {
    let stats;
    switch (seccao) {
        case 'geral':
            let mes_aberto = await obterMesAberto(req.db, req.session.user_site);
            let ultima_atualizacao = await obterDataUltimoMovimento(req)
            let dias_passados_mes = Math.max(1, moment(ultima_atualizacao).diff(mes_aberto.data_inicio, "days"));
            let dias_mes = moment(mes_aberto.data_inicio).daysInMonth();
            return {
                ultima_atualizacao,
                mes_aberto,
                estatisticas_mes_aberto: {
                    novos_colaboradores: (await req.db.knexOne(knex("utilizador")
                        .count("* as contagem")
                        .whereNull("data_desativado")
                        .where("tipo", "colaborador")
                        .whereRaw("data_aprovacao LIKE DATE_FORMAT(?, '%Y-%m-%')", mes_aberto.data_inicio))).contagem,
                    valor_carregamento: mes_aberto.fornecedor,
                    a_pagar: (await obterComissoes(req, mes_aberto.id) / dias_passados_mes) * dias_mes,
                    a_pagar_anterior: (await obterMesFechado(req.db, req.session.user_site)).total_a_pagar
                },
                estatisticas_ano: {
                    novos_colaboradores: (await req.db.knexOne(knex("utilizador")
                        .count("* as contagem")
                        .whereNull("data_desativado")
                        .where("tipo", "colaborador")
                        .whereRaw("YEAR(data_aprovacao) = YEAR(NOW())"))).contagem,
                    valor_carregamento: (await req.db.knexOne(knex("mes")
                        .sum("fornecedor as total")
                        .whereRaw("YEAR(data_inicio) = YEAR(NOW())"))).total,
                    a_pagar: (await req.db.knexOne(knex("mes")
                        .sum("total_a_pagar as total")
                        .whereRaw("YEAR(data_inicio) = YEAR(NOW())"))).total,
                    a_pagar_anterior: (await req.db.knexOne(knex("mes")
                        .sum("total_a_pagar as total")
                        .whereRaw("YEAR(data_inicio) = YEAR(NOW()) - 1"))).total,
                }
            }
        case 'colaboradores':
            return await req.db.knex(knex("utilizador")
                .select(knex.raw("count(*) as contagem"), "patamar.codigo as codigo_patamar")
                .join("patamar", "patamar.id", "utilizador.patamar")
                .whereNull("data_desativado")
                .where("tipo", "colaborador")
                .groupBy("utilizador.patamar")
            )
        case 'clientes':
            stats = await req.db.knex(knex("cartao").select(knex.raw("count(*) as contagem"), knex.raw("YEAR(data_ativacao) = YEAR(NOW()) as ano_atual")).whereNotNull("data_ativacao").groupByRaw("YEAR(data_ativacao) = YEAR(NOW())"))
            return {
                ano: stats.find(s => s.ano_atual)?.contagem || 0,
                total: stats.reduce((acc, s) => acc + s.contagem, 0) || 0
            }
        case 'cartoes':
            return {
                enviados_ano_atual: (await req.db.knexOne(knex("cartao").select(knex.raw("count(*) as contagem")).whereRaw("YEAR(data_ativacao) = YEAR(NOW())"))).contagem,
                pedidos_ano_atual: (await req.db.knexOne(knex("pedido_cartoes").select(knex.raw("count(*) as contagem")).whereRaw("YEAR(data_criacao) = YEAR(NOW())"))).contagem,
                enviados_ano_anterior: (await req.db.knexOne(knex("cartao").select(knex.raw("count(*) as contagem")).whereRaw("YEAR(data_ativacao) = YEAR(NOW()) - 1"))).contagem,
                pedidos_ano_anterior: (await req.db.knexOne(knex("pedido_cartoes").select(knex.raw("count(*) as contagem")).whereRaw("YEAR(data_criacao) = YEAR(NOW()) - 1"))).contagem
            }
        case 'ranking':
            return await ranking(req);
    }
}