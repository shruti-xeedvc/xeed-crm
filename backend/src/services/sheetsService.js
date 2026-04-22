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
// EXPORT: Append new CRM deals to the Google Sheet
// Only adds deals that don't already exist in the sheet (by company name)
// Never clears or overwrites existing rows
// -------------------------------------------------------
const exportDealsToSheet = async () => {
  const sheets = await getSheetsClient();

  // 1. Read header row to get column positions
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:Z2`,
  });
  const headerRow = (headerResp.data.values || [[]])[0] || [];
  console.log('[Sheets Export] Detected headers:', headerRow);

  const colIdx = {};
  headerRow.forEach((h, i) => {
    if (h) {
      const lower = h.trim().toLowerCase();
      if (colIdx[lower] === undefined) colIdx[lower] = i;
    }
  });

  const findCol = (...names) => {
    for (const name of names) {
      const lower = name.toLowerCase();
      if (colIdx[lower] !== undefined) return colIdx[lower];
      const key = Object.keys(colIdx).find((h) => h.includes(lower) || lower.includes(h));
      if (key !== undefined) return colIdx[key];
    }
    return -1;
  };

  const totalCols = headerRow.length || 13;

  const COL = {
    date:        findCol('meeting date', 'date'),
    company:     findCol('company'),
    founderBg:   findCol('founder background', 'founder bg', 'linkedin'),
    founders:    findCol('founders', 'founder name'),
    sector:      findCol('sector', 'industry'),
    roundSize:   findCol('round size ($mn)', 'round size', 'funding ask', 'ask'),
    description: findCol('brief description', 'description', 'one-liner'),
    poc:         findCol('poc', 'point of contact'),
    status:      findCol('status', 'deal status'),
    comments:    findCol('comments', 'notes'),
  };
  console.log('[Sheets Export] Column mapping:', COL);

  // Normalize any date string to YYYY-MM-DD for reliable comparison
  // Handles: MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD, Google Sheets serials, etc.
  const normalizeDate = (raw) => {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s) return '';
    // Google Sheets serial number
    if (/^\d{4,5}$/.test(s)) {
      const d = new Date((parseInt(s, 10) - 25569) * 86400 * 1000);
      return d.toISOString().split('T')[0];
    }
    // Try parsing directly (handles MM/DD/YYYY, YYYY-MM-DD, etc.)
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
    return s.toLowerCase(); // fallback: keep as-is for string comparison
  };

  // 2. Read all existing data rows to find companies already in the sheet
  const existingResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${DATA_START_ROW}:Z`,
  });
  const existingRows = existingResp.data.values || [];

  const companyCol = COL.company;
  const dateCol = COL.date;

  // Build a set of "company|YYYY-MM-DD" keys already in the sheet
  const existingKeys = new Set(
    existingRows.map((r) => {
      const company = (r[companyCol] || '').trim().toLowerCase();
      const date = normalizeDate(r[dateCol]);
      return `${company}|${date}`;
    }).filter((k) => !k.startsWith('|'))
  );
  console.log(`[Sheets Export] ${existingKeys.size} company+date combos already in sheet`);

  // 3. Get all CRM deals and filter to only ones not already in the sheet
  const { rows: deals } = await pool.query(
    'SELECT * FROM deals ORDER BY date_added ASC NULLS LAST, created_at ASC'
  );

  const newDeals = deals.filter((d) => {
    if (!d.company_name) return false;
    const company = d.company_name.trim().toLowerCase();
    const date = d.date_added ? new Date(d.date_added).toISOString().split('T')[0] : '';
    return !existingKeys.has(`${company}|${date}`);
  });

  if (newDeals.length === 0) {
    console.log('[Sheets Export] No new deals to add');
    return 0;
  }

  // 4. Append new deals after the last existing row
  const values = newDeals.map((deal) => {
    const row = Array(totalCols).fill('');

    const set = (colKey, value) => {
      const idx = COL[colKey];
      if (idx >= 0 && idx < row.length) row[idx] = value ?? '';
    };

    set('date', deal.date_added
      ? new Date(deal.date_added).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      : '');
    set('company',     deal.company_name || '');
    set('founderBg',   deal.founder_background || '');
    set('founders',    Array.isArray(deal.founders) ? deal.founders.join(', ') : '');
    set('sector',      deal.sector || '');
    set('roundSize',   deal.funding_ask || '');
    set('description', deal.description || '');
    set('poc',         deal.poc || '');
    set('status',      stageToStatus(deal.stage));
    set('comments',    deal.notes || '');

    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${DATA_START_ROW}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
    requestBody: { values },
  });

  console.log(`[Sheets Export] Appended ${newDeals.length} new deals`);
  return newDeals.length;
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
