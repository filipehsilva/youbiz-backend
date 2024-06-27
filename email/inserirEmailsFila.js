const {knex} = require("../mysql");

module.exports.inserirEmailsFila = async (DB, template, Emails) => {
    let query = knex("fila_email")
        .insert(Emails.map(email => ({
            destinatario: email.destinatario,
            assunto: email.assunto,
            template: template,
            dados: JSON.stringify(email.dados)
        })));

    return await DB.knex(query);
}