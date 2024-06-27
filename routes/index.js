const express = require('express');
const router = express.Router();

router.use('/utilizador', require('./namespaces/utilizador'));
router.use('/cartoes', require('./namespaces/cartoes'));
router.use('/financas', require('./namespaces/financas'));
router.use('/negocio', require('./namespaces/negocio'));
router.use('/ferramentas', require('./namespaces/ferramentas'));

module.exports = router;
