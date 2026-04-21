const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getAuthUrl, exchangeCode, getConnectionStatus } = require('../services/gmailService');
const { runEmailSync, runSheetsExport } = require('../services/cronService');
const { importDealsFromSheet } = require('../services/sheetsService');

const router = express.Router();

// GET /api/gmail/auth-url  — generate OAuth consent URL
router.get('/auth-url', requireAuth, (req, res) => {
  const url = getAuthUrl(req.user.id);
  res.json({ url });
});

// GET /api/gmail/callback  — Google redirects here after consent
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    return res.redirect(`${frontendUrl}/dashboard?gmail=error&reason=${error}`);
  }

  try {
    const userId = parseInt(state, 10);
    await exchangeCode(code, userId);
    res.redirect(`${frontendUrl}/dashboard?gmail=connected`);
  } catch (err) {
    console.error('Gmail callback error:', err);
    res.redirect(`${frontendUrl}/dashboard?gmail=error&reason=exchange_failed`);
  }
});

// GET /api/gmail/status  — check connection and last sync info
router.get('/status', requireAuth, async (req, res) => {
  const connection = await getConnectionStatus(req.user.id);
  const { rows: lastSync } = await pool.query(
    `SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1`
  );
  res.json({ connection, lastSync: lastSync[0] || null });
});

// POST /api/gmail/sync  — manual trigger
router.post('/sync', requireAuth, async (req, res) => {
  const connection = await getConnectionStatus(req.user.id);
  if (!connection) {
    return res.status(400).json({ error: 'Gmail not connected. Visit /api/gmail/auth-url first.' });
  }

  // Fire async — respond immediately
  res.json({ message: 'Sync started' });
  runEmailSync().catch((err) => console.error('Manual sync error:', err));
});

// POST /api/gmail/sheets-export — manual trigger
router.post('/sheets-export', requireAuth, async (req, res) => {
  res.json({ message: 'Sheets export started' });
  runSheetsExport().catch((err) => console.error('Manual sheets export error:', err));
});

// POST /api/gmail/sheets-import — one-time historical import
router.post('/sheets-import', requireAuth, async (req, res) => {
  try {
    const result = await importDealsFromSheet();
    res.json(result);
  } catch (err) {
    console.error('Sheets import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/gmail/disconnect
router.delete('/disconnect', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM gmail_tokens WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'Gmail disconnected' });
});

module.exports = router;
