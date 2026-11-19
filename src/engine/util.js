// Shared helpers: missing tokens, numeric/date parsing, statistics, seeded RNG.
export const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '-', '--', '?', 'undefined', 'missing', '#n/a', 'n.a.', 'not available', 'unknown']);
export const isMissing = (v) => v == null || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && MISSING.has(v.trim().toLowerCase()));
export const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const cellRef = (r, c) => colLetter(c) + (r + 2); // r = 0-based data row; header is sheet row 1

export function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim(); if (!s) return null;
  let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^[₹$€£¥]\s*/, '').replace(/^(rs\.?|inr|usd|eur)\s*/i, '').replace(/(%|\s*(kg|cm|km|usd|inr|rs\.?))$/i, '').replace(/,(?=\d{3}(\D|$))/g, '').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = parseFloat(s); return neg ? -n : n;
}
export const isPlainNumber = (v) => typeof v === 'number' || (typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v.trim()));

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const mk = (y, m, d, fmt) => { const dt = new Date(Date.UTC(y, m - 1, d)); const valid = m >= 1 && m <= 12 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; return { y, m, d, fmt, valid, ts: valid ? dt.getTime() : NaN }; };
export function parseDate(v, order = 'DMY') {
  if (typeof v !== 'string') return null; const s = v.trim(); let m;
  if ((m = s.match(/^(\d{4})([-\/.])(\d{1,2})\2(\d{1,2})(?:[T\s].*)?$/))) return mk(+m[1], +m[3], +m[4], m[2] === '-' ? 'ISO' : 'Y/M/D');
  if ((m = s.match(/^(\d{1,2})([-\/.])(\d{1,2})\2(\d{2,4})$/))) {
    let a = +m[1], b = +m[3], y = +m[4]; if (y < 100) y += y > 30 ? 1900 : 2000;
    let d, mo; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (order === 'MDY') { mo = a; d = b; } else { d = a; mo = b; }
    return mk(y, mo, d, m[2] === '/' ? 'D/M/Y' : m[2] === '-' ? 'D-M-Y' : 'D.M.Y');
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/)) && MON[m[2].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1], 'D Mon Y');
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && MON[m[1].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2], 'Mon D, Y');
  return null;
}
export const toISO = (p) => `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
export function detectDateOrder(vals) {
  let dmy = 0, mdy = 0;
  for (const v of vals) { const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}$/); if (!m) continue; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; }
  return mdy > dmy ? 'MDY' : 'DMY';
}

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
export const quantile = (sorted, q) => { if (!sorted.length) return NaN; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); };
export const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);
export const mad = (a, med = median(a)) => median(a.map((x) => Math.abs(x - med)));
export function pearson(x, y) { const n = x.length; if (n < 3) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; }
export function rng(seed = 42) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const sample = (arr, k, rand) => { if (arr.length <= k) return arr.slice(); const a = arr.slice(); for (let i = 0; i < k; i++) { const j = i + Math.floor(rand() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
export const same = (a, b) => a === b || (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12);
export const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
