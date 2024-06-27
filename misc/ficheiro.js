function Ficheiro(nomeFicheiro, mimetype, buffer, force_download) {
    this.nomeFicheiro = nomeFicheiro;
    this.mimetype = mimetype;
    this.buffer = buffer;
    this.download = force_download;
}

module.exports = Ficheiro;