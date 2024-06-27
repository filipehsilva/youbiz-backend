let mysql = require("mysql");

let utilizador_site = " (SELECT site from utilizador WHERE id = ?)";

const ACESSO_FUNCIONALIDADES = {
    ferramentas: {
        admin: ["admin"],
    },
    utilizador: {
        admin: ["ler.admin_site_utilizador", "pagina_inicial.admin_site_utilizador", "aceitar_colaborador.admin_site_utilizador", "editar.admin_site_utilizador", "editar_notas.admin_site_utilizador", "ler_perfil.admin_site_utilizador", "apagar.admin_site_utilizador"],
        colaborador: ["ler.utilizador_utilizador", "ler_perfil.utilizador_utilizador", "atualizar_dados_pessoais"]
    },
    cartao: {
        admin: ["ler.admin_site_cartao", "ler_pedidos.admin_site_pedidos", "criar_pedido.admin_site_utilizador", "expedir_pedido.admin_site_pedidos", "recusar_pedido.admin_site_pedidos"],
        colaborador: ["criar_pedido.utilizador_utilizador"]
    },
    produto: {
        admin: ["ler.admin_site_produto", "criar.admin_site_produto", "editar.admin_site_produto", "apagar.admin_site_produto"],
        colaborador: ["ler.colaborador_produto"]
    },
    financas: {
        admin: ["importar_report.admin_site_financas", "fechar_mes.admin_site_financas", "ler_meses.admin_site_financas", "relatorio_confrontacao"]
    },
    pagamento: {
        admin: ["ler.admin_site_pagamento", "editar.admin_site_pagamento", "marcar.admin_site_pagamento"],
        colaborador: ["ler.pagamento_utilizador"]
    },
    negocio: {
        admin: ["editar_configuracao.admin_site_negocio", "ler_configuracao.admin_site_negocio", "dashboard"]
    },
    link_util: {
        admin: ["ler.admin_site_link_util", "criar.admin_site_link_util", "editar.admin_site_link_util", "apagar.admin_site_link_util"],
        colaborador: ["ler.utilizador_link_util"]
    }
};

const FILTROS_ACESSO = {
    "admin_site_utilizador": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "utilizador",
            field: "id"
        };
    },
    "admin_site_cartao": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "cartao",
            field: "id"
        };
    },
    "admin_site_pedidos": (id_utilizador) => {
        return {
            filter: mysql.format("vendedor IN (select id from utilizador WHERE site = " + utilizador_site + ")", id_utilizador),
            table: "pedido_cartoes",
            field: "id"
        };
    },
    "admin_site_produto": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "produto",
            field: "id"
        };
    },
    "admin_site_financas": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "mes",
            field: "id"
        };
    },
    "admin_site_pagamento": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "pagamento",
            field: "id"
        };
    },
    "admin_site_negocio": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "negocio",
            field: "id"
        };
    },
    "admin_site_link_util": (id_utilizador) => {
        return {
            filter: mysql.format("site = " + utilizador_site, id_utilizador),
            table: "link_util",
            field: "id"
        };
    },
    "utilizador_utilizador": (id_utilizador) => {
        return {
            filter: mysql.format("id = ?", id_utilizador),
            table: "utilizador",
            field: "id"
        };
    },
    "pagamento_utilizador": (id_utilizador) => {
        return {
            filter: mysql.format("utilizador = ? and site = " + utilizador_site, [id_utilizador, id_utilizador]),
            table: "pagamento",
            field: "id"
        };
    },
    "colaborador_produto": (id_utilizador) => {
        return {
            filter: mysql.format("ativado = 1 AND site= " + utilizador_site, id_utilizador),
            table: "produto",
            field: "id"
        };
    },
    "utilizador_link_util": (id_utilizador) => {
        return {
            filter: mysql.format("visivel = 1 AND site= " + utilizador_site, id_utilizador),
            table: "link_util",
            field: "id"
        };
    },
};

module.exports = {
    ACESSO_FUNCIONALIDADES,
    FILTROS_ACESSO
};
