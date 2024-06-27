const cron = require('node-cron');
let {knex, getConnection} = require("../mysql");

// Todos os dias às 8h00
cron.schedule('0 8 * * *', async function () {
    console.debug("[CRON] expirarPagamentos");

    try {
        // verificar se existem emails para enviar a cada minuto
        let DB = await getConnection();
        await DB.startTransaction();

        try {
            let query = knex("pagamento")
                .where("estado", "aguarda_recibo")
                .andWhereRaw("DATE_ADD(data_fechado, INTERVAL 2 YEAR) < now()")
                .update({
                    estado: "caducado"
                })
            let res = await DB.knex(query);
            await DB.commit();

            console.log("[CRON] expirarPagamentos expirou ", res.affectedRows, " pagamentos")
        } catch (e) {
            console.error(e);
            await DB.rollback();
        }

        // Libertar a conexão
        await DB.release();
    } catch (e) {
        console.error(e);
    }
}, {
    timezone: 'Europe/Lisbon'
});

console.log("[CRON] expirarPagamentos ready");