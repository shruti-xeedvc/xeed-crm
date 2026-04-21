const { google } = require('googleapis');
const { pool } = require('../config/db');

const SHEET_ID = '1dqbamUZUW-9TOt98zwwEgteye9KhjOGTWJG7AKCozGk';
const SHEET_NAME = 'Sheet1';
const DATA_START_ROW = 3; // Row 1 = title, Row 2 = headers, Row 3+ = data

// Sheet column order (A–M):
// A: Meeting Date | B: (blank) | C: Company | D: Founder Background | E: Founders
// F: Sector | G: Round | H: Round Size ($mn) | I: Brief Description
// J: POC | K: Status | L: Traction | M: Comments

const getOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

const getSheetsClient = async () => {
  const { rows } = await pool.query(
    'SELECT * FROM gmail_tokens ORDER BY updated_at DESC LIMIT 1'
  );
  if (!rows[0]) throw new Error('No Google account connected');

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: rows[0].access_token,
    refresh_token: rows[0].refresh_token,
  });

  return google.sheets({ version: 'v4', auth: oauth2 });
};

// CRM stage → sheet-friendly status
const stageToStatus = (stage) => stage || 'Sourcing';

// Sheet status → CRM stage
const statusToStage = (status = '') => {
  const s = status.toLowerCase().trim();
  if (s.includes('invested') || s.includes('portfolio')) return 'Invested';
  if (s.includes('term') || s.includes('ts')) return 'Term Sheet';
  if (s.includes('diligence') || s.includes('dd')) return 'Diligence';
  if (s.includes('screen')) return 'Screening';
  if (s.includes('pass') || s.includes('reject') || s.includes('no')) return 'Passed';
  return 'Sourcing';
};

// -------------------------------------------------------
// EXPORT: Write all CRM deals to the Google Sheet
// -------------------------------------------------------
const exportDealsToSheet = async () => {
  const sheets = await getSheetsClient();
  const { rows: deals } = await pool.query(
    'SELECT * FROM deals ORDER BY date_added ASC NULLS LAST, created_at ASC'
  );

  // Clear existing data rows (keep header)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${DATA_START_ROW}:M`,
  });

  if (deals.length === 0) return 0;

  const values = deals.map((deal) => [
    deal.date_added
      ? new Date(deal.date_added).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      : '',
    '',                                                          // B: blank column
    deal.company_name || '',
    deal.founder_background || '',
    Array.isArray(deal.founders) ? deal.founders.join(', ') : '',
    deal.sector || '',
    stageToStatus(deal.stage),                                   // G: Round/Stage
    deal.funding_ask || '',                                      // H: Round Size
    deal.description || '',                                      // I: Brief Description
    deal.poc || '',                                              // J: POC
    stageToStatus(deal.stage),                                   // K: Status
    '',                                                          // L: Traction (in notes)
    deal.notes || '',                                            // M: Comments
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${DATA_START_ROW}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  console.log(`[Sheets] Exported ${deals.length} deals to Google Sheet`);
  return deals.length;
};

// -------------------------------------------------------
// IMPORT: Read historical deals from Sheet into CRM
// -------------------------------------------------------
const importDealsFromSheet = async () => {
  const sheets = await getSheetsClient();

  // Read the header row (row 2) to build a dynamic column index map
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:Z2`,
  });
  const headerRow = (headerResp.data.values || [[]])[0] || [];
  const colIdx = {};
  headerRow.forEach((h, i) => {
    if (h) {
      const lower = h.trim().toLowerCase();
      if (colIdx[lower] === undefined) colIdx[lower] = i; // keep first occurrence only
    }
  });
  console.log('[Sheets] Detected headers:', headerRow);

  // Helper: get value from a row — tries exact match first, then "header includes keyword"
  const col = (row, ...names) => {
    for (const name of names) {
      const lower = name.toLowerCase();
      // exact match
      if (colIdx[lower] !== undefined) return row[colIdx[lower]];
      // partial match: find first header that contains the search term
      const key = Object.keys(colIdx).find((h) => h.includes(lower));
      if (key !== undefined) return row[colIdx[key]];
    }
    return undefined;
  };

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${DATA_START_ROW}:Z`,
  });

  const rows = resp.data.values || [];
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const meetingDate = col(row, 'meeting date', 'date', 'meeting_date');
    const company     = col(row, 'company', 'company name', 'startup', 'name');
    const founderBg   = col(row, 'founder background', 'founder_background', 'founder bg', 'linkedin');
    const founders    = col(row, 'founders', 'founder', 'founder name', 'founder names');
    const sector      = col(row, 'sector', 'industry', 'vertical');
    const round       = col(row, 'round', 'stage');
    const roundSize   = col(row, 'round size ($mn)', 'round size', 'round size($mn)', 'size ($mn)', 'ask', 'funding ask');
    const description = col(row, 'brief description', 'description', 'one-liner', 'one liner', 'about');
    const poc         = col(row, 'poc', 'point of contact', 'owner', 'assigned to');
    const status      = col(row, 'status', 'stage', 'deal status');
    const traction    = col(row, 'traction');
    const comments    = col(row, 'comments', 'notes', 'analyst notes');

    if (!company?.trim()) continue;

    // Skip if already in CRM
    const { rows: existing } = await pool.query(
      'SELECT id FROM deals WHERE LOWER(company_name) = LOWER($1)',
      [company.trim()]
    );
    if (existing[0]) { skipped++; continue; }

    try {
      // Parse date — handle JS Date strings, MM/DD/YYYY, D-Mon-YY, and Google Sheets serial numbers
      let dateAdded = null;
      if (meetingDate?.trim()) {
        const raw = meetingDate.trim();
        // Google Sheets serial number (days since 1899-12-30)
        if (/^\d{4,5}$/.test(raw)) {
          const serial = parseInt(raw, 10);
          dateAdded = new Date((serial - 25569) * 86400 * 1000); // epoch offset
        } else {
          const parsed = new Date(raw);
          if (!isNaN(parsed)) dateAdded = parsed;
        }
      }

      // Round size → funding_ask string
      let fundingAsk = null;
      if (roundSize?.trim()) {
        fundingAsk = roundSize.trim().startsWith('$') ? roundSize.trim() : `$${roundSize.trim()}M`;
      } else if (round?.trim()) {
        fundingAsk = round.trim();
      }

      // Combine traction + comments as notes
      const notes = [traction?.trim(), comments?.trim()].filter(Boolean).join(' | ') || null;

      const insertParams = [
        company.trim(),
        founders?.trim() ? founders.trim().split(',').map((f) => f.trim()).filter(Boolean) : [],
        sector?.trim() || null,
        fundingAsk,
        statusToStage(status),
        description?.trim() || null,
        founderBg?.trim() || null,
        poc?.trim() || null,
        notes,
      ];

      await pool.query(
        `INSERT INTO deals
           (company_name, founders, sector, funding_ask, stage, priority,
            description, founder_background, poc, notes, date_added)
         VALUES ($1,$2,$3,$4,$5,'Medium',$6,$7,$8,$9,$10)`,
        [...insertParams, dateAdded || null]
      );
      imported++;
    } catch (err) {
      console.error(`[Sheets] Error importing "${company}":`, err.message);
      errors++;
    }
  }

  console.log(`[Sheets] Import complete — imported: ${imported}, skipped: ${skipped}, errors: ${errors}`);
  return { imported, skipped, errors };
};

module.exports = { exportDealsToSheet, importDealsFromSheet };
