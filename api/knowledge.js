// Retrieve schema-matched aggregate KDD learning observations.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Supabase is not configured' });
  const h = { apikey: key, authorization: `Bearer ${key}` };
  try { const r = await fetch(`${url}/rest/v1/datafix_learning?select=id,created_at,dataset_name,schema_fingerprint,score_delta,issue_patterns,repair_patterns,knowledge&order=created_at.desc&limit=100`, { headers: h }); const body = await r.json().catch(() => ({})); return res.status(r.status).json(r.ok ? body : { error: body.message || body.details || body.hint || 'KDD query failed' }); }
  catch (e) { return res.status(500).json({ error: e.message }); }
}
