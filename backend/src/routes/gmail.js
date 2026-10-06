const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getAuthUrl, exchangeCode, getConnectionStatus, getAuthenticatedClient, fetchPitchEmailById } = require('../services/gmailService');
const { runEmailSync, runSheetsExport } = require('../services/cronService');
const { importDealsFromSheet } = require('../services/sheetsService');

const router = express.Router();

// POST /api/gmail/debug-trigger — trigger sync without auth (temporary)
router.post('/debug-trigger', (req, res) => {
  res.json({ message: 'Sync triggered' });
  runEmailSync().catch((err) => console.error('debug-trigger error:', err));
});

// GET /api/gmail/debug-recent — show skipped email subjects + deals added in last 14 days (temporary)
router.get('/debug-recent', async (req, res) => {
  try {
    const { rows: skipped } = await pool.query(
      `SELECT pe.message_id, pe.subject, pe.processed_at
       FROM processed_emails pe
       WHERE pe.status = 'skipped'
       ORDER BY pe.processed_at DESC LIMIT 60`
    );
    const { rows: recentDeals } = await pool.query(
      `SELECT d.id, d.company_name, d.description, d.sector, d.funding_ask, d.date_added,
              d.notes, pe.message_id
       FROM deals d
       LEFT JOIN processed_emails pe ON pe.deal_id = d.id
       WHERE d.date_added >= NOW() - INTERVAL '14 days'
       ORDER BY d.date_added DESC LIMIT 60`
    );
    // Also check processed_emails status for known Oct 1 batch message IDs (1a0f5b prefix)
    const { rows: oct1status } = await pool.query(
      `SELECT pe.message_id, pe.subject, pe.status, pe.processed_at, d.company_name, d.description
       FROM processed_emails pe
       LEFT JOIN deals d ON d.id = pe.deal_id
       WHERE pe.message_id LIKE '1a0f5b%'
       ORDER BY pe.processed_at DESC LIMIT 80`
    );
    const { rows: totalCount } = await pool.query('SELECT COUNT(*) AS total FROM deals');
    res.json({ totalDeals: totalCount[0].total, skippedEmails: skipped, recentDeals, oct1BatchStatus: oct1status });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/gmail/debug-unprocessed — scan Gmail and show which message IDs are unprocessed (temporary)
router.get('/debug-unprocessed', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const query = '-is:sent -is:draft -in:trash';
    const allIds = [];
    let pageToken;
    do {
      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100, ...(pageToken && { pageToken }) });
      if (listRes.data.messages) allIds.push(...listRes.data.messages);
      pageToken = listRes.data.nextPageToken;
    } while (pageToken && allIds.length < 600);

    const unprocessed = [];
    const processedByStatus = {};
    for (const { id } of allIds) {
      const { rows } = await pool.query('SELECT status, deal_id FROM processed_emails WHERE message_id = $1', [id]);
      if (!rows[0]) {
        unprocessed.push(id);
      } else {
        processedByStatus[rows[0].status] = (processedByStatus[rows[0].status] || 0) + 1;
      }
    }
    // For unprocessed IDs, get their subjects
    const unprocessedDetails = [];
    for (const id of unprocessed.slice(0, 30)) {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const headers = msg.data.payload.headers;
        unprocessedDetails.push({
          id,
          subject: headers.find(h => h.name === 'Subject')?.value || '',
          from: headers.find(h => h.name === 'From')?.value || '',
          date: headers.find(h => h.name === 'Date')?.value || '',
        });
      } catch (err) {
        unprocessedDetails.push({ id, error: err.message });
      }
    }
    res.json({ totalInGmail: allIds.length, unprocessedCount: unprocessed.length, processedByStatus, unprocessedEmails: unprocessedDetails });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// POST /api/gmail/debug-clear-messages — clear specific processed_emails entries (temporary)
router.post('/debug-clear-messages', async (req, res) => {
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({ error: 'messageIds array required' });
  }
  try {
    const { rows } = await pool.query(
      'DELETE FROM processed_emails WHERE message_id = ANY($1) RETURNING message_id, subject, status',
      [messageIds]
    );
    res.json({ cleared: rows });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// POST /api/gmail/debug-full-retry — clears orphaned + skipped processed_emails entries
// and triggers a fresh sync. Does NOT delete any deals from the CRM.
router.post('/debug-full-retry', async (req, res) => {
  try {
    // 1. Clear orphaned processed_emails entries (deal deleted from CRM but entry remains)
    //    Also clears ghost entries where status='added' but deal_id is NULL
    const { rows: orphaned } = await pool.query(
      `DELETE FROM processed_emails
       WHERE (deal_id IS NOT NULL AND deal_id NOT IN (SELECT id FROM deals))
          OR (status = 'added' AND deal_id IS NULL)
       RETURNING id`
    );
    // 2. Clear skipped entries so the next sync re-attempts them
    const { rows: skipped } = await pool.query(
      `DELETE FROM processed_emails WHERE status = 'skipped' RETURNING id`
    );
    const summary = { orphanedCleared: orphaned.length, skippedCleared: skipped.length };
    console.log(`[Debug] full-retry: cleared ${orphaned.length} orphaned + ${skipped.length} skipped entries — no deals deleted`);
    res.json({ message: 'Cleanup done — sync triggered', ...summary });
    runEmailSync().catch((err) => console.error('debug-full-retry sync error:', err));
  } catch (err) {
    res.json({ error: err.message });
  }
});

// POST /api/gmail/retry-stubs — re-extract stub deals in-place without deleting them.
// Finds deals with "requires manual review" in notes, re-runs the full extraction pipeline
// on their source emails, and UPDATEs the deal if better data is found.
router.post('/retry-stubs', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Find stub deals that came from a Gmail message
    const { rows: stubs } = await pool.query(
      `SELECT d.id, d.company_name, d.email_source_id
       FROM deals d
       WHERE d.notes LIKE '%requires manual review%'
         AND d.email_source_id IS NOT NULL
         AND d.description IS NULL
       ORDER BY d.date_added DESC`
    );

    res.json({ message: `Re-extracting ${stubs.length} stubs — running in background`, count: stubs.length });

    // Run async — don't block the HTTP response
    (async () => {
      const { extractDealFromEmail, extractDealFromImages, extractDealFromPdf } = require('../services/claudeService');
      const { extractFromDocsend, extractFromPapermark } = require('../services/docsendService');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      let updated = 0;
      let failed = 0;

      for (const stub of stubs) {
        try {
          await sleep(2000);
          const email = await fetchPitchEmailById(gmail, stub.email_source_id);
          if (!email) { failed++; continue; }

          const allPdfs   = email.attachments?.filter(a => a.readable && a.pdfBuffer) || [];
          const imagePdfs = email.attachments?.filter(a => a.isImageBased && a.pdfBuffer) || [];
          const hasDocsend   = email.deckLink && /docsend\.com/i.test(email.deckLink);
          const hasPapermark = email.deckLink && /papermark\.(com|io)\/view\//i.test(email.deckLink);
          const viewerEmail  = email.xeedEmail || 'deals@xeedvc.com';

          let deal = null;

          if (!deal && hasDocsend && allPdfs.length === 0) {
            try {
              const slides = await extractFromDocsend(email.deckLink, viewerEmail);
              if (slides.length > 0) deal = await extractDealFromImages(subject, from, slides);
            } catch {}
          }
          if (!deal && hasPapermark && allPdfs.length === 0) {
            try {
              const slides = await extractFromPapermark(email.deckLink, viewerEmail);
              if (slides.length > 0) deal = await extractDealFromImages(subject, from, slides);
            } catch {}
          }
          if (!deal && allPdfs.length > 0) {
            try { deal = await extractDealFromPdf(subject, from, allPdfs[0].pdfBuffer); } catch {}
          }
          if (!deal) {
            try { deal = await extractDealFromEmail(subject, from, email.body, email.attachments || [], email.websiteText || null); } catch {}
          }
          if (!deal && allPdfs.length > 0) {
            try { deal = await extractDealFromPdf(subject, from, allPdfs[0].pdfBuffer); } catch {}
          }

          if (deal && (deal.description || deal.sector || deal.funding_ask || deal.founders?.length)) {
            await pool.query(
              `UPDATE deals SET
                 company_name       = COALESCE($1, company_name),
                 description        = COALESCE($2, description),
                 sector             = COALESCE($3, sector),
                 location           = COALESCE($4, location),
                 funding_ask        = COALESCE($5, funding_ask),
                 founder_background = COALESCE($6, founder_background),
                 founders           = CASE WHEN $7::text[] IS NOT NULL AND array_length($7::text[], 1) > 0 THEN $7::text[] ELSE founders END,
                 brand              = COALESCE($8, brand)
               WHERE id = $9`,
              [deal.company_name, deal.description, deal.sector, deal.location,
               deal.funding_ask, deal.founder_background,
               deal.founders?.length ? deal.founders : null,
               deal.brand, stub.id]
            );
            console.log(`[RetryStubs] Updated stub "${stub.company_name}" with extracted data`);
            updated++;
          } else {
            console.log(`[RetryStubs] Extraction still returned no data for "${stub.company_name}"`);
            failed++;
          }
        } catch (err) {
          console.error(`[RetryStubs] Error on "${stub.company_name}": ${err.message}`);
          failed++;
        }
      }
      console.log(`[RetryStubs] Done — updated: ${updated}, still no data: ${failed}`);
    })().catch(err => console.error('[RetryStubs] Fatal:', err.message));
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/gmail/debug-inbox — list recent Gmail messages directly from API (temporary)
router.get('/debug-inbox', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const query = '-is:sent -is:draft -in:trash';
    const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
    const messages = listRes.data.messages || [];
    const total = listRes.data.resultSizeEstimate;

    const details = [];
    for (const { id } of messages.slice(0, 10)) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
      const headers = msg.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from    = headers.find(h => h.name === 'From')?.value    || '';
      const date    = headers.find(h => h.name === 'Date')?.value    || '';
      const inProcessed = await pool.query('SELECT status FROM processed_emails WHERE message_id = $1', [id]);
      details.push({ id, subject, from, date, alreadyProcessed: inProcessed.rows[0]?.status || null });
    }

    res.json({ totalEstimate: total, query, recentMessages: details });
  } catch (err) {
    res.json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
});

// GET /api/gmail/debug-status — sync health check (temporary)
router.get('/debug-status', async (req, res) => {
  try {
    const { rows: syncs } = await pool.query(
      `SELECT id, status, started_at, finished_at, emails_scanned, deals_added, deals_skipped, error_message
       FROM sync_log ORDER BY started_at DESC LIMIT 5`
    );
    const { rows: stats } = await pool.query(
      `SELECT status, COUNT(*) AS count, MAX(processed_at) AS latest FROM processed_emails GROUP BY status`
    );
    const { rows: recent } = await pool.query(
      `SELECT message_id, subject, status, processed_at FROM processed_emails
       ORDER BY processed_at DESC LIMIT 5`
    );
    const { rows: token } = await pool.query(
      `SELECT gmail_email, updated_at FROM gmail_tokens ORDER BY updated_at DESC LIMIT 1`
    );
    res.json({ connectedAccount: token[0] || null, recentSyncs: syncs, processedStats: stats, recentProcessed: recent });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/gmail/debug-test-gemini — test Gemini connectivity with gemini-flash-latest (temporary)
router.get('/debug-test-gemini', async (req, res) => {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const r = await model.generateContent('Return {"ok": true}');
    res.json({ success: true, model: 'gemini-flash-latest', response: r.response.text().slice(0, 100) });
  } catch (err) {
    res.json({ success: false, error: err.message.slice(0, 300) });
  }
});

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

// POST /api/gmail/retry-skipped
// Clears all 'skipped' entries from processed_emails so the next sync re-attempts them.
// Useful when extraction logic is improved and old emails need re-processing.
router.post('/retry-skipped', requireAuth, async (req, res) => {
  const connection = await getConnectionStatus(req.user.id);
  if (!connection) {
    return res.status(400).json({ error: 'Gmail not connected.' });
  }

  // Clear 'skipped' entries so they get re-attempted
  const { rows: skipped } = await pool.query(
    `DELETE FROM processed_emails WHERE status = 'skipped' RETURNING id`
  );

  // Also clear orphaned entries — deal was deleted from CRM but
  // processed_emails record remained, blocking the email from re-syncing
  const { rows: orphaned } = await pool.query(
    `DELETE FROM processed_emails
     WHERE deal_id IS NOT NULL
       AND deal_id NOT IN (SELECT id FROM deals)
     RETURNING id`
  );

  const cleared = skipped.length + orphaned.length;
  console.log(`[Retry] Cleared ${skipped.length} skipped + ${orphaned.length} orphaned emails — starting re-sync`);
  res.json({ message: `Cleared ${cleared} email(s) (${skipped.length} skipped, ${orphaned.length} orphaned) — re-sync started` });
  runEmailSync().catch((err) => console.error('Retry-skipped sync error:', err));
});

// POST /api/gmail/sheets-export — manual trigger
router.post('/sheets-export', requireAuth, async (req, res) => {
  try {
    const { exportDealsToSheet } = require('../services/sheetsService');
    const added = await exportDealsToSheet();
    res.json({ message: `Export complete — ${added} new deal(s) added to sheet`, added });
  } catch (err) {
    console.error('Manual sheets export error:', err);
    res.status(500).json({ error: err.message });
  }
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

// DELETE /api/gmail/processed/:messageId  — force-clear a specific processed_emails entry
// Useful when a deal was deleted from the CRM but its processed_emails record persists,
// permanently blocking the source email from being re-synced.
router.delete('/processed/:messageId', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM processed_emails WHERE message_id = $1 RETURNING *',
    [req.params.messageId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No processed_emails entry found for that message ID' });
  res.json({ message: 'Entry cleared — next sync will reprocess this email', entry: rows[0] });
});

// POST /api/gmail/fix-deck-links — one-time fix for localhost:3001 deck links
// Rewrites any deck_link pointing to localhost:3001/uploads/ to the correct Supabase URL
router.post('/fix-deck-links', requireAuth, async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return res.status(500).json({ error: 'SUPABASE_URL not set' });

  const { rows } = await pool.query(
    `SELECT id, company_name, deck_link FROM deals WHERE deck_link LIKE '%localhost:3001/uploads/%'`
  );

  if (!rows.length) return res.json({ message: 'No broken deck links found', fixed: 0 });

  const fixed = [];
  for (const deal of rows) {
    const filename = deal.deck_link.split('/uploads/')[1];
    if (!filename) continue;
    const newUrl = `${supabaseUrl}/storage/v1/object/public/pitchdecks/${filename}`;
    await pool.query('UPDATE deals SET deck_link = $1 WHERE id = $2', [newUrl, deal.id]);
    fixed.push({ company: deal.company_name, url: newUrl });
  }

  res.json({ message: `Fixed ${fixed.length} deck link(s)`, fixed });
});

// DELETE /api/gmail/disconnect
router.delete('/disconnect', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM gmail_tokens WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'Gmail disconnected' });
});

module.exports = router;
