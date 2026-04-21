const { google } = require('googleapis');
const { pool } = require('../config/db');
const _pdfParse = require('pdf-parse');
const pdfParse = _pdfParse.default || _pdfParse;
const { uploadPdf } = require('./storageService');

// Attachment MIME types to download and pass to Gemini
const PDF_MIME = 'application/pdf';
const READABLE_TYPES = new Set([PDF_MIME]);

// Non-readable types we still note in the prompt (so Gemini knows a deck exists)
const DECK_HINTS = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint',                                              // .ppt
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
  'application/msword',                                                         // .doc
]);

const MAX_ATTACHMENT_BYTES = 14 * 1024 * 1024; // 14 MB — safe for Gemini inline (~20 MB base64 limit)

const getOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

const getAuthUrl = (userId) => {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
    state: String(userId),
  });
};

const exchangeCode = async (code, userId) => {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const gmailEmail = profile.data.emailAddress;

  await pool.query(
    `INSERT INTO gmail_tokens (user_id, gmail_email, access_token, refresh_token, token_expiry)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id)
     DO UPDATE SET
       gmail_email = EXCLUDED.gmail_email,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expiry = EXCLUDED.token_expiry,
       updated_at = NOW()`,
    [userId, gmailEmail, tokens.access_token, tokens.refresh_token,
     tokens.expiry_date ? new Date(tokens.expiry_date) : null]
  );

  return gmailEmail;
};

const getConnectionStatus = async (userId) => {
  const { rows } = await pool.query(
    'SELECT id, gmail_email, updated_at FROM gmail_tokens WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
};

const getAuthenticatedClient = async () => {
  const { rows } = await pool.query(
    'SELECT * FROM gmail_tokens ORDER BY updated_at DESC LIMIT 1'
  );
  if (!rows[0]) throw new Error('No Gmail account connected');

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: rows[0].access_token,
    refresh_token: rows[0].refresh_token,
  });

  oauth2.on('tokens', async (tokens) => {
    const updates = [];
    const params = [];
    if (tokens.access_token) {
      params.push(tokens.access_token);
      updates.push(`access_token = $${params.length}`);
    }
    if (tokens.expiry_date) {
      params.push(new Date(tokens.expiry_date));
      updates.push(`token_expiry = $${params.length}`);
    }
    if (updates.length) {
      params.push(rows[0].id);
      await pool.query(
        `UPDATE gmail_tokens SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params
      );
    }
  });

  return oauth2;
};

// ------------------------------------------------------------
// Recursively walk MIME parts and collect attachments
// ------------------------------------------------------------
const collectAttachments = async (gmail, messageId, payload, depth = 0) => {
  const attachments = [];
  if (depth > 6 || !payload.parts) return attachments;

  for (const part of payload.parts) {
    const { mimeType = '', filename = '', body = {} } = part;

    if (READABLE_TYPES.has(mimeType) && body.attachmentId && body.size <= MAX_ATTACHMENT_BYTES) {
      try {
        const res = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: body.attachmentId,
        });

        // Convert base64url → Buffer and extract text with pdf-parse
        const pdfBuffer = Buffer.from(
          res.data.data.replace(/-/g, '+').replace(/_/g, '/'),
          'base64'
        );
        const parsed = await pdfParse(pdfBuffer);
        const extractedText = parsed.text?.trim() || '';

        // Upload PDF to Supabase Storage
        const safeFilename = `${messageId}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const fileUrl = await uploadPdf(safeFilename, pdfBuffer);

        attachments.push({
          filename,
          mimeType,
          text: extractedText,
          pages: parsed.numpages,
          readable: true,
          fileUrl,             // local URL to serve the saved PDF
        });
        console.log(`  [Attach] Extracted text from "${filename}" — ${parsed.numpages} pages, ${Math.round(extractedText.length / 1024)} KB text`);
      } catch (err) {
        console.error(`  [Attach] Failed to parse "${filename}": ${err.message}`);
      }
    } else if (DECK_HINTS.has(mimeType) && filename) {
      // We can't read PPTX/DOCX natively — just note their presence for the prompt
      attachments.push({ filename, mimeType, readable: false });
      console.log(`  [Attach] Noted non-readable deck "${filename}"`);
    }

    // Recurse into nested parts (e.g. multipart/mixed inside multipart/related)
    if (part.parts) {
      const nested = await collectAttachments(gmail, messageId, part, depth + 1);
      attachments.push(...nested);
    }
  }

  return attachments;
};

// ------------------------------------------------------------
// Extract plain-text body from MIME tree
// ------------------------------------------------------------
const extractBody = (payload) => {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64')
          .toString('utf-8')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return '';
};

// ------------------------------------------------------------
// Main fetch function — returns emails with attachments
// ------------------------------------------------------------
const fetchPitchEmails = async (maxResults = 50) => {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Process all inbox emails — deals@xeedvc.com is a dedicated deals inbox
  // so every email is a potential deal (no keyword filtering needed)
  const query = 'in:inbox newer_than:8d';

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  if (!listRes.data.messages) return [];

  const messages = [];

  for (const { id } of listRes.data.messages) {
    // Skip already-processed
    const { rows } = await pool.query(
      'SELECT id FROM processed_emails WHERE message_id = $1',
      [id]
    );
    if (rows[0]) continue;

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const headers = msg.data.payload.headers;
    const subject = headers.find((h) => h.name === 'Subject')?.value || '';
    const from    = headers.find((h) => h.name === 'From')?.value    || '';
    const cc      = headers.find((h) => h.name === 'Cc')?.value      || '';
    const to      = headers.find((h) => h.name === 'To')?.value      || '';

    const body        = extractBody(msg.data.payload);
    const attachments = await collectAttachments(gmail, id, msg.data.payload);

    // Extract POC — check all headers for known team member names
    const POC_NAMES = ['Anirudh', 'Shruti', 'Sailesh', 'Aditya'];
    const headerText = [from, cc, to].join(' ');
    const poc = POC_NAMES.find((n) => headerText.toLowerCase().includes(n.toLowerCase())) || null;

    // Extract company website URL (any HTTP URL that isn't a known file-sharing / social domain)
    const SKIP_DOMAINS = /linkedin|twitter|facebook|instagram|google|dropbox|notion|docsend|pitch\.com|youtu|calendly|zoom|mailto|whatsapp|t\.me/i;
    const ALL_URLS = [...body.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((m) => m[0]);
    let websiteUrl = null;
    for (const url of ALL_URLS) {
      try {
        const host = new URL(url).hostname;
        if (!SKIP_DOMAINS.test(host)) { websiteUrl = url; break; }
      } catch { /* invalid URL */ }
    }

    // Fetch and extract visible text from company website
    let websiteText = null;
    if (websiteUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(websiteUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XeedCRM/1.0)' },
        });
        clearTimeout(timer);
        const html = await resp.text();
        websiteText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        console.log(`  [Web] Scraped ${websiteUrl} — ${Math.round(websiteText.length / 1024)} KB text`);
      } catch (err) {
        console.log(`  [Web] Could not scrape ${websiteUrl}: ${err.message}`);
      }
    }

    // Extract first deck URL from email body
    const DECK_PATTERNS = [
      /https?:\/\/docs\.google\.com\/presentation\/[^\s<>"')]+/i,
      /https?:\/\/drive\.google\.com\/[^\s<>"')]+/i,
      /https?:\/\/[^\s<>"')]*docsend\.com\/[^\s<>"')]+/i,
      /https?:\/\/[^\s<>"')]*dropbox\.com\/[^\s<>"')]+/i,
      /https?:\/\/[^\s<>"')]*notion\.so\/[^\s<>"')]+/i,
      /https?:\/\/pitch\.com\/[^\s<>"')]+/i,
    ];
    let deckLink = null;
    for (const pattern of DECK_PATTERNS) {
      const match = body.match(pattern);
      if (match) { deckLink = match[0]; break; }
    }

    messages.push({ id, subject, from, body, attachments, poc, deckLink, websiteText });
  }

  return messages;
};

module.exports = { getAuthUrl, exchangeCode, getConnectionStatus, fetchPitchEmails };
