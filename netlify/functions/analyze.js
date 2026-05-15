// Plankworth — AI Tree Valuator
// Accepts a tree photo + optional DBH/ZIP, returns species + board feet + payout estimate.
// Stack: Gemini Vision (gemini-2.0-flash) for ID, Turso HTTP for logging.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const TURSO_DB_URL = process.env.TURSO_DB_URL;
  const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN;

  if (!GEMINI_API_KEY) {
    return { statusCode: 500, body: 'Server misconfigured — missing GEMINI_API_KEY' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { image, trunk_diameter_inches, zip_code } = body;
  if (!image || !image.startsWith('data:image/')) {
    return { statusCode: 400, body: 'Missing or invalid image (expected data URL)' };
  }

  // Extract mime + base64 data
  const match = image.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) return { statusCode: 400, body: 'Invalid image data URL format' };
  const [, mimeType, base64Data] = match;

  // === Gemini prompt ===
  const prompt = `You are a forestry expert helping a homeowner evaluate whether their tree has lumber value.

Analyze the photo of a tree. Output STRICT JSON with these fields and nothing else:

{
  "species": "common name + (Latin name)",
  "species_confidence": 0.0 to 1.0,
  "dbh_inches": estimated trunk diameter at breast height in inches (integer or null if unable to estimate),
  "height_feet": estimated height in feet (integer or null),
  "board_feet": estimated saw-quality board feet (integer or null),
  "condition_grade": "premium" | "standard" | "low" | "firewood",
  "retail_value_low": estimated retail lumber value in USD (integer),
  "retail_value_high": estimated retail lumber value in USD (integer),
  "homeowner_payout_low": likely mill payout to homeowner in USD (integer),
  "homeowner_payout_high": likely mill payout to homeowner in USD (integer),
  "likely_removal_cost_avoided": estimated tree-removal cost the homeowner avoids if mill hauls (integer USD),
  "reasoning": "2-3 sentences explaining the estimate, citing visible cues (bark, leaf shape, trunk straightness, etc.)",
  "condition_notes": "1-2 sentences on visible defects (rot, hollow, cracks, leaning) or qualities (straight trunk, no scars)",
  "next_steps": "1-2 sentences of practical advice for the homeowner"
}

Pricing reference (US retail per board foot, 2026 estimates):
- Black walnut: $12-25/bf
- White oak (quartersawn premium): $10-18/bf, (plainsawn): $5-9/bf
- Cherry: $6-12/bf
- Hard maple (sugar maple): $5-10/bf
- Red oak: $4-8/bf
- Elm: $3-6/bf
- Ash: $4-7/bf
- Hickory: $4-8/bf
- Sycamore, soft maple, poplar, pine: $1-3/bf (typically firewood-grade)

A homeowner typically receives 25-40% of retail value (mill keeps the spread for milling labor, drying, marketing). If condition is "firewood" or trunk is under 18 inches DBH, set homeowner_payout to a small range ($0-150) or zero — most mills won't take it.

${trunk_diameter_inches ? `The homeowner says trunk diameter (DBH) is approximately ${trunk_diameter_inches} inches — use this as ground truth.` : 'Estimate trunk diameter from visual cues (person/object for scale, trunk vs canopy ratio).'}
${zip_code ? `The tree is located near ZIP ${zip_code}.` : ''}

Use the Doyle log rule for board feet estimate: BF ≈ ((DBH - 4) / 4)² × merchantable_log_length_feet. Assume merchantable log length of 12-16 feet for healthy mature trees.

Output JSON ONLY. No markdown, no commentary, no code fences.`;

  // === Call Gemini ===
  let geminiResponse;
  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: {
            temperature: 0.3,
            response_mime_type: 'application/json'
          }
        })
      }
    );

    if (!gemRes.ok) {
      const errBody = await gemRes.text();
      console.error('Gemini error:', gemRes.status, errBody);
      return { statusCode: 502, body: `AI service unavailable (${gemRes.status})` };
    }

    geminiResponse = await gemRes.json();
  } catch (err) {
    console.error('Gemini fetch failed:', err);
    return { statusCode: 502, body: 'AI service unavailable' };
  }

  // === Parse Gemini response ===
  let parsed;
  try {
    const text = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty Gemini response');
    parsed = JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse Gemini JSON:', err, geminiResponse);
    return { statusCode: 502, body: 'AI returned malformed response — try again' };
  }

  // === Best-effort logging to Turso (non-blocking) ===
  if (TURSO_DB_URL && TURSO_DB_TOKEN) {
    try {
      await fetch(`${TURSO_DB_URL.replace('libsql://', 'https://')}/v2/pipeline`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TURSO_DB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            {
              type: 'execute',
              stmt: {
                sql: 'INSERT INTO plankworth_valuations (zip_code, species, species_confidence, dbh_inches, height_feet, board_feet, retail_value_low, retail_value_high, homeowner_payout_low, homeowner_payout_high, condition_grade, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                args: [
                  { type: 'text', value: zip_code || '' },
                  { type: 'text', value: parsed.species || '' },
                  { type: 'float', value: parsed.species_confidence ?? 0 },
                  { type: 'float', value: parsed.dbh_inches ?? 0 },
                  { type: 'float', value: parsed.height_feet ?? 0 },
                  { type: 'float', value: parsed.board_feet ?? 0 },
                  { type: 'integer', value: String(parsed.retail_value_low ?? 0) },
                  { type: 'integer', value: String(parsed.retail_value_high ?? 0) },
                  { type: 'integer', value: String(parsed.homeowner_payout_low ?? 0) },
                  { type: 'integer', value: String(parsed.homeowner_payout_high ?? 0) },
                  { type: 'text', value: parsed.condition_grade || '' },
                  { type: 'text', value: (parsed.reasoning || '').slice(0, 800) }
                ]
              }
            },
            { type: 'close' }
          ]
        })
      });
    } catch (err) {
      console.error('Turso logging failed (non-blocking):', err);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed)
  };
};
