module.exports = class MyConnection {

    constructor(connection) {
        if (!connection)
            throw new Error("DB_CONN_REQUIRED");
        this.connection = connection;
    }

    select($sql, $params) {
        return new Promise(async (resolve, reject) => {
            this.connection.query($sql, $params, function (err, result) {
                if (err)
                    return reject(err);
                return resolve(result);
            });
        });
    }

    selectOne($sql, $params) {
        return new Promise(async (resolve, reject) => {
            try {
                let result = await this.select($sql, $params);
                if (result.length > 0)
                    return resolve(result[0]);
                return resolve(null);
            } catch (e) {
                reject(e);
            }
        });
    }

    query($sql, $params) {
        return new Promise(async (resolve, reject) => {
            this.connection.query($sql, $params, function (err, result) {
                if (err)
                    return reject(err);
                return resolve(result);
            });
        });
    }

    knex($knex) {
        let query = $knex.toSQL();
        return this.query(query.sql, query.bindings);
    }

    knexOne($knex) {
        let query = $knex.toSQL();
        return this.selectOne(query.sql, query.bindings);
    }

    async startTransaction() {
        await this.connection.query("SET autocommit=0");
        await this.connection.query("START TRANSACTION");
    }

    async commit() {
        await this.connection.query("COMMIT");
    }

    async rollback() {
        await this.connection.query("ROLLBACK");
    }

    async release() {
        await this.connection.query("SET autocommit = 1");
        await this.connection.release();
    }
};