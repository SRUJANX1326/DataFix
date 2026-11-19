import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDataset, analyze, runRepair } from '../src/engine/pipeline.js';
const text = readFileSync(new URL('../public/sample/customers_dirty.csv', import.meta.url), 'utf8');
const truth = JSON.parse(readFileSync(new URL('./truth.json', import.meta.url), 'utf8'));
const ds = parseDataset(text, 'customers_dirty.csv'); const a = analyze(ds);
test('parses formats', () => {
  assert.equal(parseDataset('a,b\n1,2\n3,4', 'x.csv').rows.length, 2);
  assert.equal(parseDataset('[{"a":1,"b":{"c":2}},{"a":3}]', 'x.json').columns.join(), 'a,b.c');
  assert.equal(parseDataset('<r><i><a>1</a></i><i><a>2</a></i></r>', 'x.xml').rows.length, 2);
});
test('detection recall vs injected ground truth', () => {
  const C = ds.columns.length; const got = new Set(a.issues.map((i) => `${i.row}:${i.col}`)); const gotRows = new Set(a.issues.filter((i) => i.type === 'duplicate').map((i) => i.row));
  let hit = 0, tot = 0; const per = {};
  for (const [t, cells] of Object.entries(truth)) { let h = 0; for (const k of cells) { const [r, c] = k.split(':').map(Number); if (c < 0 ? gotRows.has(r) : got.has(k)) h++; } per[t] = `${h}/${cells.length}`; hit += h; tot += cells.length; }
  console.log('recall per type', per, 'overall', (hit / tot).toFixed(3), 'issues', a.issues.length);
  assert.ok(hit / tot > 0.85);
  // precision: flagged cells that are NOT injected (natural data is clean, so these are false positives)
  const inj = new Set(Object.values(truth).flat()); const injRows = new Set(truth.duplicate.map((k) => +k.split(':')[0]));
  const fp = a.issues.filter((i) => !(i.type === 'duplicate' ? injRows.has(i.row) : inj.has(`${i.row}:${i.col}`)) && i.type !== 'anomaly');
  console.log('false positives', fp.length, fp.slice(0, 5).map((i) => `${i.type}/${i.subtype} ${i.ref} ${i.value}`));
});
test('repair improves quality and is auditable', () => {
  const r = runRepair(ds, a, { minConfidence: 0.5 });
  console.log('clean records', a.metrics.cleanRecords, '->', r.after.metrics.cleanRecords); console.log('before', a.metrics.scores, '\nafter', r.after.metrics.scores, '\ncm', r.cm, '\nrows', r.ds1.rows.length, 'log', r.log.length, 'skipped', r.skipped.length);
  console.log(r.summary.map((s) => `${s.type}: ${s.before}->${s.after} ${s.status}`).join('\n'));
  console.log(r.backtest.map((b) => `${b.name}: ${b.best} ${JSON.stringify(Object.fromEntries(Object.entries(b.scores).map(([k, v]) => [k, +v.toFixed(2)])))}`).join('\n'));
  assert.ok(r.after.metrics.scores.Overall > a.metrics.scores.Overall && r.after.metrics.cleanRecords > a.metrics.cleanRecords + 15);
  assert.ok(r.log.every((l) => l.algorithm && l.reason && l.confidence >= 0));
  assert.ok(r.ds1.rows.length < ds.rows.length);
});
