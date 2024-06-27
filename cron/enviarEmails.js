const cron = require('node-cron');
let {knex, getConnection} = require("../mysql");
let Email = require("../email");

let estaAEnviar = false;

// Todos os minutos
cron.schedule('* * * * *', async function () {
    console.debug("[CRON] enviarEmails");

    if (estaAEnviar)
        return;
    estaAEnviar = true;

    try {
        // verificar se existem emails para enviar a cada minuto
        let DB = await getConnection();

        let query = knex("fila_email")
            .select("*")
            .whereNull("erros")
            .limit(500);

        let emails = await DB.knex(query)

        await emails.asyncForEach(async emailFila => {
            try {
                let email = new Email(emailFila.destinatario);
                await email.send(emailFila.template, emailFila.assunto, JSON.parse(emailFila.dados));

                let queryRetirarFila = knex("fila_email")
                    .where("id", emailFila.id)
                    .delete();

                await DB.knex(queryRetirarFila);
            } catch (e) {
                console.error(e);
                let queryErro = knex("fila_email")
                    .where("id", emailFila.id)
                    .update({
                        erro: JSON.stringify(e)
                    });

                await DB.knex(queryErro);
            }
        });

        // libertar a conexão
        await DB.release();
    } catch (e) {
        console.error(e);
    }
    estaAEnviar = false;
}, {
    timezone: 'Europe/Lisbon'
});

console.log("[CRON] enviarEmails ready");