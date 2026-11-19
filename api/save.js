// Supabase persistence for audit runs and aggregated KDD learning observations.
export default async function handler(req, res) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env and restart the server.' });
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const t = `${url}/rest/v1/datafix_runs`;
  try {
    if (req.method === 'GET') { const r = await fetch(`${t}?select=id,created_at,dataset_name,rows_before,rows_after,score_before,score_after&order=created_at.desc&limit=50`, { headers: h }); const body = await r.json().catch(() => ({})); return res.status(r.status).json(r.ok ? body : { error: body.message || body.details || body.hint || 'Supabase history query failed' }); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    const b = req.body || {}, log = Array.isArray(b.log) ? b.log.slice(0, 2000) : [];
    const row = { dataset_name: String(b.name || 'dataset').slice(0, 200), rows_before: Number(b.rowsBefore || 0), rows_after: Number(b.rowsAfter || 0), score_before: Number(b.scoreBefore || 0), score_after: Number(b.scoreAfter || 0), report: b.report || {}, change_log: log };
    const r = await fetch(t, { method: 'POST', headers: { ...h, prefer: 'return=representation' }, body: JSON.stringify(row) });
    const saved = await r.json().catch(() => ({})); if (!r.ok) return res.status(r.status).json({ error: saved.message || saved.details || saved.hint || 'Failed to save analysis history' });
    // Store aggregate signals only; never store uploaded raw dataset cells.
    const algorithms = {}; for (const entry of log) { const k = String(entry.algorithm || 'unknown'); const v = algorithms[k] || (algorithms[k] = { count: 0, confidenceSum: 0 }); v.count++; v.confidenceSum += Number(entry.confidence || 0); }
    const report = b.report || {}, scoreDelta = Number(b.scoreAfter || 0) - Number(b.scoreBefore || 0);
    const learning = { dataset_name: row.dataset_name, schema_fingerprint: String(b.schemaFingerprint || '').slice(0, 512), score_delta: scoreDelta, issue_patterns: report.issuePatterns || report.issueCounts || {}, repair_patterns: Object.entries(algorithms).map(([algorithm, v]) => ({ algorithm, count: v.count, mean_confidence: v.count ? v.confidenceSum / v.count : 0 })), knowledge: { runs: 1, observed_issue_counts: report.issueCounts || report.issuePatterns || {}, algorithm_outcomes: algorithms, score_delta: scoreDelta, saved_repairs: log.length, learning_basis: 'Dataset-level quality-score delta and applied repair confidence are historical proxy signals; they are not ground-truth labels.' } };
    const learnRes = await fetch(`${url}/rest/v1/datafix_learning`, { method: 'POST', headers: { ...h, prefer: 'return=minimal' }, body: JSON.stringify(learning) });
    const learnText = await learnRes.text(); let learnError = ''; if (!learnRes.ok) { try { const x = JSON.parse(learnText); learnError = x.message || x.details || x.hint || learnText; } catch { learnError = learnText; } }
    return res.status(200).json({ id: saved[0]?.id, historySaved: true, learningSaved: learnRes.ok, learningError: learnRes.ok ? undefined : learnError, message: learnRes.ok ? 'Analysis and learning observation saved.' : 'Analysis saved, but KDD learning record failed to save.' });
  } catch (e) { return res.status(500).json({ error: e.message || 'Supabase request failed' }); }
}
