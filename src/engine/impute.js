// Autonomous imputation: several candidate algorithms are back-tested on held-out known cells; best one per column is applied.
import { isMissing, toNum, mean, std, median, pearson, rng, sample, clamp } from './util.js';
const LABEL = { mean: 'Mean Imputation', median: 'Median Imputation', mode: 'Mode Imputation', knn: 'KNN Imputation (k=5, Gower distance)', hotdeck: 'Hot Deck Imputation (nearest-donor pool)', regression: 'Regression Imputation (ridge OLS)', mice: 'MICE (chained regression, 3 rounds)', interp: 'Interpolation (linear, row order)' };
function solve(A, b) { const n = b.length; for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; if (Math.abs(A[i][i]) < 1e-12) return null; for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } } const x = Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; } return x; }
function fitRidge(X, y) { const d = X[0].length + 1, A = Array.from({ length: d }, () => Array(d).fill(0)), b = Array(d).fill(0); X.forEach((x, i) => { const v = [1, ...x]; for (let p = 0; p < d; p++) { b[p] += v[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += v[p] * v[q]; } }); for (let p = 1; p < d; p++) A[p][p] += 1e-3 * X.length; const w = solve(A, b); return w && ((x) => w[0] + x.reduce((s, v, i) => s + v * w[i + 1], 0)); }

export function planImputation(rows, P, seed = 42) {
  const n = rows.length, rand = rng(seed), isNum = (p) => p.type === 'number' && p.semantic !== 'id', isCat = (p) => p.isCategorical || p.type === 'boolean';
  const usable = P.filter((p) => (isNum(p) || isCat(p)) && p.nonMissing / n >= 0.4);
  const W = rows.map((r) => P.map((p) => (isMissing(r[p.index]) ? null : isNum(p) ? toNum(r[p.index]) : isCat(p) ? String(r[p.index]).trim() : null)));
  const fills = [], backtest = [], unresolved = [];
  const Wm = W.map((r) => r.slice()), tg = [];
  for (const p of P) {
    const c = p.index, miss = []; for (let r = 0; r < n; r++) if (isMissing(rows[r][c])) miss.push(r);
    if (!miss.length) continue;
    if (!usable.includes(p)) { unresolved.push({ c, name: p.name, count: miss.length, reason: p.nonMissing / n < 0.4 ? 'Column is >60% empty – imputation would fabricate data; recommend re-collection or dropping the column' : `${p.type === 'string' ? 'Free-text/identifier' : p.type} column cannot be inferred safely from other fields – left for source verification` }); continue; }
    const known = []; for (let r = 0; r < n; r++) if (W[r][c] != null) known.push(r);
    if (known.length < 10) { unresolved.push({ c, name: p.name, count: miss.length, reason: 'Fewer than 10 known values – not enough evidence to impute' }); continue; }
    const hold = sample(known, Math.min(150, Math.max(8, Math.floor(known.length * 0.1))), rand); hold.forEach((r) => (Wm[r][c] = null)); tg.push({ p, c, miss, hold, num: isNum(p) });
  }
  const sd = P.map((p, c) => { if (!isNum(p)) return 1; const v = Wm.map((r) => r[c]).filter((x) => x != null); return std(v) || 1; });
  let miceF = null;
  const mice = () => { if (miceF) return miceF; const nums = tg.filter((t) => t.num).map((t) => t.c), allNum = usable.filter(isNum).map((p) => p.index); const F = Wm.map((r) => r.slice()); const med = {}; allNum.forEach((c) => (med[c] = median(Wm.map((r) => r[c]).filter((x) => x != null)))); F.forEach((r) => allNum.forEach((c) => { if (r[c] == null) r[c] = med[c]; })); const orderedKnown = {};
    for (let it = 0; it < 3; it++) for (const c of nums) { const preds = allNum.filter((x) => x !== c).sort((a, b) => Math.abs(pearson(F.map((r) => r[b]), F.map((r) => r[c]))) - Math.abs(pearson(F.map((r) => r[a]), F.map((r) => r[c])))).slice(0, 5); if (!preds.length) continue; const tr = []; for (let r = 0; r < n; r++) if (Wm[r][c] != null) tr.push(r); const f = fitRidge(tr.map((r) => preds.map((x) => (F[r][x] - med[x]) / sd[x])), tr.map((r) => Wm[r][c])); if (!f) continue; for (let r = 0; r < n; r++) if (Wm[r][c] == null) F[r][c] = f(preds.map((x) => (F[r][x] - med[x]) / sd[x])); }
    return (miceF = F); };
  for (const t of tg) {
    const { p, c, miss, hold, num } = t, Q = [...miss, ...hold], kn = []; for (let r = 0; r < n; r++) if (Wm[r][c] != null) kn.push(r); const kv = kn.map((r) => Wm[r][c]);
    const preds = {}; const cands = {};
    if (num) { const m = mean(kv), md = median(kv); preds.mean = () => m; preds.median = () => md; } else { const f = new Map(); kv.forEach((v) => f.set(v, (f.get(v) || 0) + 1)); const mo = [...f.entries()].sort((a, b) => b[1] - a[1])[0][0]; preds.mode = () => mo; }
    const pc = usable.filter((q) => q.index !== c).map((q) => q.index);
    if (pc.length) {
      const donors = sample(kn, 1200, rand); const dist = (a, b) => { let s = 0, k = 0; for (const x of pc) { const u = Wm[a][x], v = Wm[b][x]; if (u == null || v == null) continue; k++; s += typeof u === 'number' ? Math.min(1, Math.abs(u - v) / (3 * sd[x])) : u === v ? 0 : 1; } return k ? s / k + (k < pc.length / 2 ? 0.3 : 0) : 1; };
      const nb = new Map(); const neigh = (r) => { if (!nb.has(r)) nb.set(r, donors.filter((d) => d !== r).map((d) => [dist(r, d), d]).sort((a, b) => a[0] - b[0]).slice(0, 5).map((x) => Wm[x[1]][c])); return nb.get(r); };
      preds.knn = (r) => { const v = neigh(r); if (!v.length) return null; if (num) return mean(v); const f = new Map(); v.forEach((x) => f.set(x, (f.get(x) || 0) + 1)); return [...f.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
      preds.hotdeck = (r) => { const v = neigh(r); return v.length ? v[Math.floor(rand() * v.length)] : null; };
    }
    if (num) {
      const nc = usable.filter((q) => isNum(q) && q.index !== c).map((q) => q.index).map((x) => { const pair = kn.filter((r) => Wm[r][x] != null); return [x, Math.abs(pearson(pair.map((r) => Wm[r][x]), pair.map((r) => Wm[r][c])))]; }).filter((z) => z[1] > 0.1).sort((a, b) => b[1] - a[1]).slice(0, 3).map((z) => z[0]);
      if (nc.length) { const tr = kn.filter((r) => nc.every((x) => Wm[r][x] != null)); const mu = nc.map((x) => mean(tr.map((r) => Wm[r][x]))), sg = nc.map((x) => std(tr.map((r) => Wm[r][x])) || 1); const f = tr.length > 15 && fitRidge(tr.map((r) => nc.map((x, i) => (Wm[r][x] - mu[i]) / sg[i])), tr.map((r) => Wm[r][c])); if (f) { const md = median(kv); preds.regression = (r) => (nc.every((x) => Wm[r][x] != null) ? f(nc.map((x, i) => (Wm[r][x] - mu[i]) / sg[i])) : md); } }
      if (usable.filter(isNum).length >= 2) preds.mice = (r) => mice()[r][c];
      if (kn.length > 20 && Math.abs(pearson(kv.slice(0, -1), kv.slice(1))) >= 0.5) preds.interp = (r) => { let a = r - 1, b = r + 1; while (a >= 0 && Wm[a][c] == null) a--; while (b < n && Wm[b][c] == null) b++; if (a < 0 && b >= n) return null; if (a < 0) return Wm[b][c]; if (b >= n) return Wm[a][c]; return Wm[a][c] + ((Wm[b][c] - Wm[a][c]) * (r - a)) / (b - a); };
    }
    const scores = {}, out = {};
    for (const [m, f] of Object.entries(preds)) { const vals = new Map(Q.map((r) => [r, f(r)])); out[m] = vals; let err = 0, k = 0; for (const r of hold) { const v = vals.get(r), tv = W[r][c]; if (v == null) continue; k++; err += num ? (v - tv) ** 2 : v === tv ? 0 : 1; } scores[m] = k ? (num ? Math.sqrt(err / k) / (std(W.map((x) => x[c]).filter((x) => x != null)) || 1) : err / k) : 9; }
    const best = Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0], e = scores[best], conf = num ? clamp(1 - e / 2, 0.3, 0.99) : clamp(0.35 + 0.6 * (1 - e), 0.3, 0.99);
    backtest.push({ col: c, name: p.name, kind: num ? 'numeric' : 'categorical', metric: num ? 'NRMSE' : 'error rate', nHold: hold.length, nMissing: miss.length, best, bestLabel: LABEL[best], scores, confidence: Math.round(conf * 100) / 100 });
    for (const r of miss) { let v = out[best].get(r); if (v == null) continue; if (num) v = p.allInt ? Math.round(v) : Math.round(v * 1e4) / 1e4; fills.push({ r, c, value: v, method: LABEL[best], confidence: Math.round(conf * 100) / 100, reason: `Best of ${Object.keys(preds).length} candidates on ${hold.length} held-out cells (${num ? 'NRMSE' : 'error'} ${e.toFixed(2)})` }); }
  }
  return { fills, backtest, unresolved };
}
