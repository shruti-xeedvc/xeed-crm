const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a senior VC analyst at Xeed VC. Your job is to extract structured deal information from pitch emails, attached pitch decks, and company website text sent by founders.

Guidelines:
- Pitch deck text is the PRIMARY source — it is more complete and authoritative than the email body.
- Search the ENTIRE deck text carefully. Key fields like funding ask and founder background are often in the last few slides (Team, Ask, Financials).
- For funding_ask: look for "$", "raise", "round", "valuation", "pre-money", "seeking", "investment ask" anywhere in the deck or email. Never return null if a number is mentioned.
- For founder_background: look for a "Team" slide in the deck — extract LinkedIn URLs, past companies, education, and roles.
- For company website text: use it to fill any gaps left by the email and deck.
- Extract information accurately. Use null only when truly absent after searching all sources.
- Notes: be specific — mention actual numbers (ARR, users, growth rate, GMV) if present.`;

const extractDealFromEmail = async (subject, from, body, attachments = [], websiteText = null) => {
  const deckAttachments = attachments.filter((a) => a.readable && a.text);
  const hintAttachments = attachments.filter((a) => !a.readable);

  // Increase excerpt limit — more deck context = better extraction
  let deckSection = '';
  for (const deck of deckAttachments) {
    const excerpt = deck.text.slice(0, 15000); // ~3750 tokens per deck
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

  const prompt = `Extract deal information from this pitch email${deckAttachments.length ? ', attached deck,' : ''}${websiteText ? ' and company website' : ''}.
Return a single JSON object. If this is NOT a startup pitch or investment opportunity, return: {"is_pitch": false}

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

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0].message.content.trim();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('[Groq] Invalid JSON response:', text.slice(0, 200));
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
 * Extract deal info from DocSend slide screenshots using Gemini vision.
 * @param {string}   subject - Email subject
 * @param {string}   from    - Sender
 * @param {string[]} images  - Array of base64 JPEG screenshots
 */
const extractDealFromImages = async (subject, from, images) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const imageParts = images.slice(0, 10).map((b64) => ({
    inlineData: { mimeType: 'image/jpeg', data: b64 },
  }));

  const prompt = `You are a senior VC analyst. These are screenshots from a startup pitch deck shared via DocSend.

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

  const result = await model.generateContent([prompt, ...imageParts]);
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

module.exports = { extractDealFromEmail, extractDealFromImages };
