const express = require('express');
const cors = require('cors');
const fileUpload = require("express-fileupload");
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

// Add custom functions
require("./misc/async_foreach");

// Setup env variables
const dotenv = require('dotenv');
dotenv.config();

// Configurar CORS para permitir requisições de https://plataforma.youbiz.pt
const corsOptions = {
    origin: process.env.CORS_ORIGIN,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // se você precisar enviar cookies ou autenticação
    optionsSuccessStatus: 204 // para suportar navegadores mais antigos
};

let app = express();

app.set('trust proxy', 1);

app.use(cors(corsOptions));

const session = require('express-session');
const FileStore = require('session-file-store')(session);

// Verifica se o diretório de sessões existe, caso contrário, cria
const sessionDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionDir)) {
    console.log(`Criando diretório de sessões em ${sessionDir}`);
    fs.mkdirSync(sessionDir, { recursive: true });
} else {
    console.log(`Diretório de sessões já existe em ${sessionDir}`);
}

const store = new FileStore({
    path: sessionDir,
    ttl: 3600 * 24 * 365,
});

store.on('error', function(error) {
    console.log('Erro no FileStore:', error);
});

app.use(session({
    store: store,
    cookie: {
        secure: true,
        sameSite: 'none'
    },
    secret: '1d37e555-085f-4044-b942-7c521a326d8e',
    resave: false,
    saveUninitialized: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(require('cookie-parser')());
app.use(
    fileUpload({
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
        parseNested: true,
        safeFileNames: true,
        abortOnLimit: true
    })
);

// Logs
app.use(morgan('[:date[iso]] :remote-addr :method :url :status :response-time ms - :res[content-length]'));
require('log-timestamp');

// Middleware para log de cookies e sessão
app.use((req, res, next) => {
    console.log(`Cookies recebidos: ${JSON.stringify(req.cookies)}`);
    console.log(`Sessão atual: ${JSON.stringify(req.session)}`);
    next();
});

app.use("/public", express.static("public"));

// Attach database connection to all requests
const Mysql = require('./mysql');
app.use(Mysql.listen);

// Setup routes
app.use('/', require("./routes"));

// catch 404 and forward to error handler
app.use(require("./misc/route_wrapper")(() => {
    throw { code: 404, message: "ROUTE_NOT_FOUND" };
}));

// Setup cron
require("./cron/expirarPagamentos");

module.exports = app;
