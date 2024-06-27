const htmlToText = require('html-to-text');
const juice = require('juice');
const CryptoJS = require('crypto-js');
const Handlebars = require('handlebars');
const fs = require('fs');
const util = require('util');

const {transport} = require('./transport');

const readFile = util.promisify(fs.readFile);

const templates = {};

Handlebars.registerHelper('breaklines', function (text) {
  text = Handlebars.Utils.escapeExpression(text);
  text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
  return new Handlebars.SafeString(text);
});

module.exports = class Email {
  constructor(email) {
    this.to = process.env.EMAIL_INTERCEPT || email;
    this.from = `Youbiz <${process.env.EMAIL_FROM}>`;
  }

  // Send the actual email
  async send(template, subject, data = {}, imagens = {}) {
    // Cache template renderer
    if (!templates[template]) {
      let hbs = await readFile(`${__dirname}/templates/${template}.hbs`, 'utf8');
      templates[template] = Handlebars.compile(hbs);
    }

    // Generate images CID
    let imagensAttach = [{
      filename: 'logo.png',
      path: `${__dirname}/logo.png`,
      cid: `${CryptoJS.MD5(`${__dirname}/logo.png`)}`
    }];

    let imagensOptions = {
      APP_LOGO: `cid:${CryptoJS.MD5(`${__dirname}/logo.png`)}`
    };

    let _template = templates[template];

    const html = _template({
      APP_URL: process.env.URL_FRONT_END,
      ...imagensOptions,
      ...data
    });

    // Define email options
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html: juice(html),
      text: htmlToText.fromString(html),
      attachments: imagensAttach
    };

    // Send email
    await transport.sendMail(mailOptions);
  }

  async enviarResetPasswordEmail(nome, url_confirmacao) {
    await this.send('recuperacao_password', 'Recuperação de Password', {
      nome: nome,
      url: url_confirmacao,
    });
  }
};
