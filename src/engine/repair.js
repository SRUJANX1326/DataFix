// Safe, explainable repair pipeline. Every change is logged with algorithm, confidence and reason.
import { isMissing, toNum, isPlainNumber, parseDate, toISO, same, quantile } from './util.js';
import { RX, profileDataset } from './profile.js';
import { categoryClusters, fixEmail, caseStyle, titleCase, phoneSig, normPhone, BOOL_TRUE, BOOL_FALSE, detect, findDuplicates, outlierVotes } from './detect.js';
import { planImputation } from './impute.js';

export function repair(ds, prof, opts = {}) {
  const o = { minConfidence: 0.5, seed: 42, ...opts }, columns = ds.columns, C = columns.length, P = prof.cols;
  let rows = ds.rows.map((r) => r.slice()), orig = rows.map((_, i) => i); const log = [], skipped = []; let lid = 0;
  const apply = (r, c, after, m) => { const before = rows[r][c]; if (same(before, after)) return false; const adjustment = Number(o.learnedThresholdAdjustments?.[m.algorithm] || 0); const threshold = Math.max(0.05, Math.min(0.99, o.minConfidence + adjustment)); if (m.confidence < threshold) { skipped.push({ row: orig[r], col: c, colName: columns[c], before, after, learningAdjustment: adjustment, decisionThreshold: threshold, ...m }); return false; } rows[r][c] = after; log.push({ id: ++lid, row: orig[r], col: c, colName: columns[c], before, after, learningAdjustment: adjustment, decisionThreshold: threshold, ...m }); return true; };
  const str = (v) => String(v).trim();

  // 1. Noise + placeholders (Unicode Normalization, Regex, Rule-based normalization)
  const clean = (s) => { let t = s; const a = []; if (/Ã.|â€/.test(t)) { try { const f = decodeURIComponent(escape(t)); if (f !== t) { t = f; a.push('Mojibake repair (UTF-8 re-decode)'); } } catch { /* keep */ } } const n1 = t.normalize('NFKC'); if (n1 !== t) { t = n1; a.push('Unicode Normalization (NFKC)'); } const n2 = t.replace(/<[^>]+>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g, ''); if (n2 !== t) { t = n2; a.push('Regular Expressions (strip markup/control chars)'); } const n3 = t.replace(/\s+/g, ' ').trim(); if (n3 !== t) { t = n3; a.push('Regular Expressions (whitespace normalization)'); } return [t, a]; };
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < C; c++) { const v = rows[r][c]; if (typeof v !== 'string') continue; if (v.trim() === '') { rows[r][c] = null; continue; } if (isMissing(v)) { apply(r, c, null, { issueType: 'missing', algorithm: 'Rule-Based Normalization', confidence: 0.99, reason: `Placeholder “${v}” converted to a true null so it can be handled as missing` }); continue; } const [t, a] = clean(v); if (a.length) apply(r, c, t, { issueType: 'noise', algorithm: a.join(' + '), confidence: 0.99, reason: 'Removed invisible/duplicated whitespace, markup or encoding noise without changing meaning' }); }

  // 2. Standardization per column type
  for (const p of P) { const c = p.index; const live = () => rows.map((r, i) => i).filter((i) => !isMissing(rows[i][c]));
    if (p.type === 'number') for (const r of live()) { const v = rows[r][c], x = toNum(v); if (x == null) apply(r, c, null, { issueType: 'type', algorithm: 'Type Validation → Missing', confidence: 0.9, reason: `“${v}” is not numeric in a numeric column; treated as missing and re-estimated` }); else if (typeof v !== 'number') { if (isPlainNumber(v)) rows[r][c] = x; else apply(r, c, x, { issueType: 'inconsistent', algorithm: 'Regular Expressions + Canonicalization (numeric parse)', confidence: 0.96, reason: `Stripped currency/unit/thousand separators from “${v}”` }); } }
    else if (p.type === 'date') { const fm = new Set(); live().forEach((r) => { const d = parseDate(str(rows[r][c]), p.order); if (d?.valid) fm.add(d.fmt); }); if (fm.size > 1) live().forEach((r) => { const s = str(rows[r][c]), d = parseDate(s, p.order); if (d?.valid && toISO(d) !== s) { const amb = /^\d{1,2}[-\/.]\d{1,2}[-\/.]/.test(s) && +s.match(/^(\d+)[-\/.](\d+)/)[1] <= 12 && +s.match(/^(\d+)[-\/.](\d+)/)[2] <= 12; apply(r, c, toISO(d), { issueType: 'inconsistent', algorithm: 'Canonicalization (ISO-8601 date)', confidence: amb ? 0.75 : 0.95, reason: `Converted ${d.fmt} to ISO 8601${amb ? ` (ambiguous day/month resolved as ${p.order})` : ''}` }); } }); }
    else if (p.type === 'email') for (const r of live()) { const s = str(rows[r][c]), f = fixEmail(s); if (f !== s && RX.email.test(f)) apply(r, c, f, { issueType: 'inconsistent', algorithm: 'Case Folding + Dictionary Mapping (domain typos)', confidence: f.split('@')[1] !== s.toLowerCase().split('@')[1] ? 0.88 : 0.99, reason: 'Lower-cased / corrected a known domain typo' }); }
    else if (p.type === 'phone') { const sig = new Set(live().map((r) => phoneSig(str(rows[r][c])))); if (sig.size > 1) live().forEach((r) => { const s = str(rows[r][c]), dg = s.replace(/\D/g, '').length; if (RX.phone.test(s) && dg >= 7 && dg <= 15) apply(r, c, normPhone(s), { issueType: 'inconsistent', algorithm: 'Regular Expressions (phone canonicalization)', confidence: 0.93, reason: 'Unified phone formatting to digits with optional leading +' }); }); }
    else if (p.type === 'boolean') { const f = new Map(); live().forEach((r) => { const s = str(rows[r][c]); f.set(s, (f.get(s) || 0) + 1); }); if (f.size > 2) { const dom = (re) => [...f.entries()].filter(([k]) => re.test(k)).sort((a, b) => b[1] - a[1])[0]?.[0]; const dt = dom(BOOL_TRUE), df = dom(BOOL_FALSE); live().forEach((r) => { const s = str(rows[r][c]); const t = BOOL_TRUE.test(s) ? dt : BOOL_FALSE.test(s) ? df : null; if (t && t !== s) apply(r, c, t, { issueType: 'inconsistent', algorithm: 'Dictionary Mapping (boolean)', confidence: 0.97, reason: `Mapped “${s}” to the dominant encoding “${t}”` }); }); } }
    else if (p.type === 'string' && p.isCategorical) { const idx = live(), map = categoryClusters(idx.map((r) => str(rows[r][c]))); idx.forEach((r) => { const s = str(rows[r][c]), m = map.get(s); if (m && m.to !== s) apply(r, c, m.to, { issueType: 'inconsistent', algorithm: m.method, confidence: Math.round(m.conf * 100) / 100, reason: `“${s}” is a variant of the dominant value “${m.to}”` }); }); }
    else if (p.type === 'string' && p.semantic === 'name') { const st = new Set(live().map((r) => caseStyle(str(rows[r][c])))); st.delete('none'); if (st.size > 1) live().forEach((r) => { const s = str(rows[r][c]); if (caseStyle(s) !== 'title' && caseStyle(s) !== 'none') apply(r, c, titleCase(s), { issueType: 'inconsistent', algorithm: 'Case Folding + Title-Case Canonicalization', confidence: 0.9, reason: 'Unified name casing' }); }); }
  }
  // Functional-dependency repair (lookup built from the data's own majority mapping)
  { const cur = { columns, rows, ragged: [] }; for (const i of detect(cur, profileDataset(cur), { fast: true }).filter((i) => i.subtype === 'fd_violation')) apply(i.row, i.col, i.suggest, { issueType: 'integrity', algorithm: 'Lookup-Table Standardization (functional-dependency majority)', confidence: Math.round(Math.min(0.95, i.conf) * 0.95 * 100) / 100, reason: i.message }); }

  // 3. Duplicates: Hash / Fellegi–Sunter clusters -> survivorship merge
  { const cur = { columns, rows }, pf = profileDataset(cur), d = findDuplicates(cur, pf); if (d.length) {
    const parent = rows.map((_, i) => i), find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }; d.forEach((x) => { parent[find(x.row)] = find(x.of); }); const cl = new Map(); rows.forEach((_, i) => { const k = find(i); (cl.get(k) || cl.set(k, []).get(k)).push(i); });
    const info = new Map(d.map((x) => [x.row, x])); const drop = new Set(); const nm = (r) => rows[r].filter((v) => !isMissing(v)).length;
    for (const mem of cl.values()) { if (mem.length < 2) continue; const keep = [...mem].sort((a, b) => nm(b) - nm(a) || a - b)[0];
      for (const r of mem) {
        if (r === keep) continue;
        const x = info.get(r) || d.find((q) => q.of === r) || {};
        const algorithm = x.method || 'Hash-Based Deduplication';
        const confidence = Math.round((x.sim ?? 1) * 100) / 100;
        const adjustment = Number(o.learnedThresholdAdjustments?.[algorithm] || 0);
        const threshold = Math.max(0.05, Math.min(0.99, o.minConfidence + adjustment));
        if (confidence < threshold) {
          skipped.push({ row: orig[r], col: -1, colName: null, before: JSON.stringify(Object.fromEntries(columns.map((k, i) => [k, rows[r][i]]))), after: null, issueType: 'duplicate', action: 'row_removal_proposed', algorithm, confidence, learningAdjustment: adjustment, decisionThreshold: threshold, reason: `Duplicate of row ${orig[keep] + 1}; removal withheld because confidence is below the adjusted threshold` });
          continue;
        }
        for (let c = 0; c < C; c++) if (isMissing(rows[keep][c]) && !isMissing(rows[r][c])) apply(keep, c, rows[r][c], { issueType: 'duplicate', algorithm: 'Entity Resolution (survivorship merge)', confidence: 0.9, reason: `Filled empty field from duplicate record (row ${orig[r] + 1})` });
        drop.add(r);
        log.push({ id: ++lid, row: orig[r], col: -1, colName: null, before: JSON.stringify(Object.fromEntries(columns.map((k, i) => [k, rows[r][i]]))), after: null, issueType: 'duplicate', action: 'row_removed', algorithm, confidence, learningAdjustment: adjustment, decisionThreshold: threshold, reason: `Duplicate of row ${orig[keep] + 1}; the more complete record was kept` });
      } }
    rows = rows.filter((_, i) => !drop.has(i)); orig = orig.filter((_, i) => !drop.has(i)); } }

  // 4. Integrity & outliers
  { const cur = { columns, rows, ragged: [] }, iss = detect(cur, profileDataset(cur), { fast: true }); const touched = new Set();
    for (const i of iss.filter((i) => i.type === 'integrity' && i.subtype === 'domain')) { const x = toNum(rows[i.row][i.col]); if (x == null) continue; const pr = P[i.col]; const ok = x < 0 && pr.max != null && Math.abs(x) <= pr.q3 + 1.5 * (pr.q3 - pr.q1); touched.add(i.row * C + i.col); if (ok) apply(i.row, i.col, Math.abs(x), { issueType: 'integrity', algorithm: 'Sign Correction (domain rule)', confidence: 0.7, reason: `Negative ${pr.name} flipped to ${Math.abs(x)} (magnitude is plausible)` }); else apply(i.row, i.col, null, { issueType: 'integrity', algorithm: 'Domain Rule Validation → Missing', confidence: 0.85, reason: i.message + '; set to missing and re-estimated' }); }
    for (const i of iss.filter((i) => i.type === 'outlier' && i.votes >= 4 && !touched.has(i.row * C + i.col))) { const x = toNum(rows[i.row][i.col]); if (x == null) continue; const [lo, hi] = i.fences; apply(i.row, i.col, Math.round((x < lo ? lo : hi) * 100) / 100, { issueType: 'outlier', algorithm: 'Winsorization at IQR fence (confirmed by ' + i.detector + ')', confidence: 0.7, reason: `${x} exceeds the plausible range [${lo.toFixed(1)}, ${hi.toFixed(1)}]; capped (record kept, relationships preserved). Lower-vote outliers are retained for review.` }); } }

  // 5. Missing values: back-tested autonomous imputation
  const plan = planImputation(rows, profileDataset({ columns, rows }).cols, o.seed);
  for (const f of plan.fills) apply(f.r, f.c, f.value, { issueType: 'missing', algorithm: f.method, confidence: f.confidence, reason: f.reason });
  return { rows, rowMap: orig, log, skipped, backtest: plan.backtest, unresolved: plan.unresolved };
}
