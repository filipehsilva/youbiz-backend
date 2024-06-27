const DocumentoExcel = require("../misc/documento_excel");
const excel = require("exceljs");

async function gerarExcel(nomeFicheiro, registos, extra = {}) {
    const conf = {
        meses: {
            id: "ID",
            designacao: "Designação",
            data_inicio: "Data de início",
            data_fim: "Data de fim",
            fornecedor: "Fornecedor",
            comissoes: "Comissões",
            premios: "Prémios",
            co: "C.O",
            da: "D.A",
            data_criacao: "Data de criação",
            data_fechado: "Data de fechado",
            site: "ID de Negócio",
        },
        pagamentos: {
            id: "ID do Pagamento",
            mes_designacao: "Mês",
            nif: "NIF",
            utilizador_nome: "Nome do Colaborador",
            utilizador_id: "Id do Colaborador",
            patamar: "Patamar do Colaborador",
            valor_comissao: "Comissão",
            valor_premio: "Prémios",
            valor_despesas_administrativas: "D.A.",
            valor_custos_operacionais: "D.O.",
            percentagem_impostos: "% Impostos",
            valor_impostos: "Impostos",
            percentagem_retencao: "% Retenção",
            valor_retencao: "Retenção",
            valor_a_pagar: "Total a pagar",
            estado: "Estado",
            metodo_pagamento: "Método de pagamento",
            data_pagamento: "Data de pagamento",
            data_criacao: "Data de criação",
            site: "ID de Negócio",
            mes: "ID do Mês",
        },
        utilizadores: {
            "id": "ID do Utilizador",
            "site": "ID de Negócio",
            "email": "Email",
            "nome": "Nome",
            "telemovel": "Nº Contacto",
            "tipo": "Tipo",
            "patamar": "Patamar",
            "data_criacao": "Data de Registo",
            "data_nascimento": "Data de Nascimento",
            "morada": "Morada",
            "doc_identificacao_tipo": "Tipo de DI",
            "doc_identificacao_numero": "Número de DI",
            "doc_identificacao_emissao": "Data de Emissão DI",
            "doc_identificacao_validade": "Data de Validade DI",
            "doc_identificacao_local_emissao": "Local Emissão DI",
            "nif": "NIF",
            "iban": "IBAN",
            "notificacao_sms": {
                name: "Notificação SMS",
                formatter: (v) => v ? "Sim (" + v.toISOString() + ")" : "Não"
            },
            "notificacao_email": {
                name: "Notificação Email",
                formatter: (v) => v ? "Sim (" + v.toISOString() + ")" : "Não"
            },
            "marketing": {
                name: "Notificação Marketing",
                formatter: (v) => v ? "Sim (" + v.toISOString() + ")" : "Não"
            },
            "data_desativado": "Desativado"
        }
    };

    let aux = {};

    registos.forEach(registo => aux = {...aux, ...registo});

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet(nomeFicheiro);

    let confColunas = conf[nomeFicheiro];

    // Colunas adicionais
    confColunas = {...confColunas, ...extra};

    worksheet.columns = Object.keys(confColunas).map(coluna => {
        let name = confColunas[coluna];
        if (confColunas[coluna].name)
            name = confColunas[coluna].name;
        return {header: name, key: coluna};
    });

    let processRow = function (row) {
        let aux = {...row};
        Object.keys(confColunas).map(coluna => {
            if (confColunas[coluna].formatter)
                aux[coluna] = confColunas[coluna].formatter(aux[coluna]);
        });
        return aux;
    }

    registos.forEach(registo => worksheet.addRow(processRow(registo)));

    const xlsxBuffer = await workbook.xlsx.writeBuffer();

    return new DocumentoExcel(`${nomeFicheiro}_${new Date().toISOString().slice(0, -5).replace(/\D/g, "")}.xlsx`, xlsxBuffer);
}

module.exports = gerarExcel;
