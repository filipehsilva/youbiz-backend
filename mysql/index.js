const mysql = require('mysql');
const knex = require('knex')({
    client: 'mysql'
});

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: process.env.MYSQL_TIMEZONE
});

const MyConnection = require("./connection");

function getConnection() {
    return new Promise(function (resolve, reject) {
        pool.getConnection(function (err, connection) {
            if (err)
                return reject(err);
            return resolve(new MyConnection(connection));
        });
    });
}

module.exports = {
    listen: async function (req, res, next) {
        try {
            // Save db on req
            req.db = await getConnection();
            await req.db.startTransaction();
            next();
        } catch (e) {
            return res.status(500).json({message: "MYSQL_CONN_ERROR" + ": " + e.message, code: 500});
        }
    },
    getConnection,
    knex
};