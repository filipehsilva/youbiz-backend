const express = require('express');
const fileUpload = require("express-fileupload");
const morgan = require('morgan');
const cors = require('cors');

//Add custom functions
require("./misc/async_foreach");

// Setup env variables
const dotenv = require('dotenv');
dotenv.config();

const corsOptions = {
    origin: 'https://plataforma.youbiz.pt',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Permite enviar cookies e credenciais
    optionsSuccessStatus: 204 // Para suportar navegadores mais antigos
};

let app = express();

app.set('trust proxy', 1);

app.use(cors(corsOptions));

let session = require('express-session');
app.use(session({
    store: new (require('session-file-store')(session))({
        ttl: 3600 * 24 * 365,
    }),
    cookie: {
        sameSite: 'none',
        secure: true
    },
    secret: '1d37e555-085f-4044-b942-7c521a326d8e',
    resave: true,
    proxy: true,
    saveUninitialized: false
}));

app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(require('cookie-parser')());
app.use(
    fileUpload({
        limits: {fileSize: 10 * 1024 * 1024}, // 10MB
        parseNested: true,
        safeFileNames: true,
        abortOnLimit: true
    })
);

// Logs
app.use(morgan('[:date[iso]] :remote-addr :method :url :status :response-time ms - :res[content-length]'));
require('log-timestamp');

app.use("/public", express.static("public"));

// Attach database connection to all requests
const Mysql = require('./mysql');
app.use(Mysql.listen);

// Setup routes
app.use('/', require("./routes"));

// catch 404 and forward to error handler
app.use(require("./misc/route_wrapper")(() => {
    throw {code: 404, message: "ROUTE_NOT_FOUND"};
}));

// Setup cron
require("./cron/expirarPagamentos");

module.exports = app;