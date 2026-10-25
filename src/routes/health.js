const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;
