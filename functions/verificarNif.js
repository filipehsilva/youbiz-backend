function verificarNif(nif) {
    if (!['1', '2', '3', '5', '6', '8'].includes(nif.substr(0, 1)) &&
        !['45', '70', '71', '72', '77', '79', '90', '91', '98', '99'].includes(nif.substr(0, 2)))
        return false;

    let total = nif[0] * 9 + nif[1] * 8 + nif[2] * 7 + nif[3] * 6 + nif[4] * 5 + nif[5] * 4 + nif[6] * 3 + nif[7] * 2;

    let modulo11 = total - parseInt(total / 11) * 11;
    let comparador = modulo11 == 1 || modulo11 == 0 ? 0 : 11 - modulo11;

    return nif[8] == comparador
}

module.exports = verificarNif;