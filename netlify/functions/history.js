// Plankworth — recent valuations history (anonymized)
exports.handler = async (event) => {
  const TURSO_DB_URL = process.env.TURSO_DB_URL;
  const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN;

  if (!TURSO_DB_URL || !TURSO_DB_TOKEN) {
    return { statusCode: 200, body: JSON.stringify({ valuations: [] }) };
  }

  const limit = Math.min(parseInt((event.queryStringParameters || {}).limit) || 6, 24);

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
              sql: `SELECT species, dbh_inches, homeowner_payout_low, homeowner_payout_high, zip_code, condition_grade FROM plankworth_valuations WHERE homeowner_payout_high > 0 ORDER BY created_at DESC LIMIT ?`,
              args: [{ type: 'integer', value: String(limit) }]
            }
          },
          { type: 'close' }
        ]
      })
    });

    if (!res.ok) {
      return { statusCode: 200, body: JSON.stringify({ valuations: [] }) };
    }

    const data = await res.json();
    const rows = data?.results?.[0]?.response?.result?.rows || [];

    const valuations = rows.map(r => ({
      species: r[0]?.value || 'Unknown',
      dbh_inches: r[1]?.value ? Math.round(Number(r[1].value)) : null,
      homeowner_payout_low: Number(r[2]?.value || 0),
      homeowner_payout_high: Number(r[3]?.value || 0),
      zip_prefix: r[4]?.value ? String(r[4].value).slice(0, 3) + 'xx' : null,
      condition_grade: r[5]?.value || null
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valuations })
    };
  } catch (err) {
    console.error('history error:', err);
    return { statusCode: 200, body: JSON.stringify({ valuations: [] }) };
  }
};
