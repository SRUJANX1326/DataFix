// Orchestration: analyze (Report 1) -> repair -> validate (Report 2), plus diagnosis, insights, confusion matrix.
import { parseDataset } from './parse.js';
import { profileDataset } from './profile.js';
import { detect } from './detect.js';
import { repair } from './repair.js';
import { computeMetrics, DIMENSIONS } from './metrics.js';
import { isMissing, toNum, pearson, mean, std, median, round } from './util.js';
export { parseDataset, DIMENSIONS };

export const TYPE_INFO = {
  missing: { label: 'Missing values', impact: 'Biases means/totals, shrinks usable sample size, breaks joins and ML pipelines.' },
  duplicate: { label: 'Duplicate records', impact: 'Inflates counts and revenue, double-weights entities, skews distributions.' },
  invalid: { label: 'Invalid formats', impact: 'Rejected by downstream validators; email/phone/date fields become unusable.' },
  type: { label: 'Type / schema errors', impact: 'Numeric columns degrade to text, aggregations fail or silently drop rows.' },
  inconsistent: { label: 'Inconsistent entries', impact: 'Same entity appears as many categories; group-bys and filters under-count.' },
  noise: { label: 'Noise', impact: 'Hidden whitespace / markup / encoding junk breaks matching and deduplication.' },
  outlier: { label: 'Outliers', impact: 'Distorts averages, variance and model fitting.' },
  anomaly: { label: 'Multivariate anomalies', impact: 'Unusual combinations may signal fraud or entry errors.' },
  integrity: { label: 'Integrity violations', impact: 'Impossible values or broken relationships (keys, dates, dependencies) erode trust in analytics.' },
};

export function diagnose(ds, prof, issues) {
  const n = ds.rows.length, C = ds.columns.length, out = []; const P = prof.cols;
  const mc = P.filter((p) => p.missing / n > 0.01).sort((a, b) => b.missing - a.missing);
  mc.slice(0, 6).forEach((p) => {
    const c = p.index; const miss = ds.rows.map((r) => isMissing(r[c])); let cause = 'Missingness looks random (MCAR) – likely optional field or sporadic entry omission.', conf = 0.55, ev = `${(p.missing / n * 100).toFixed(1)}% missing`;
    for (const q of P.filter((q) => q.isCategorical && q.index !== c)) { const g = new Map(); ds.rows.forEach((r, i) => { const k = String(r[q.index]); const e = g.get(k) || [0, 0]; e[0]++; if (miss[i]) e[1]++; g.set(k, e); }); const best = [...g.entries()].filter(([, e]) => e[0] >= 10).map(([k, e]) => [k, e[1] / e[0]]).sort((a, b) => b[1] - a[1])[0]; if (best && best[1] > Math.max(0.3, 2.5 * p.missing / n)) { cause = `Missingness depends on “${q.name}” (MAR): ${(best[1] * 100).toFixed(0)}% empty when ${q.name}=“${best[0]}” – a source system/segment does not capture this field.`; conf = 0.75; ev += `; ${q.name}=${best[0]} → ${(best[1] * 100).toFixed(0)}%`; break; } }
    const co = mc.filter((q) => q !== p && pearson(miss.map(Number), ds.rows.map((r) => +isMissing(r[q.index]))) > 0.5); if (co.length) { cause += ` Co-missing with ${co.map((q) => q.name).join(', ')} – probably the same ETL step or form section failed.`; conf = Math.max(conf, 0.7); }
    out.push({ area: 'Missing', column: p.name, finding: `${p.missing} empty/placeholder cells`, cause, evidence: ev, confidence: conf });
  });
  const by = (t) => issues.filter((i) => i.type === t);
  const d = by('duplicate'); if (d.length) { const ex = d.filter((i) => i.subtype === 'exact').length; out.push({ area: 'Duplicates', column: '—', finding: `${ex} exact + ${d.length - ex} near duplicate rows`, cause: ex >= d.length - ex ? 'Mostly exact copies → repeated file load or export/merge without a key.' : 'Mostly near-copies → manual re-entry with spelling/case/format differences, or merging two sources.', evidence: `${((d.length / n) * 100).toFixed(1)}% of rows`, confidence: 0.8 }); }
  const cols = (t) => { const m = new Map(); by(t).forEach((i) => m.set(i.colName, (m.get(i.colName) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  cols('inconsistent').slice(0, 5).forEach(([c, k]) => out.push({ area: 'Inconsistency', column: c, finding: `${k} inconsistent cells`, cause: 'Multiple entry conventions / source systems writing different formats or spellings into one field.', evidence: [...new Set(by('inconsistent').filter((i) => i.colName === c).map((i) => i.subtype))].join(', '), confidence: 0.8 }));
  cols('type').concat(cols('invalid')).slice(0, 5).forEach(([c, k]) => out.push({ area: 'Validity / Schema', column: c, finding: `${k} invalid or wrong-type cells`, cause: 'Free-text typed into structured fields, import column shift, or missing input validation at the source.', evidence: `${c}`, confidence: 0.75 }));
  cols('outlier').slice(0, 4).forEach(([c, k]) => out.push({ area: 'Outliers', column: c, finding: `${k} outlier cells`, cause: 'Likely unit/decimal slips or typing errors; genuine extremes are retained for review unless 4+ detectors agree.', evidence: 'Z-score, Modified Z, IQR, MAD, Grubbs', confidence: 0.65 }));
  const ik = by('integrity'); if (ik.length) out.push({ area: 'Integrity', column: '—', finding: `${ik.length} integrity violations`, cause: [...new Set(ik.map((i) => i.subtype))].join(', ').replace(/_/g, ' ') + ' – rule or relationship breaks, usually from manual edits or merged sources.', evidence: 'Domain, key, temporal and functional-dependency rules', confidence: 0.8 });
  return out;
}

export function correlations(ds, prof, max = 10) {
  const cs = prof.cols.filter((p) => p.type === 'number' && p.semantic !== 'id').slice(0, max); const vec = cs.map((p) => ds.rows.map((r) => toNum(r[p.index])));
  const m = cs.map((_, i) => cs.map((_, j) => { const x = [], y = []; for (let r = 0; r < ds.rows.length; r++) if (vec[i][r] != null && vec[j][r] != null) { x.push(vec[i][r]); y.push(vec[j][r]); } return i === j ? 1 : round(pearson(x, y), 2); }));
  const top = []; cs.forEach((a, i) => cs.forEach((b, j) => { if (j > i && Math.abs(m[i][j]) >= 0.3) top.push({ a: a.name, b: b.name, r: m[i][j] }); }));
  return { cols: cs.map((p) => p.name), matrix: m, top: top.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 6) };
}
export function histogram(ds, c, bins = 14) { const v = ds.rows.map((r) => toNum(r[c])).filter((x) => x != null); if (v.length < 2) return null; const lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / bins || 1; const h = Array(bins).fill(0); v.forEach((x) => h[Math.min(bins - 1, Math.floor((x - lo) / w))]++); return { lo, hi, w, h }; }

export function insights(ds, prof) {
  const out = [], n = ds.rows.length; const num = prof.cols.filter((p) => p.type === 'number' && p.semantic !== 'id');
  out.push(`Dataset has ${n.toLocaleString()} records × ${ds.columns.length} fields: ${num.length} numeric, ${prof.cols.filter((p) => p.type === 'date').length} date, ${prof.cols.filter((p) => p.isCategorical).length} categorical, ${prof.cols.filter((p) => p.semantic === 'id').length} identifier.`);
  const cr = correlations(ds, prof); cr.top.slice(0, 3).forEach((t) => out.push(`${t.a} and ${t.b} are ${t.r > 0 ? 'positively' : 'negatively'} correlated (r = ${t.r}).`));
  num.forEach((p) => { const v = ds.rows.map((r) => toNum(r[p.index])).filter((x) => x != null); const m = mean(v), s = std(v); if (s && v.length > 10) { const sk = v.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / v.length; if (Math.abs(sk) > 1) out.push(`${p.name} is ${sk > 0 ? 'right' : 'left'}-skewed (skewness ${sk.toFixed(1)}; mean ${round(m)} vs median ${round(median(v))}) – prefer the median for reporting.`); } });
  prof.cols.filter((p) => p.isCategorical && p.top).slice(0, 3).forEach((p) => out.push(`${p.name}: most common value is “${p.top[0][0]}” (${((p.top[0][1] / p.nonMissing) * 100).toFixed(0)}% of non-missing).`));
  return out;
}

export function analyze(ds) {
  const prof = profileDataset(ds), issues = detect(ds, prof), metrics = computeMetrics(ds, prof, issues);
  return { prof, issues, metrics, diagnosis: diagnose(ds, prof, issues), insights: insights(ds, prof), corr: correlations(ds, prof) };
}

export function runRepair(ds, a, opts = {}) {
  const rep = repair(ds, a.prof, opts), ds1 = { columns: ds.columns, rows: rep.rows, ragged: [] }, prof1 = profileDataset(ds1), issues1 = detect(ds1, prof1), metrics1 = computeMetrics(ds1, prof1, issues1);
  const C = ds.columns.length, N = ds.rows.length, total = N * C; const D = new Set(), CH = new Set(), R = new Set();
  const rowCells = (set, r) => { for (let c = 0; c < C; c++) set.add(r * C + c); };
  a.issues.forEach((i) => (i.col < 0 || i.type === 'duplicate' ? rowCells(D, i.row) : D.add(i.row * C + i.col)));
  rep.log.forEach((l) => (l.col < 0 ? rowCells(CH, l.row) : CH.add(l.row * C + l.col)));
  issues1.forEach((i) => { const r = rep.rowMap[i.row]; if (i.col < 0 || i.type === 'duplicate') rowCells(R, r); else R.add(r * C + i.col); });
  let tp = 0, fp = 0, regress = 0; for (const k of CH) { if (D.has(k)) { if (!R.has(k)) tp++; } else fp++; } for (const k of R) if (!D.has(k)) regress++;
  const fn = D.size - tp, tn = total - D.size - fp, prec = tp + fp ? tp / (tp + fp) : 1, rec = D.size ? tp / D.size : 1, f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  const cm = { tp, fp, fn, tn, precision: round(prec, 3), recall: round(rec, 3), f1: round(f1, 3), accuracy: round((tp + tn) / total, 4), newIssueCells: regress };
  const types = Object.keys(TYPE_INFO), logBy = (t) => rep.log.filter((l) => l.issueType === t), summary = types.map((t) => {
    const before = a.issues.filter((i) => i.type === t).length, after = issues1.filter((i) => i.type === t).length, L = logBy(t), algs = [...new Set(L.map((l) => l.algorithm.split(' (')[0]))];
    const status = before === 0 ? 'No issue' : after === 0 ? 'Fully fixed' : after < before ? 'Partially fixed' : 'Not fixed';
    return { type: t, label: TYPE_INFO[t].label, impact: TYPE_INFO[t].impact, before, after, changes: L.length, algorithms: algs, avgConfidence: L.length ? round(mean(L.map((l) => l.confidence)), 2) : null, status, improvement: before ? round(((before - after) / before) * 100, 1) : 0, note: after && before ? (t === 'outlier' || t === 'anomaly' ? 'Remaining items are retained for human review (may be genuine extremes).' : t === 'missing' ? 'Unresolved cells are in fields that cannot be inferred safely (IDs, names, emails…) or fall under the confidence threshold.' : 'Residual cases need source verification; DataFix refused to guess.') : '' };
  });
  const tallies = {}; rep.log.forEach((l) => { const k = l.algorithm.split(' (')[0].split(' + ')[0]; tallies[k] = (tallies[k] || 0) + 1; });
  const ds1b = { columns: ds.columns, rows: rep.rows }; const after = { prof: prof1, issues: issues1, metrics: metrics1, corr: correlations(ds1b, prof1), insights: insights(ds1b, prof1) };
  return { ds1: ds1b, rowMap: rep.rowMap, log: rep.log, skipped: rep.skipped, backtest: rep.backtest, unresolved: rep.unresolved, cm, summary, algoTally: Object.entries(tallies).sort((x, y) => y[1] - x[1]), after };
}
