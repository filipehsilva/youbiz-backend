const {knex} = require("../mysql");

module.exports.verificarCamposUnicos = async (DB, tabela, excluir, valores, mensagem) => {
    if (Object.values(valores).filter(v => v).length === 0)
        return;
    let query = knex(tabela);
    query.whereNot(excluir);
    query.where(function () {
        Object.keys(valores).forEach(chave => {
            if (valores[chave])
                this.orWhere(chave, valores[chave]);
        });
    });
    query.limit(1);
    if (await DB.knexOne(query))
        throw {code: 400, message: mensagem};
};