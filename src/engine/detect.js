// Detection of missing, duplicate, invalid, inconsistent, outlier, noise, type/schema and integrity problems.
import { isMissing, toNum, isPlainNumber, parseDate, toISO, mean, std, median, mad, quantile, cellRef, rng, sample } from './util.js';
import { RX } from './profile.js';
import { jaroWinkler, damerau, soundex, BKTree, fnv, shingles, minhash, lshBuckets } from './similarity.js';

const EMAIL_TYPOS = { 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com' };
export const fixEmail = (s) => { let e = String(s).trim().toLowerCase().replace(/\s+/g, ''); const m = e.match(/^([^@]+)@(.+)$/); if (m && EMAIL_TYPOS[m[2]]) e = `${m[1]}@${EMAIL_TYPOS[m[2]]}`; return e; };
export const normKey = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const caseStyle = (s) => (/[a-z]/i.test(s) ? (s === s.toUpperCase() ? 'upper' : s === s.toLowerCase() ? 'lower' : 'title') : 'none');
export const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])([a-z\u00c0-\u024f])/g, (_, a, b) => a + b.toUpperCase());
export const phoneSig = (s) => String(s).replace(/\d/g, '9').replace(/9+/g, '9');
export const normPhone = (s) => { const t = String(s).trim(); const d = t.replace(/\D/g, ''); return (t.startsWith('+') ? '+' : '') + d; };
export const BOOL_TRUE = /^(true|yes|y|t|1)$/i, BOOL_FALSE = /^(false|no|n|f|0)$/i;
const NONNEG = /price|amount|salary|cost|revenue|income|fee|total|qty|quantity|count|stock|units|orders|weight|height|age/;

// Cluster categorical values: normalization key (case/space/punct/accent) + fuzzy (BK-tree / Damerau / Jaro-Winkler / Soundex).
export function categoryClusters(values) {
  const counts = new Map(); values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const groups = new Map(); for (const [v, c] of counts) { const k = normKey(v); const g = groups.get(k) || { key: k, vals: [], count: 0 }; g.vals.push([v, c]); g.count += c; groups.set(k, g); }
  const gl = [...groups.values()].sort((a, b) => b.count - a.count); gl.forEach((g) => { g.canon = g.vals.sort((a, b) => b[1] - a[1])[0][0]; });
  const tree = new BKTree(); gl.forEach((g) => g.key.length >= 4 && tree.add(g.key)); const byKey = new Map(gl.map((g) => [g.key, g]));
  const map = new Map(); // raw -> {to, conf, method}
  for (const g of gl) {
    let target = null;
    if (g.key.length >= 4) {
      const maxD = g.key.length >= 9 ? 2 : 1; let best = null;
      for (const [k2, d] of tree.search(g.key, maxD)) { const o = byKey.get(k2); if (!o || o === g || o.count < g.count * 2) continue; if (/\d/.test(g.key) && g.key.replace(/\D/g, '') !== k2.replace(/\D/g, '')) continue; const jw = jaroWinkler(g.key, k2); if (jw < 0.88 && soundex(g.key) !== soundex(k2)) continue; if (!best || o.count > best.o.count) best = { o, d, jw }; }
      if (best) target = { to: best.o.canon, conf: Math.min(0.95, best.jw * 0.95), method: `Damerau–Levenshtein d=${best.d} + Jaro-Winkler ${best.jw.toFixed(2)} (BK-tree)` };
    }
    for (const [raw] of g.vals) {
      if (target) map.set(raw, target);
      else if (raw !== g.canon) map.set(raw, { to: g.canon, conf: 0.97, method: 'Case folding + whitespace/punctuation canonicalization' });
    }
  }
  return map;
}

// Univariate outlier votes per value: Z-score, Modified Z, IQR, MAD, Grubbs.
export function outlierVotes(nums) {
  const n = nums.length; if (n < 8) return null; const mu = mean(nums), sd = std(nums), med = median(nums), md = mad(nums, med), s = [...nums].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const t = 2.5; const gcrit = ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t)); // approx Grubbs critical (alpha~.05)
  return { fences: [lo, hi], med, vote: (x) => { const v = []; if (sd && Math.abs(x - mu) / sd > 3) v.push('Z-Score'); if (md && 0.6745 * Math.abs(x - med) / md > 3.5) v.push('Modified Z-Score'); if (iqr && (x < lo || x > hi)) v.push('IQR'); if (md && Math.abs(x - med) / (1.4826 * md) > 3) v.push('MAD'); if (sd && Math.abs(x - mu) / sd > gcrit) v.push("Grubbs' Test"); return v; } };
}

// Isolation Forest (multivariate anomaly score, seeded).
export function isolationForest(X, trees = 80, seed = 7) {
  const n = X.length, d = X[0]?.length || 0, rand = rng(seed), psi = Math.min(256, n), hl = Math.ceil(Math.log2(psi));
  const c = (m) => (m > 2 ? 2 * (Math.log(m - 1) + 0.5772156649) - (2 * (m - 1)) / m : m === 2 ? 1 : 0);
  const build = (idx, depth) => { if (depth >= hl || idx.length <= 1) return { size: idx.length }; const f = Math.floor(rand() * d); let lo = Infinity, hi = -Infinity; for (const i of idx) { lo = Math.min(lo, X[i][f]); hi = Math.max(hi, X[i][f]); } if (lo === hi) return { size: idx.length }; const sp = lo + rand() * (hi - lo); return { f, sp, l: build(idx.filter((i) => X[i][f] < sp), depth + 1), r: build(idx.filter((i) => X[i][f] >= sp), depth + 1) }; };
  const path = (nd, x, dep) => (nd.f === undefined ? dep + c(nd.size) : path(x[nd.f] < nd.sp ? nd.l : nd.r, x, dep + 1));
  const forest = Array.from({ length: trees }, () => build(sample([...Array(n).keys()], psi, rand), 0));
  return X.map((x) => 2 ** (-(forest.reduce((a, t) => a + path(t, x, 0), 0) / trees) / c(psi)));
}

export function detect(ds, prof, opts = {}) {
  const { columns, rows } = ds, n = rows.length, C = columns.length, issues = []; let id = 0;
  const add = (o) => issues.push({ id: ++id, severity: 'medium', subtype: '', cause: '', detector: '', ...o, colName: o.col >= 0 ? columns[o.col] : null, ref: o.col >= 0 ? cellRef(o.row, o.col) : `Row ${o.row + 1}` });
  const P = prof.cols, val = (r, c) => rows[r][c], str = (v) => (typeof v === 'string' ? v : String(v));
  for (const g of ds.ragged || []) add({ type: 'type', subtype: 'ragged_row', row: g.row, col: -1, value: `${g.found} fields`, message: `Row has ${g.found} fields but the header defines ${C}`, cause: 'Unescaped delimiter or truncated line in source file', detector: 'Schema check', severity: 'high' });

  for (const p of P) {
    const c = p.index;
    // ---- Missing
    for (let r = 0; r < n; r++) { const v = val(r, c); if (isMissing(v)) { const empty = v == null || (typeof v === 'string' && v.trim() === ''); add({ type: 'missing', subtype: empty ? 'empty' : 'placeholder', row: r, col: c, value: v, message: empty ? 'Empty value' : `Placeholder “${v}” used instead of a real value`, detector: 'Null / placeholder token scan', severity: p.missing / n > 0.3 ? 'high' : 'medium' }); } }
    // ---- Noise (all string cells)
    for (let r = 0; r < n; r++) {
      const v = val(r, c); if (typeof v !== 'string' || isMissing(v)) continue; let k = null;
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF\u00A0]/.test(v)) k = 'Invisible/control characters'; else if (/<[^>]+>/.test(v)) k = 'HTML/markup residue'; else if (/Ã.|â€/.test(v)) k = 'Mojibake (encoding error)'; else if (v !== v.trim()) k = 'Leading/trailing whitespace'; else if (/\s{2,}/.test(v)) k = 'Repeated whitespace'; else if (v !== v.normalize('NFKC')) k = 'Non-normalized Unicode';
      if (k) add({ type: 'noise', subtype: k, row: r, col: c, value: v, message: k, cause: 'Copy-paste, scraping or encoding mismatch during ingestion', detector: 'Regex / Unicode NFKC scan', severity: 'low' });
    }
    const live = []; for (let r = 0; r < n; r++) { const v = val(r, c); if (!isMissing(v)) live.push(r); }
    // ---- Type-specific validity / consistency
    if (p.type === 'number') {
      const nums = [];
      for (const r of live) { const v = val(r, c), x = toNum(v); if (x == null) add({ type: 'type', subtype: 'text_in_numeric', row: r, col: c, value: v, message: `Non-numeric text “${v}” in numeric column (${Math.round(p.ratios.numeric * 100)}% numeric)`, cause: 'Free-text entry / wrong column mapping / import error', detector: 'Type inference', severity: 'high' }); else { nums.push([r, x]); if (!isPlainNumber(v)) add({ type: 'inconsistent', subtype: 'formatted_number', row: r, col: c, value: v, message: `Number stored as formatted text “${v}”`, cause: 'Currency/unit/thousand separators from mixed source formats', detector: 'Regex numeric parse', severity: 'low' }); } }
      const arr = nums.map((x) => x[1]); const ov = p.semantic !== 'id' && p.unique > 12 ? outlierVotes(arr) : null;
      if (ov) nums.forEach(([r, x]) => { const v = ov.vote(x); if (v.length >= 2) add({ type: 'outlier', subtype: `votes:${v.length}`, row: r, col: c, value: val(r, c), votes: v.length, fences: ov.fences, message: `Statistical outlier (${v.length}/5 detectors) – expected ≈ [${ov.fences[0].toFixed(1)}, ${ov.fences[1].toFixed(1)}]`, cause: 'Typing error, unit mix-up or genuine extreme value', detector: v.join(', '), severity: v.length >= 4 ? 'high' : 'medium' }); });
      // domain integrity
      for (const [r, x] of nums) {
        if (p.semantic === 'age' && (x < 0 || x > 120)) add({ type: 'integrity', subtype: 'domain', row: r, col: c, value: val(r, c), message: `Age ${x} is outside plausible range 0–120`, cause: 'Typing error / sign error / wrong field', detector: 'Domain rule', severity: 'high' });
        else if (NONNEG.test(p.name.toLowerCase()) && x < 0) add({ type: 'integrity', subtype: 'domain', row: r, col: c, value: val(r, c), message: `Negative value ${x} in a non-negative field`, cause: 'Sign error or refund/return recorded in wrong column', detector: 'Domain rule', severity: 'high' });
      }
    } else if (p.type === 'date') {
      const fm = new Map(); const now = Date.now();
      for (const r of live) { const v = val(r, c), d = parseDate(str(v), p.order); if (!d) add({ type: 'invalid', subtype: 'bad_date', row: r, col: c, value: v, message: `Unparseable date “${v}”`, cause: 'Free-text or wrong delimiter in date field', detector: 'Date parser', severity: 'high' }); else if (!d.valid) add({ type: 'invalid', subtype: 'bad_date', row: r, col: c, value: v, message: `Impossible calendar date “${v}”`, cause: 'Day/month swap or typing error', detector: 'Calendar validation', severity: 'high' }); else { fm.set(d.fmt, (fm.get(d.fmt) || 0) + 1); if (d.ts > now + 864e5) add({ type: 'integrity', subtype: 'future_date', row: r, col: c, value: v, message: `Date ${toISO(d)} lies in the future`, cause: 'Typing error or placeholder date', detector: 'Timeliness rule', severity: 'medium' }); else if (d.y < 1900) add({ type: 'integrity', subtype: 'ancient_date', row: r, col: c, value: v, message: `Date ${toISO(d)} is implausibly old`, cause: 'Default/epoch placeholder', detector: 'Timeliness rule', severity: 'medium' }); } }
      if (fm.size > 1) { const dom = [...fm.entries()].sort((a, b) => b[1] - a[1])[0][0]; for (const r of live) { const d = parseDate(str(val(r, c)), p.order); if (d && d.valid && d.fmt !== dom) add({ type: 'inconsistent', subtype: 'date_format', row: r, col: c, value: val(r, c), message: `Date format ${d.fmt} differs from dominant ${dom}`, cause: 'Multiple source systems with different date conventions', detector: 'Format signature', severity: 'low' }); } }
    } else if (p.type === 'email') {
      for (const r of live) { const v = str(val(r, c)).trim(); if (!RX.email.test(v)) add({ type: 'invalid', subtype: 'bad_email', row: r, col: c, value: val(r, c), message: `Invalid email “${v}”`, cause: 'Typo, missing @ or domain', detector: 'Email regex', severity: 'high' }); else if (v !== v.toLowerCase() || EMAIL_TYPOS[v.split('@')[1]?.toLowerCase()]) add({ type: 'inconsistent', subtype: 'email_style', row: r, col: c, value: val(r, c), message: EMAIL_TYPOS[v.split('@')[1]?.toLowerCase()] ? 'Common domain typo' : 'Mixed-case email', cause: 'Manual entry', detector: 'Dictionary / case check', severity: 'low' }); }
    } else if (p.type === 'phone') {
      const sigs = new Map(); const lens = new Map(); live.forEach((r) => { const l = str(val(r, c)).replace(/\D/g, '').length; lens.set(l, (lens.get(l) || 0) + 1); }); const [ml, mc] = [...lens.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0]; const strict = mc / live.length >= 0.7; for (const r of live) { const v = str(val(r, c)).trim(), dg = v.replace(/\D/g, '').length; if (!RX.phone.test(v) || dg < 7 || dg > 15 || (strict && dg !== ml)) add({ type: 'invalid', subtype: 'bad_phone', row: r, col: c, value: val(r, c), message: `Phone “${v}” has ${dg} digits (${strict ? 'column norm is ' + ml : 'expected 7–15'})`, cause: 'Truncation / extra digits / typing error', detector: 'Phone pattern', severity: 'high' }); else { const s = phoneSig(v); sigs.set(s, (sigs.get(s) || 0) + 1); } }
      if (sigs.size > 1) { const dom = [...sigs.entries()].sort((a, b) => b[1] - a[1])[0][0]; for (const r of live) { const v = str(val(r, c)).trim(), dg = v.replace(/\D/g, '').length; if (RX.phone.test(v) && dg >= 7 && dg <= 15 && phoneSig(v) !== dom) add({ type: 'inconsistent', subtype: 'phone_format', row: r, col: c, value: val(r, c), message: `Phone format differs from dominant pattern “${dom}”`, cause: 'Different regional formatting conventions', detector: 'Format signature', severity: 'low' }); } }
    } else if (p.type === 'url') {
      for (const r of live) if (!RX.url.test(str(val(r, c)).trim())) add({ type: 'invalid', subtype: 'bad_url', row: r, col: c, value: val(r, c), message: 'Invalid URL', detector: 'URL regex', severity: 'medium' });
    } else if (p.type === 'boolean') {
      const fam = new Map(); for (const r of live) { const v = str(val(r, c)).trim(); fam.set(v, (fam.get(v) || 0) + 1); }
      if (fam.size > 2) { const dom = (re) => [...fam.entries()].filter(([k]) => re.test(k)).sort((a, b) => b[1] - a[1])[0]?.[0]; const dt = dom(BOOL_TRUE), df = dom(BOOL_FALSE); for (const r of live) { const v = str(val(r, c)).trim(); if (v !== dt && v !== df) add({ type: 'inconsistent', subtype: 'boolean_style', row: r, col: c, value: val(r, c), message: `Boolean written as “${v}” (dominant: ${dt}/${df})`, cause: 'Multiple encodings of yes/no', detector: 'Dictionary mapping', severity: 'low' }); } }
    } else if (p.type === 'string') {
      if (p.isCategorical) {
        const map = categoryClusters(live.map((r) => str(val(r, c)).trim()));
        for (const r of live) { const raw = str(val(r, c)).trim(), m = map.get(raw); if (m && m.to !== raw) add({ type: 'inconsistent', subtype: 'category_variant', row: r, col: c, value: val(r, c), suggest: m.to, conf: m.conf, message: `“${raw}” is a variant of “${m.to}”`, cause: 'Free-text entry of a coded field (case, spelling or abbreviation variants)', detector: m.method, severity: 'medium' }); }
      } else if (p.semantic === 'name') {
        const st = new Map(); live.forEach((r) => { const s = caseStyle(str(val(r, c))); st.set(s, (st.get(s) || 0) + 1); });
        if (st.size > 1) { const dom = [...st.entries()].sort((a, b) => b[1] - a[1])[0][0]; live.forEach((r) => { const s = caseStyle(str(val(r, c))); if (s !== dom && s !== 'none') add({ type: 'inconsistent', subtype: 'case_style', row: r, col: c, value: val(r, c), message: `Casing (${s}) differs from dominant style (${dom})`, cause: 'Mixed data-entry conventions', detector: 'Case-folding analysis', severity: 'low' }); }); }
      }
    }
  }

  // ---- Integrity: ID uniqueness, date ordering, functional dependencies
  for (const p of P.filter((p) => p.semantic === 'id')) {
    const seen = new Map(); for (let r = 0; r < n; r++) { const v = val(r, p.index); if (isMissing(v)) continue; const k = String(v).trim(); (seen.get(k) || seen.set(k, []).get(k)).push(r); }
    for (const [k, rs] of seen) if (rs.length > 1) rs.slice(1).forEach((r) => add({ type: 'integrity', subtype: 'key_conflict', row: r, col: p.index, value: k, message: `Key “${k}” also appears in row ${rs[0] + 1}`, cause: 'Duplicate load or key collision', detector: 'Primary-key uniqueness', severity: 'high' }));
  }
  const dcols = P.filter((p) => p.type === 'date'), startRx = /start|begin|from|created|order|signup|join/, endRx = /end|finish|updated|deliver|ship|expir|close|last/;
  for (const a of dcols.filter((p) => startRx.test(p.name.toLowerCase()))) for (const b of dcols.filter((p) => endRx.test(p.name.toLowerCase()) && p !== a)) for (let r = 0; r < n; r++) { const x = parseDate(str(val(r, a.index) ?? ''), a.order), y = parseDate(str(val(r, b.index) ?? ''), b.order); if (x?.valid && y?.valid && x.ts > y.ts) add({ type: 'integrity', subtype: 'date_order', row: r, col: b.index, value: val(r, b.index), message: `${b.name} (${toISO(y)}) is earlier than ${a.name} (${toISO(x)})`, cause: 'Swapped or mistyped dates', detector: 'Temporal-order rule', severity: 'high' }); }
  const cat = P.filter((p) => p.isCategorical && p.unique >= 2 && p.unique < n * 0.5 && !p.semantic?.match(/id/));
  if (cat.length <= 14) for (const A of cat) for (const B of cat) { if (A === B || A.unique <= B.unique * 0.5 && A.unique < 3) continue;
    const g = new Map(); for (let r = 0; r < n; r++) { const a = val(r, A.index), b = val(r, B.index); if (isMissing(a) || isMissing(b)) continue; const k = normKey(a), m = g.get(k) || g.set(k, new Map()).get(k); const bk = normKey(b); (m.get(bk) || m.set(bk, []).get(bk)).push(r); }
    let tot = 0, maj = 0; const viol = []; for (const m of g.values()) { const arr = [...m.values()], sz = arr.reduce((s, x) => s + x.length, 0); if (sz < 3) continue; arr.sort((x, y) => y.length - x.length); tot += sz; maj += arr[0].length; if (arr[0].length / sz >= 0.7) arr.slice(1).forEach((x) => x.forEach((r) => viol.push([r, rows[arr[0][0]][B.index]]))); }
    if (tot >= 20 && maj / tot >= 0.95 && viol.length) viol.forEach(([r, exp]) => add({ type: 'integrity', subtype: 'fd_violation', row: r, col: B.index, value: val(r, B.index), suggest: exp, conf: maj / tot, message: `${A.name} → ${B.name} violated (expected “${exp}” for “${val(r, A.index)}”)`, cause: 'Inconsistent entry breaking a functional dependency', detector: `Functional dependency ${A.name}→${B.name} (${(maj / tot * 100).toFixed(1)}% holds)`, severity: 'medium' })); }

  // ---- Multivariate anomalies (Isolation Forest)
  const numP = P.filter((p) => p.type === 'number' && p.semantic !== 'id' && p.missing / n < 0.5);
  if (numP.length >= 2 && n >= 30 && !opts.fast) {
    const meds = numP.map((p) => p.median), sds = numP.map((p) => p.std || 1), idxs = []; const X = [];
    for (let r = 0; r < n; r++) { const row = numP.map((p, i) => { const x = toNum(val(r, p.index)); return x == null ? meds[i] : x; }); X.push(row.map((x, i) => (x - meds[i]) / sds[i])); idxs.push(r); }
    const sc = isolationForest(X), thr = Math.max(0.62, [...sc].sort((a, b) => a - b)[Math.floor(n * 0.985)]); const flagged = new Set(issues.filter((i) => i.type === 'outlier').map((i) => i.row));
    sc.forEach((s, r) => { if (s >= thr && !flagged.has(r)) { let bi = 0; X[r].forEach((z, i) => { if (Math.abs(z) > Math.abs(X[r][bi])) bi = i; }); add({ type: 'anomaly', subtype: 'multivariate', row: r, col: numP[bi].index, value: val(r, numP[bi].index), score: s, message: `Multivariate anomaly (Isolation Forest score ${s.toFixed(2)}); most unusual field: ${numP[bi].name}`, cause: 'Unusual combination of values across columns', detector: 'Isolation Forest', severity: 'low' }); } });
  }

  // ---- Duplicates
  if (!opts.fast || opts.dups) for (const d of findDuplicates(ds, prof)) add({ type: 'duplicate', subtype: d.kind, row: d.row, col: -1, value: `matches row ${d.of + 1}`, of: d.of, sim: d.sim, message: d.kind === 'exact' ? `Exact duplicate of row ${d.of + 1}` : `Near-duplicate of row ${d.of + 1} (match score ${d.sim.toFixed(2)})`, cause: d.kind === 'exact' ? 'Record loaded twice / repeated export' : 'Re-entry with spelling, case or formatting differences', detector: d.method, severity: d.kind === 'exact' ? 'high' : 'medium' });
  return issues;
}

// Hash-based exact dedup + sorted-neighbourhood / MinHash-LSH blocking + Fellegi–Sunter scoring.
export function findDuplicates(ds, prof) {
  const { rows } = ds, n = rows.length, P = prof.cols; const out = []; if (n < 2) return out;
  const cmpCols = P.filter((p) => p.semantic !== 'id' && p.type !== 'empty'); const norm = (v) => (isMissing(v) ? '' : typeof v === 'number' ? String(v) : (toNum(v) != null && /^[\d.,\s-]+$/.test(String(v)) ? String(toNum(v)) : normKey(v)));
  const keyOf = (r) => cmpCols.map((p) => norm(rows[r][p.index])).join('|'); const keys = Array.from({ length: n }, (_, r) => keyOf(r));
  const first = new Map(), parent = Array.from({ length: n }, (_, i) => i); const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  keys.forEach((k, r) => { if (!k.replace(/\|/g, '')) return; if (first.has(k)) { out.push({ row: r, of: first.get(k), kind: 'exact', sim: 1, method: 'Hash-Based Deduplication (normalized row hash)' }); parent[find(r)] = find(first.get(k)); } else first.set(k, r); });
  // Fellegi–Sunter weights from value frequencies
  const m = 0.92, W = cmpCols.map((p) => { const f = new Map(); let t = 0; for (let r = 0; r < n; r++) { const v = norm(rows[r][p.index]); if (v) { f.set(v, (f.get(v) || 0) + 1); t++; } } let u = 0; for (const c of f.values()) u += (c / t) ** 2; u = Math.min(0.99, Math.max(1e-4, u)); return { agree: Math.log2(m / u), dis: Math.log2((1 - m) / (1 - u)) }; });
  const text = (r) => keys[r].replace(/\|/g, ' ');
  const cand = new Set(); const addPair = (a, b) => { if (a !== b && find(a) !== find(b)) cand.add(a < b ? a * n + b : b * n + a); };
  const fp = (r) => [...new Set(text(r).split(/\s+/).filter(Boolean))].sort().join(' '); const fps = Array.from({ length: n }, (_, r) => fp(r));
  for (const order of [[...Array(n).keys()].sort((a, b) => (fps[a] < fps[b] ? -1 : 1)), [...Array(n).keys()].sort((a, b) => (keys[a] < keys[b] ? -1 : 1)), [...Array(n).keys()].sort((a, b) => ([...fps[a]].reverse().join('') < [...fps[b]].reverse().join('') ? -1 : 1))]) for (let i = 0; i < n; i++) for (let j = i + 1; j < Math.min(n, i + 7); j++) addPair(order[i], order[j]);
  if (n <= 30000) { const sigs = Array.from({ length: n }, (_, r) => minhash(shingles(text(r)), 32)); for (const b of lshBuckets(sigs, 16).values()) if (b.length > 1 && b.length < 40) for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) addPair(b[i], b[j]); }
  const near = []; for (const key of cand) { const a = Math.floor(key / n), b = key % n; let w = 0, ag = 0, cmp = 0;
    cmpCols.forEach((p, i) => { const x = rows[a][p.index], y = rows[b][p.index]; if (isMissing(x) || isMissing(y)) return; cmp++; const nx = norm(x), ny = norm(y); const ok = nx === ny || (p.type !== 'number' && nx.length > 3 && jaroWinkler(nx, ny) >= 0.9 && damerau(nx, ny) <= Math.max(2, nx.length * 0.2)); if (ok) { ag++; w += W[i].agree; } else w += W[i].dis; });
    if (cmp >= 3 && ag / cmp >= 0.7 && w >= 12) near.push({ a, b, sim: ag / cmp, w }); }
  near.sort((x, y) => y.sim - x.sim).forEach(({ a, b, sim }) => { if (find(a) === find(b)) return; parent[find(b)] = find(a); out.push({ row: Math.max(a, b), of: Math.min(a, b), kind: 'near', sim, method: 'Fellegi–Sunter + Jaro-Winkler/Damerau–Levenshtein (sorted-neighbourhood & MinHash-LSH blocking)' }); });
  return out;
}
