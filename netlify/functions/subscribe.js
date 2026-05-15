// Plankworth — email subscribe handler
// Writes to Turso `subscribers` table.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const TURSO_DB_URL = process.env.TURSO_DB_URL;
  const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN;
  const IDEA_SLUG = process.env.IDEA_SLUG || 'plankworth';

  if (!TURSO_DB_URL || !TURSO_DB_TOKEN) {
    return { statusCode: 500, body: 'Database not configured' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const email = (body.email || '').trim().toLowerCase();
  const zipCode = (body.zip_code || '').trim();

  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return { statusCode: 400, body: 'Invalid email' };
  }

  try {
    const res = await fetch(`${TURSO_DB_URL.replace('libsql://', 'https://')}/v2/pipeline`, {
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
              sql: 'INSERT OR IGNORE INTO subscribers (email, idea_slug, source) VALUES (?, ?, ?)',
              args: [
                { type: 'text', value: email },
                { type: 'text', value: IDEA_SLUG },
                { type: 'text', value: zipCode ? `tool_capture:${zipCode}` : 'tool_capture' }
              ]
            }
          },
          { type: 'close' }
        ]
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Turso insert failed:', res.status, txt);
      return { statusCode: 502, body: 'Could not save subscription' };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('subscribe error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};
