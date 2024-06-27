const nodemailer = require('nodemailer');

exports.transport = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    requireTLS: true,
    auth: {
        user: process.env.EMAIL_SERVICE_USERNAME,
        pass: process.env.EMAIL_SERVICE_PASSWORD
    }
});
