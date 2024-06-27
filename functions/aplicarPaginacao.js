const {knex} = require("../mysql");

module.exports.aplicarPaginacao = async (db, query, opcoes = {}) => {
    opcoes.numero_resultados = Math.min(parseInt(opcoes.numero_resultados) || 10, 50);
    opcoes.pagina = Math.max(parseInt(opcoes.pagina) || 0, 0);

    let query_paginacao = query.clone();
    query_paginacao.clearSelect();
    query_paginacao.count("* as count");

    let contagem = await db.knexOne(query_paginacao);
    contagem = contagem.count;

    // Aplicar paginação ao query
    let query_paginado = query.clone();
    query_paginado.limit(opcoes.numero_resultados);
    query_paginado.offset(opcoes.pagina * opcoes.numero_resultados);

    return {
        resultados: await db.knex(query_paginado),
        paginacao: {
            paginas: Math.ceil(contagem / opcoes.numero_resultados),
            total_resultados: contagem
        }
    };
};

module.exports.paramsPaginacao = (req) => {
    return {
        numero_resultados: req.query.numero_resultados,
        pagina: req.query.pagina
    }
}