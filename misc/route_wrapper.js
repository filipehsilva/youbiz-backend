const {validationResult} = require('express-validator');
const DocumentoExcel = require("./documento_excel");
const Ficheiro = require("./ficheiro");

module.exports = function (route) {
    return [
        async function (req, res, next) {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                let phrase = '';
                [...errors.array()].forEach((el, idx, array) => {
                    phrase += el.msg;
                    if (idx !== array.length - 1) {
                        phrase += ', ';
                    }
                });
                if (req.db) req.db.release();
                return res.status(400).json({
                    message: phrase,
                    code: 400,
                    erros: errors.array()
                });
            }

            next();
        },
        async function (req, res, next) {
            try {
                let result = await route(req);

                if (result instanceof Ficheiro) {
                    // Commit DB changes
                    if (req.db)
                        await req.db.commit();

                    res.header('Content-disposition', (result.download ? "attachment" : "inline") + '; filename=' + result.nomeFicheiro);
                    res.header('Content-Type', result.mimetype);

                    res.send(result.buffer);
                } else if (result instanceof DocumentoExcel) {
                    // Commit DB changes
                    if (req.db)
                        await req.db.commit();

                    res.header('Content-disposition', 'attachment; filename=' + result.nomeFicheiro);
                    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

                    res.send(result.buffer);
                } else {
                    if (typeof result === 'undefined' || typeof result === 'boolean')
                        result = {};
                    if (typeof result === 'string')
                        result = {message: result};
                    if (typeof result.success === 'undefined')
                        result.success = true;


                    // Commit DB changes
                    if (req.db)
                        await req.db.commit();

                    res.json(result);
                }
            } catch (e) {
                if (e.stack) {
                    let location = e.fileName ? (e.fileName + ":" + e.lineNumber + ":" + e.columnNumber) : null;
                    e = {
                        name: e.name,
                        message: e.message,
                        stack: e.stack
                    };
                    if (location)
                        e.location = location;
                }
                if (typeof e === 'string')
                    e = {message: e};
                if (typeof e === 'undefined')
                    e = {};

                let error = e;
                error.success = false;

                let statusCode = isNaN(e.code) ? 500 : parseInt(error.code);
                error.code = statusCode;

                res.status(statusCode);

                if (e.message)
                    error.message = e.message;
                if (statusCode === 500)
                    console.error(e);

                // Rollback DB changes
                if (req.db)
                    await req.db.rollback();

                res.json(error);
            }

            // Release connection to pool
            if (req.db)
                req.db.release();
        }
    ];
};