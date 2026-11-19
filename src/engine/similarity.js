// String-similarity & hashing primitives used by duplicate detection and canonicalization.
export function levenshtein(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
// Damerau–Levenshtein (optimal string alignment): adds adjacent transposition.
export function damerau(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
export function jaro(a, b) {
  if (a === b) return 1; const la = a.length, lb = b.length; if (!la || !lb) return 0;
  const w = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1), ma = Array(la).fill(false), mb = Array(lb).fill(false); let m = 0;
  for (let i = 0; i < la; i++) for (let j = Math.max(0, i - w); j < Math.min(lb, i + w + 1); j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
  if (!m) return 0; let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  return (m / la + m / lb + (m - t / 2) / m) / 3;
}
export function jaroWinkler(a, b, p = 0.1) { const j = jaro(a, b); let l = 0; while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++; return j + l * p * (1 - j); }
export const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function cosine(a, b) {
  const f = (s) => { const m = new Map(); tokens(s).forEach((t) => m.set(t, (m.get(t) || 0) + 1)); return m; };
  const x = f(a), y = f(b); let dot = 0, nx = 0, ny = 0; for (const [k, v] of x) { nx += v * v; if (y.has(k)) dot += v * y.get(k); } for (const v of y.values()) ny += v * v;
  return nx && ny ? dot / Math.sqrt(nx * ny) : 0;
}
export function soundex(s) {
  s = String(s).toUpperCase().replace(/[^A-Z]/g, ''); if (!s) return '';
  const c = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = s[0], prev = c[s[0]] || 0;
  for (let i = 1; i < s.length && out.length < 4; i++) { const ch = s[i], d = c[ch] || 0; if (d && d !== prev) out += d; if (ch !== 'H' && ch !== 'W') prev = d; }
  return (out + '000').slice(0, 4);
}
export function fnv(s, seed = 0x811c9dc5) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export function simhash(text) {
  const v = new Array(32).fill(0); for (const t of tokens(text)) { const h = fnv(t); for (let i = 0; i < 32; i++) v[i] += (h >>> i) & 1 ? 1 : -1; }
  let r = 0; for (let i = 0; i < 32; i++) if (v[i] > 0) r |= 1 << i; return r >>> 0;
}
export const hamming = (a, b) => { let x = (a ^ b) >>> 0, c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
export function shingles(s, k = 3) { s = ` ${String(s).toLowerCase()} `; const out = new Set(); for (let i = 0; i + k <= s.length; i++) out.add(s.slice(i, i + k)); return out; }
export function minhash(set, K = 32) { const sig = new Array(K).fill(0xffffffff); for (const sh of set) { const h = fnv(sh); for (let i = 0; i < K; i++) { const v = (Math.imul(h ^ (i * 0x9e3779b1), 0x85ebca6b) + i * 0xc2b2ae35) >>> 0; if (v < sig[i]) sig[i] = v; } } return sig; }
export function lshBuckets(sigs, bands = 16) { const rows = sigs[0].length / bands, buckets = new Map(); sigs.forEach((sig, idx) => { for (let b = 0; b < bands; b++) { const key = b + ':' + sig.slice(b * rows, (b + 1) * rows).join(','); (buckets.get(key) || buckets.set(key, []).get(key)).push(idx); } }); return buckets; }
export class BKTree {
  constructor() { this.root = null; }
  add(w) { if (!this.root) { this.root = { w, ch: new Map() }; return; } let n = this.root; for (;;) { const d = damerau(w, n.w); if (d === 0) return; const c = n.ch.get(d); if (!c) { n.ch.set(d, { w, ch: new Map() }); return; } n = c; } }
  search(w, max) { const out = []; if (!this.root) return out; const st = [this.root]; while (st.length) { const n = st.pop(); const d = damerau(w, n.w); if (d <= max) out.push([n.w, d]); for (const [k, c] of n.ch) if (k >= d - max && k <= d + max) st.push(c); } return out; }
}
