const {knex} = require("../mysql");
const {obterPatamar} = require("../models/negocio");

module.exports.obterUtilizador = async (db, id, incluir_notas = false) => {
    let utilizador = await db.knexOne(knex("utilizador").where("id", id));
    if (!utilizador)
        throw {message: "Utilizador não encontrado", code: 404};

    utilizador.patamar = await obterPatamar(db, utilizador.site, utilizador.patamar);
    utilizador.comissoes_personalizadas = !!utilizador.comissoes;
    utilizador.comissoes = utilizador.comissoes?.split(",") || utilizador.patamar.comissoes;
    utilizador.cartao_associado = await db.knexOne(knex("cartao")
        .select("cartao.*", "vendedor.nome as vendedor_nome", "cartao_vendedor.num_telemovel as vendedor_telemovel", "vendedor.id as vendedor_id")
        .leftJoin("utilizador as vendedor", function (q) {
            q.on("cartao.vendedor", "vendedor.id")
                .andOn('cartao.site', 'vendedor.site')
        }, "left")
        .leftJoin("cartao as cartao_vendedor", function (q) {
            q.on("cartao_vendedor.utilizador", "vendedor.id")
                .andOn('cartao_vendedor.site', 'vendedor.site')
        }, "left")
        .where("cartao.utilizador", utilizador.id)
        .where("cartao.site", utilizador.site));

    delete utilizador.password;
    delete utilizador.token_acesso;

    if (!incluir_notas)
        delete utilizador.notas;

    return utilizador;
};