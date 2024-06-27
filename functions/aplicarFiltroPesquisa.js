const {knex} = require("../mysql");

module.exports.aplicarFiltroPesquisa = (campos_pesquisa, filtro, query, apenas_inicio = true) => {
    // Limpeza de filtro de pesquisa (mantém apenas letras e números, e remove espaços duplicados
    // filtro = filtro.replace(/[^a-zA-Z0-9]+/g, " ");
    apenas_inicio = apenas_inicio ? " " : "";
    filtro.split(" ").forEach((token) => {
        query.where(knex.raw('CONCAT("' + apenas_inicio + '", COALESCE(' + campos_pesquisa.join(', ""), "' + apenas_inicio + '", COALESCE(') + ', "' + apenas_inicio + '"))'), "LIKE", "%" + apenas_inicio + token + "%")
    });
};