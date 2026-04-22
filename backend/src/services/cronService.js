const cron = require('node-cron');
const { pool } = require('../config/db');
const { fetchPitchEmails } = require('./gmailService');
const { extractDealFromEmail } = require('./claudeService');
const { exportDealsToSheet } = require('./sheetsService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry a Gemini call with exponential backoff on 429
const withRateLimit = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429 || err.status_code === 429;
      if (is429 && i < retries - 1) {
        const wait = (i + 1) * 30000; // 30s, 60s, 90s
        console.log(`  [Groq] Rate limited — waiting ${wait / 1000}s before retry ${i + 2}/${retries}`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
};

const runEmailSync = async () => {
  console.log('[Cron] Starting email sync...');

  const { rows: logRows } = await pool.query(
    `INSERT INTO sync_log (status) VALUES ('running') RETURNING id`
  );
  const logId = logRows[0].id;

  let emailsScanned = 0;
  let dealsAdded = 0;
  let dealsSkipped = 0;

  try {
    const emails = await fetchPitchEmails(50);
    emailsScanned = emails.length;
    console.log(`[Cron] Found ${emails.length} unprocessed candidate emails`);

    for (const [idx, email] of emails.entries()) {
      // Always pace before calling Gemini — keeps us under 6 RPM on the free tier
      if (idx > 0) await sleep(10000);

      try {
        const pdfCount = email.attachments?.filter((a) => a.readable).length || 0;
        if (pdfCount > 0) {
          console.log(`  [Cron] Email has ${pdfCount} readable PDF(s) — passing to Gemini`);
        }
        const deal = await withRateLimit(() =>
          extractDealFromEmail(email.subject, email.from, email.body, email.attachments || [], email.websiteText || null)
        );

        if (!deal || !deal.company_name) {
          // Not a pitch email
          await pool.query(
            `INSERT INTO processed_emails (message_id, subject, status)
             VALUES ($1, $2, 'skipped')`,
            [email.id, email.subject]
          );
          dealsSkipped++;
          continue;
        }

        // Check for duplicate by company_name (case-insensitive)
        const { rows: existing } = await pool.query(
          `SELECT id FROM deals WHERE LOWER(company_name) = LOWER($1)`,
          [deal.company_name]
        );

        if (existing[0]) {
          await pool.query(
            `INSERT INTO processed_emails (message_id, subject, deal_id, status)
             VALUES ($1, $2, $3, 'duplicate')`,
            [email.id, email.subject, existing[0].id]
          );
          dealsSkipped++;
          console.log(`[Cron] Duplicate: ${deal.company_name}`);
          continue;
        }

        // Insert new deal
        const { rows: dealRows } = await pool.query(
          `INSERT INTO deals
             (company_name, brand, founders, sector, location, funding_ask,
              stage, priority, notes, description, founder_background,
              poc, deck_link, email_source_id)
           VALUES ($1,$2,$3,$4,$5,$6,'Screening','Medium',$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [deal.company_name, deal.brand, deal.founders, deal.sector,
           deal.location, deal.funding_ask, deal.notes,
           deal.description, deal.founder_background,
           deal.poc || email.poc,
           deal.deck_link || email.deckLink || email.attachments?.find(a => a.fileUrl)?.fileUrl || null,
           email.id]
        );

        await pool.query(
          `INSERT INTO processed_emails (message_id, subject, deal_id, status)
           VALUES ($1, $2, $3, 'added')`,
          [email.id, email.subject, dealRows[0].id]
        );

        dealsAdded++;
        console.log(`[Cron] Added deal: ${deal.company_name}`);
      } catch (emailErr) {
        console.error(`[Cron] Error processing email ${email.id}:`, emailErr.message);
        // Don't mark as processed — leave it out of processed_emails so the
        // next sync will pick it up and retry rather than skipping it forever.
      }
    }

    await pool.query(
      `UPDATE sync_log
       SET finished_at = NOW(), emails_scanned = $1, deals_added = $2,
           deals_skipped = $3, status = 'success'
       WHERE id = $4`,
      [emailsScanned, dealsAdded, dealsSkipped, logId]
    );

    console.log(`[Cron] Sync complete — scanned: ${emailsScanned}, added: ${dealsAdded}, skipped: ${dealsSkipped}`);
  } catch (err) {
    console.error('[Cron] Sync failed:', err.message);
    await pool.query(
      `UPDATE sync_log
       SET finished_at = NOW(), status = 'error', error_message = $1
       WHERE id = $2`,
      [err.message, logId]
    );
  }
};

const runSheetsExport = async () => {
  console.log('[Cron] Starting Google Sheets export...');
  try {
    const count = await exportDealsToSheet();
    console.log(`[Cron] Sheets export complete — ${count} deals written`);
  } catch (err) {
    console.error('[Cron] Sheets export failed:', err.message);
  }
};

const initCronJobs = () => {
  // Every Sunday at 9:00 PM — email sync
  cron.schedule('0 21 * * 0', () => {
    console.log('[Cron] Sunday 9pm — triggering email sync');
    runEmailSync().catch((err) => console.error('[Cron] Unhandled error:', err));
  });

  // Every Sunday at 10:00 PM — export CRM to Google Sheet (after sync)
  cron.schedule('0 22 * * 0', () => {
    console.log('[Cron] Sunday 10pm — exporting to Google Sheet');
    runSheetsExport().catch((err) => console.error('[Cron] Sheets export error:', err));
  });

  console.log('[Cron] Jobs registered (Sunday 9pm email sync, 10pm Sheets export)');
};

module.exports = { initCronJobs, runEmailSync, runSheetsExport };
