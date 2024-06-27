const {knex} = require("../mysql");
const {aplicarFiltroPesquisa} = require("../functions/aplicarFiltroPesquisa");
const {aplicarPaginacao} = require("../functions/aplicarPaginacao");

module.exports.detalhesSite = async (db, id) => {
    let site = await db.knexOne(knex("site").where("id", id));
    if (!site)
        throw {message: "Site não encontrado", code: 404};

    site.configuracoes = JSON.parse(site.configuracoes);

    site.patamares = (await this.obterPatamares(db, site.id)).filter(patamar => patamar.id !== 0);

    return site;
}

module.exports.editarSite = async (db, id, dados_novos) => {
    let site = await this.detalhesSite(db, id);

    let update = {
        nib: dados_novos.nib,
        base_despesas_administracao: dados_novos.base_despesas_administracao,
        taxa_iva_relatorio: dados_novos.taxa_iva_relatorio
    }

    await db.knex(knex("site").where("id", site.id).update(update));

    for (let patamar of dados_novos.patamares) {
        await this.atualizarPatamar(db, site.id, patamar.id, patamar.limiar_atribuicao, patamar.comissoes);
    }
}

module.exports.obterPatamar = async (db, id_site, id) => {
    let patamar = await db.knexOne(knex("patamar")
        .select("*", knex.raw("id = (select id from patamar where site=? ORDER by limiar_atribuicao desc limit 1) as ultimo", id_site))
        .where("id", id));
    if (!patamar)
        throw {message: "Patamar não encontrado", code: 404};

    patamar.comissoes = patamar.comissoes.split(",").map(Number);

    return patamar;
}

module.exports.obterPatamares = async (db, id_site) => {
    let patamares = await db.knex(knex("patamar")
        .select("*", knex.raw("id = (select id from patamar as p2 where patamar.site=p2.site ORDER by limiar_atribuicao desc limit 1) as ultimo"))
        .where("site", id_site));

    for (let patamar of patamares)
        patamar.comissoes = patamar.comissoes.split(",").map(Number);

    return patamares;
}

module.exports.obterPatamarLimiar = async (db, id_site, numero_carregamentos) => {
    let id = await db.knexOne(knex("patamar")
        .where("site", id_site)
        .where("limiar_atribuicao", "<=", numero_carregamentos)
        .orderBy("limiar_atribuicao", "desc").limit(1));

    return await this.obterPatamar(db, id_site, id.id);
}

module.exports.atualizarPatamar = async (db, id_site, id, limiar_atribuicao, comissoes) => {
    let patamar = await this.obterPatamar(db, id_site, id);

    if (isNaN(limiar_atribuicao) || limiar_atribuicao < 0)
        throw {message: "Limiar de atribuição inválido", code: 400};

    for (let comissao of comissoes)
        if (isNaN(comissao))
            throw {message: "Comissão inválida", code: 400};

    comissoes = comissoes.map(Number);
    let comissoes_novas = comissoes.join(",");

    await db.knex(knex("patamar").where("id", patamar.id).update({
        limiar_atribuicao: limiar_atribuicao,
        comissoes: comissoes_novas
    }));

    // Atualizar comissões na árvore de equipa
    await comissoes.asyncForEach(async (comissao, idx) => {
        if (comissao !== patamar.comissoes[idx]) {
            await db.knex(knex("equipa_utilizador")
                .join("utilizador", "equipa_utilizador.utilizador", "utilizador.id")
                .whereNull("utilizador.comissoes")
                .where("utilizador.patamar", patamar.id)
                .where("equipa_utilizador.nivel", idx + 1)
                .update({percent_comissao: comissao / 100}));
        }
    })

    // Restantes comissões devem ser zero
    if (comissoes.length < patamar.comissoes.length)
        await db.knex(knex("equipa_utilizador")
            .join("utilizador", "equipa_utilizador.utilizador", "utilizador.id")
            .whereNull("utilizador.comissoes")
            .where("utilizador.patamar", patamar.id)
            .where("equipa_utilizador.nivel", ">", comissoes.length)
            .update({percent_comissao: 0}));
}