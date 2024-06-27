const {ACESSO_FUNCIONALIDADES, FILTROS_ACESSO} = require("../conf/acesso_funcionalidades");

async function obterFiltro(dbConnection, filtro, user_id, search_value) {
    let has_access = !filtro || !search_value;
    let query_filter = "1";

    if (filtro) {
        let {table, filter, field} = FILTROS_ACESSO[filtro](user_id);
        field = table + "." + field;
        query_filter = field + " IN (SELECT " + field + " FROM " + table + " WHERE (" + filter + "))";

        // Verificar acesso a um objeto específico
        if (search_value) {
            try {
                has_access = (await dbConnection.selectOne("SELECT count(" + field + ") > 0 as allowed FROM " + table + " WHERE (" + filter + ") AND " + field + " = ?", [search_value])).allowed === 1;
            } catch (e) {
                throw e;
            }
        }
    }

    return {
        has_access,
        filter_and: " AND (" + query_filter + ")",
        filter_where: " WHERE (" + query_filter + ")",
        filter: " (" + query_filter + ")",
    }
}

async function verificarAcesso(dbConnection, action, user_id, user_type, search_value, return_boolean) {
    function erro(data) {
        if (return_boolean)
            return false;
        throw {tipo_utilizador: user_type, ...data};
    }

    let tokens = action.split(".");
    let functionality = tokens[0];
    let operation = null;
    if (tokens.length > 1)
        operation = tokens[1];

    // Obter filtros e informação sobre acesso ao objeto solicitado
    let functionality_access = ACESSO_FUNCIONALIDADES[functionality];
    if (!functionality_access)
        return erro({code: 500, message: "Não foram definidas permissões para esta funcionalidade"});
    let acesso_tipo_utilizador = functionality_access[user_type];
    if (!acesso_tipo_utilizador)
        return erro({code: 403, message: "O utilizador não tem permissões para a funcionalidade '" + functionality + "'"});
    functionality_access = acesso_tipo_utilizador.find(p => p.split(".")[0] === operation);
    if (!functionality_access)
        return erro({code: 403, message: "O utilizador não tem permissões para executar a ação '" + operation + "'"});
    functionality_access = functionality_access.split(".");
    let filter = functionality_access.length > 1 ? functionality_access[1] : null;

    let result = await obterFiltro(dbConnection, filter, user_id, search_value);

    //Verificar se utilizador tem acesso
    if (return_boolean)
        return result.has_access;
    if (result.has_access) {
        return {
            tipo_utilizador: user_type,
            filters: {
                and: result.filter_and,
                where: result.filter_where,
                filter: result.filter
            }
        };
    } else {
        console.log(result);
        return erro({
            code: 403,
            message: "O utilizador tem permissões para executar a ação '" + action + "', mas não no objeto " + search_value,
            filtro_sql: result.filter,
            filtro: filter
        });
    }
}

/* *
 *  Função que verifica se um utilizador tem permissões para efetuar uma determinada ação
 *
 *  Recebe uma ação na forma de funcionalidade.acao e um parâmetro opcional que corresponde
 *  a onde o identificador do objeto a que se quer aceder pode ser encontrado no request.
 *  Ex: Se a ação for espaco.ler e o endpoint for espaco/:id_espaco, o parâmetro opcional deverá ser params.id_espaco
 *
 * */

function validarPermissao(action, optional_value_param) {
    let optional_param_location;
    let optional_param_key;

    if (optional_value_param)
        [optional_param_location, optional_param_key] = optional_value_param.split(".");

    return async function (req, res, next) {
        let releaseDB = () => {
            //Libertar conexão à DB
            if (req.db)
                req.db.release();
        };
        if (!req.session.user_id) {
            res.status(401);
            res.json({code: 401, message: "UNAUTHORIZED"});
            releaseDB();
            return;
        }
        try {
            let optional_value = null;
            if (optional_value_param)
                optional_value = req[optional_param_location][optional_param_key];

            try {
                let access = await verificarAcesso(req.db, action, req.session.user_id, req.session.user_type, optional_value);

                //Guardar filtros para utilizar mais tarde
                req.filtro_acesso = access.filters;
                req.db.filtro_acesso = access.filters.filter;

                next();
            } catch (e) {
                res.status(e.code || 500);
                res.json({
                    code: e.code || 500,
                    message: e.message,
                    ...e
                });
                releaseDB();
            }
        } catch (e) {
            console.error(e);
        }
    }
};

module.exports = {validarPermissao, verificarAcesso};