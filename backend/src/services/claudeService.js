const Groq = require('groq-sdk');

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

module.exports = { extractDealFromEmail };
