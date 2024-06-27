module.exports = class DatabaseException {

    constructor(message, code, query) {
        this.message = message;
        this.code = code;
        this.query = query;
    }

    getMessage() {
        return this.message;
    }

    getCode() {
        return this.code;
    }

    getQuery() {
        return this.query;
    }

};