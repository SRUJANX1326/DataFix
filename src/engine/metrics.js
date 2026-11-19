// Quality dimensions (0–100). Definitions are documented in README.
export function computeMetrics(ds, prof, issues) {
  const n = ds.rows.length, C = ds.columns.length, total = n * C; const S = { miss: new Set(), inval: new Set(), cons: new Set(), acc: new Set(), time: new Set() }, dup = new Set();
  const bad = new Set(issues.map((i) => i.row)); const key = (i) => i.row * C + i.col; const byType = {}, bySev = { high: 0, medium: 0, low: 0 };
  for (const i of issues) {
    byType[i.type] = (byType[i.type] || 0) + 1; bySev[i.severity]++;
    if (i.type === 'duplicate') { dup.add(i.row); continue; } if (i.col < 0) { S.inval.add(i.row * C); continue; }
    const k = key(i);
    if (i.type === 'missing') S.miss.add(k); else if (i.type === 'type' || i.type === 'invalid') (i.subtype === 'bad_date' ? S.time : S.inval).add(k);
    else if (i.type === 'inconsistent' || i.type === 'noise') S.cons.add(k); else if (i.type === 'outlier' || i.type === 'anomaly') S.acc.add(k);
    else if (i.type === 'integrity') (/future_date|ancient_date/.test(i.subtype) ? S.time : S.acc).add(k);
  }
  const nonMissing = Math.max(1, total - S.miss.size), dateCells = prof.cols.filter((p) => p.type === 'date').reduce((s, p) => s + p.nonMissing, 0);
  const r = (x) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;
  const scores = { Completeness: r(1 - S.miss.size / Math.max(1, total)), Accuracy: r(1 - S.acc.size / nonMissing), Uniqueness: r(1 - dup.size / Math.max(1, n)), Consistency: r(1 - S.cons.size / nonMissing), Validity: r(1 - S.inval.size / nonMissing), Timeliness: r(dateCells ? 1 - S.time.size / dateCells : 1) };
  scores.Overall = Math.round((Object.values(scores).reduce((a, b) => a + b, 0) / 6) * 10) / 10;
  const perColumn = ds.columns.map((name, c) => { const cnt = (set) => { let k = 0; for (const x of set) if (x % C === c) k++; return k; }; const nm = Math.max(1, n - cnt(S.miss)); return { name, completeness: r(1 - cnt(S.miss) / Math.max(1, n)), validity: r(1 - (cnt(S.inval) + cnt(S.time)) / nm), consistency: r(1 - cnt(S.cons) / nm), accuracy: r(1 - cnt(S.acc) / nm) }; });
  return { scores, cleanRecords: Math.round(((n - bad.size) / Math.max(1, n)) * 1000) / 10, counts: { rows: n, cols: C, cells: total, missingCells: S.miss.size, duplicateRows: dup.size, invalidCells: S.inval.size, inconsistentCells: S.cons.size, accuracyCells: S.acc.size, timelinessCells: S.time.size, issues: issues.length }, byType, bySev, perColumn };
}
export const DIMENSIONS = ['Completeness', 'Accuracy', 'Uniqueness', 'Consistency', 'Validity', 'Timeliness'];
