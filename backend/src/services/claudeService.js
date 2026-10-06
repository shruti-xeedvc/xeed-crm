const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');
const os = require('os');

// PDFs larger than this are uploaded via the File API instead of sent inline.
// Image-based PDFs (all pages are scanned images) must be kept small for inline use
// — above 1 MB they reliably cause 503 "high demand" errors when sent as base64.
const INLINE_PDF_LIMIT = 1 * 1024 * 1024; // 1 MB

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry Gemini calls on 503 (model temporarily overloaded) or 429 (transient rate limit)
const geminiWithRetry = async (fn, retries = 6) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const is503 = msg.includes('[503') || err.status === 503;
      // 429 with "Quota exceeded for ...free_tier_requests" is a daily hard limit — don't retry
      const is429DailyLimit = msg.includes('[429') && msg.includes('free_tier_requests');
      const is429Transient = msg.includes('[429') && !is429DailyLimit;
      if ((is503 || is429Transient) && i < retries - 1) {
        const wait = (i + 1) * 12000; // 12s, 24s, 36s, 48s, 60s
        console.log(`  [Gemini] ${is503 ? '503 overloaded' : '429 rate-limited'} — retrying in ${wait / 1000}s (attempt ${i + 2}/${retries})`);
        await sleep(wait);
      } else {
        if (is429DailyLimit) {
          console.error(`  [Gemini] DAILY QUOTA EXHAUSTED — free tier limit reached. Upgrade the API key to paid plan to process more PDFs today.`);
        }
        throw err;
      }
    }
  }
};

const SYSTEM_PROMPT = `You are a senior VC analyst at Xeed VC. Your job is to extract structured deal information from any email that contains information about a startup or investment opportunity.

Sources you will receive include:
- Pitch emails sent directly by founders
- Forwarded founder pitch emails (body may be empty if only a PDF was attached)
- Internal Xeed VC team meeting notes or deal summaries written after a founder call
- Attached pitch deck text (extracted from PDFs)
- Company website text

Guidelines:
- Pitch deck text is the PRIMARY source — it is more complete and authoritative than the email body.
- Search the ENTIRE deck text carefully. Key fields like funding ask and founder background are often in the last few slides (Team, Ask, Financials).
- For funding_ask: look for "$", "raise", "round", "valuation", "pre-money", "seeking", "investment ask" anywhere in the deck or email. Never return null if a number is mentioned.
- For founder_background: look for a "Team" slide in the deck or a "Founders" section — extract LinkedIn URLs, past companies, education, and roles.
- For company website text: use it to fill any gaps left by the email and deck.
- Extract information accurately. Use null only when truly absent after searching all sources.
- Notes: be specific — mention actual numbers (ARR, users, growth rate, GMV) if present.
- Return is_pitch: false ONLY for emails with NO startup content: bounce notifications, Google security alerts, YouTube newsletters, calendar invites unrelated to any company, or similar system/admin emails.`;

const extractDealFromEmail = async (subject, from, body, attachments = [], websiteText = null) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const deckAttachments = attachments.filter((a) => a.readable && a.text);
  const hintAttachments = attachments.filter((a) => !a.readable);

  let deckSection = '';
  for (const deck of deckAttachments) {
    const excerpt = deck.text.slice(0, 15000);
    deckSection += `\n\n--- Pitch Deck: "${deck.filename}" (${deck.pages} pages) ---\n${excerpt}`;
  }

  let contextNote = '';
  if (deckAttachments.length > 0) {
    contextNote += `\n\nPitch deck text is included below — treat it as the primary data source, especially for funding ask and founder backgrounds.`;
  }
  if (hintAttachments.length > 0) {
    const names = hintAttachments.map((a) => `"${a.filename}"`).join(', ');
    contextNote += `\nOther attachments present (not text-extractable): ${names}.`;
  }

  const websiteSection = websiteText
    ? `\n\n--- Company Website ---\n${websiteText.slice(0, 3000)}`
    : '';

  const prompt = `${SYSTEM_PROMPT}

Extract deal information from this email${deckAttachments.length ? ', attached deck,' : ''}${websiteText ? ' and company website' : ''}.
Return a single JSON object. If this email contains NO startup information (e.g. it is a bounce notification or system alert), return: {"is_pitch": false}

IMPORTANT: Do NOT use the names of deck-hosting or file-sharing services (Papermark, DocSend, Google Drive, Dropbox, Notion, Pitch.com, etc.) as the company_name. These are just tools used to share the deck — the actual startup is different. Use the email subject or deck content to identify the real company.

From: ${from}
Subject: ${subject}${contextNote}

Email body:
${body.slice(0, 2000)}
${deckSection}
${websiteSection}

Return JSON with these exact fields:
{
  "is_pitch": true,
  "company_name": "string — startup/company name",
  "brand": "string — product/brand name if different, else null",
  "founders": ["array of founder full names — search the Team slide in the deck"],
  "sector": "string — e.g. Fintech, SaaS, HealthTech, EdTech, DeepTech, Consumer, Logistics, CleanTech, AgriTech",
  "location": "string — city and country, e.g. Mumbai, India",
  "funding_ask": "string — search entire deck and email for raise amount, e.g. $2M, ₹5Cr — null only if truly absent",
  "description": "1–2 sentences: what the company does and its core product/service",
  "founder_background": "LinkedIn URL(s) if present, else extract from Team slide: past companies, education, notable roles — be specific",
  "poc": "First name of Xeed VC team member who introduced or referred this deal (Anirudh/Shruti/Sailesh/Aditya) — infer from context or signatures, else null",
  "notes": "2–3 sentences: key traction metrics (ARR, GMV, users, growth) and honest investment assessment"
}

Only return valid JSON. No markdown, no explanation.`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const result = await geminiWithRetry(() => model.generateContent(prompt));
  const text = result.response.text().trim();

  let data;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    console.error('[Gemini] Invalid JSON response for email extraction:', text.slice(0, 200));
    return null;
  }

  if (!data.is_pitch) return null;

  return {
    company_name:       data.company_name       || null,
    brand:              data.brand              || null,
    founders:           Array.isArray(data.founders) ? data.founders : [],
    sector:             data.sector             || null,
    location:           data.location           || null,
    funding_ask:        data.funding_ask        || null,
    description:        data.description        || null,
    founder_background: data.founder_background || null,
    poc:                data.poc                || null,
    notes:              data.notes              || null,
  };
};

/**
 * Extract deal info from DocSend/Papermark slide screenshots using Gemini vision.
 * @param {string}   subject - Email subject
 * @param {string}   from    - Sender
 * @param {string[]} images  - Array of base64 JPEG screenshots
 */
const extractDealFromImages = async (subject, from, images) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const imageParts = images.slice(0, 10).map((b64) => ({
    inlineData: { mimeType: 'image/jpeg', data: b64 },
  }));

  const prompt = `You are a senior VC analyst. These are screenshots from a startup pitch deck.

Email subject: ${subject}
From: ${from}

Extract deal information and return ONLY a valid JSON object — no markdown, no explanation:
{
  "is_pitch": true,
  "company_name": "startup name",
  "brand": "product/brand name if different, else null",
  "founders": ["full names from Team slide"],
  "sector": "one of: Fintech, SaaS, HealthTech, EdTech, DeepTech, Consumer, Logistics, CleanTech, AgriTech, Other",
  "location": "City, Country",
  "funding_ask": "e.g. $2M — search all slides for raise/round/ask amount, null only if truly absent",
  "description": "1–2 sentences: what the company does",
  "founder_background": "LinkedIn URLs or: past companies, education, roles from Team slide",
  "poc": null,
  "notes": "2–3 sentences: key traction metrics (ARR, users, GMV, growth) and honest assessment"
}

If this is not a startup pitch, return: {"is_pitch": false}`;

  const result = await geminiWithRetry(() => model.generateContent([prompt, ...imageParts]));
  const text = result.response.text().trim();

  let data;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    console.error('[Gemini] Invalid JSON from vision:', text.slice(0, 200));
    return null;
  }

  if (!data.is_pitch) return null;

  return {
    company_name:       data.company_name       || null,
    brand:              data.brand              || null,
    founders:           Array.isArray(data.founders) ? data.founders : [],
    sector:             data.sector             || null,
    location:           data.location           || null,
    funding_ask:        data.funding_ask        || null,
    description:        data.description        || null,
    founder_background: data.founder_background || null,
    poc:                data.poc                || null,
    notes:              data.notes              || null,
  };
};

/**
 * Extract deal info from an image-based PDF using Gemini's native PDF understanding.
 * Used when pdf-parse returns minimal text (scanned/image-only slide decks).
 * @param {string} subject
 * @param {string} from
 * @param {Buffer} pdfBuffer
 */
const extractDealFromPdf = async (subject, from, pdfBuffer) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const prompt = `You are a senior VC analyst at Xeed VC. This PDF was sent to deals@xeedvc.com as part of startup deal flow. It may be ANY of:
- A founder's pitch deck (slides about their startup)
- Meeting notes or a deal summary compiled by a Xeed VC team member after a founder call
- A one-pager, teaser, or investor memo about a startup

Email subject: ${subject}
From: ${from}

Read every page carefully. Extract deal information and return a JSON object:
{
  "is_pitch": true,
  "company_name": "startup name",
  "brand": "product/brand name if different, else null",
  "founders": ["full names — search Team slide or meeting notes"],
  "sector": "one of: Fintech, SaaS, HealthTech, EdTech, DeepTech, Consumer, Logistics, CleanTech, AgriTech, Other",
  "location": "City, Country",
  "funding_ask": "Amount the startup is ACTIVELY RAISING — only if explicitly stated ('raising', 'seeking', 'ask', 'round size'). null if not stated.",
  "description": "1–2 sentences: what the company does",
  "founder_background": "LinkedIn URLs or: past companies, education, roles — be specific",
  "poc": null,
  "notes": "2–3 sentences: key traction metrics (ARR, users, GMV, growth) and honest assessment"
}

Return is_pitch: false ONLY if the PDF has NO startup content at all (e.g. it is a blank document, a terms-of-service PDF, or an invoice unrelated to any startup). Meeting notes about a startup ARE startup content.`;

  let pdfPart;
  let uploadedFileName = null;

  if (pdfBuffer.length > INLINE_PDF_LIMIT) {
    // PDF too large for inline base64 — upload via Gemini File API
    console.log(`  [Gemini] PDF is ${Math.round(pdfBuffer.length / 1024 / 1024)}MB — uploading via File API`);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
    const tmpPath = path.join(os.tmpdir(), `xeed_pdf_${Date.now()}.pdf`);
    try {
      fs.writeFileSync(tmpPath, pdfBuffer);
      const upload = await fileManager.uploadFile(tmpPath, {
        mimeType: 'application/pdf',
        displayName: `pitch_${Date.now()}.pdf`,
      });
      uploadedFileName = upload.file.name;
      pdfPart = { fileData: { mimeType: 'application/pdf', fileUri: upload.file.uri } };
      console.log(`  [Gemini] File API upload complete: ${upload.file.uri}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } else {
    // Small PDF — send inline
    pdfPart = { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } };
  }

  let result;
  try {
    result = await geminiWithRetry(() => model.generateContent([pdfPart, { text: prompt }]));
  } finally {
    // Clean up uploaded file from Gemini storage
    if (uploadedFileName) {
      try {
        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
        await fileManager.deleteFile(uploadedFileName);
      } catch {}
    }
  }

  const text = result.response.text().trim();
  console.log(`  [Gemini] PDF raw response (first 300): ${text.slice(0, 300)}`);

  let data;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    console.error('[Gemini] Invalid JSON from PDF extraction:', text.slice(0, 200));
    return null;
  }

  if (!data.is_pitch) {
    console.log(`  [Gemini] PDF marked is_pitch:false — subject: "${subject}", company_name: "${data.company_name}"`);
    return null;
  }

  return {
    company_name:       data.company_name       || null,
    brand:              data.brand              || null,
    founders:           Array.isArray(data.founders) ? data.founders : [],
    sector:             data.sector             || null,
    location:           data.location           || null,
    funding_ask:        data.funding_ask        || null,
    description:        data.description        || null,
    founder_background: data.founder_background || null,
    poc:                data.poc                || null,
    notes:              data.notes              || null,
  };
};

module.exports = { extractDealFromEmail, extractDealFromImages, extractDealFromPdf };
