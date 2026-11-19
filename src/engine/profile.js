// Column profiling: type inference, semantic hints, stats.
import { isMissing, toNum, parseDate, detectDateOrder, mean, std, quantile } from './util.js';
export const RX = { email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, url: /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i, phone: /^\+?[\d\s().-]{7,20}$/, bool: /^(true|false|yes|no|y|n|t|f)$/i };
export function semanticOf(name) {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), c = n.replace(/ /g, '');
  if (/e ?mail/.test(n)) return 'email';
  if (/phone|mobile|\btel\b|\bcell\b|contact no/.test(n)) return 'phone';
  if (/\burl\b|website|\blink\b/.test(n)) return 'url';
  if (/date|time|\bdob\b|birth|\bat$|created|updated|joined|signup|expiry|purchase/.test(n)) return 'date';
  if (/\bage\b/.test(n)) return 'age';
  if (/price|amount|salary|cost|revenue|income|\bfee\b|total|weight|height/.test(n)) return 'money';
  if (/\bqty\b|quantity|count|stock|units|orders/.test(n)) return 'count';
  if (/\bid\b|uuid|\bsku\b|[a-z]id$/.test(n) || /[a-z]id$/.test(c)) return 'id';
  if (/\bzip\b|postal|\bpin\b/.test(n)) return 'zip';
  if (/name/.test(n)) return 'name';
  if (/country|city|state|gender|\bsex\b|status|category|dept|department|segment/.test(n)) return 'category';
  return null;
}
export function profileDataset(ds) {
  const n = ds.rows.length;
  const cols = ds.columns.map((name, c) => {
    const vals = []; let missing = 0; for (let r = 0; r < n; r++) { const v = ds.rows[r][c]; if (isMissing(v)) missing++; else vals.push(typeof v === 'string' ? v.trim() : v); }
    const k = vals.length, semantic = semanticOf(name); const cnt = { num: 0, int: 0, bool: 0, date: 0, email: 0, phone: 0, url: 0 };
    const order = detectDateOrder(vals);
    for (const v of vals) { const x = toNum(v); if (x != null) { cnt.num++; if (Number.isInteger(x)) cnt.int++; } const s = String(v); if (RX.bool.test(s)) cnt.bool++; if (parseDate(s, order)) cnt.date++; if (RX.email.test(s)) cnt.email++; if (RX.phone.test(s)) cnt.phone++; if (RX.url.test(s)) cnt.url++; }
    const q = (x) => (k ? cnt[x] / k : 0); let type = 'string';
    if (!k) type = 'empty';
    else if (semantic === 'email' && q('email') >= 0.4) type = 'email';
    else if (semantic === 'phone' && q('phone') >= 0.4) type = 'phone';
    else if (semantic === 'url' && q('url') >= 0.4) type = 'url';
    else if (semantic === 'id') type = q('num') >= 0.9 ? 'id' : 'id';
    else if (semantic === 'zip') type = 'string';
    else if ((semantic === 'date' && q('date') >= 0.4) || (q('date') >= 0.8 && q('num') < 0.5)) type = 'date';
    else if (q('num') >= 0.8 || (['age', 'money', 'count'].includes(semantic) && q('num') >= 0.5)) type = 'number';
    else if (q('email') >= 0.7) type = 'email';
    else if (q('bool') >= 0.9 && new Set(vals.map((v) => String(v).toLowerCase())).size <= 8) type = 'boolean';
    const uniq = new Map(); vals.forEach((v) => uniq.set(String(v), (uniq.get(String(v)) || 0) + 1));
    const p = { index: c, name, semantic, type, n, missing, nonMissing: k, unique: uniq.size, order, ratios: { numeric: q('num'), date: q('date'), email: q('email') } };
    p.isCategorical = ['string', 'boolean'].includes(type) && semantic !== 'name' && uniq.size >= 1 && uniq.size <= Math.max(15, n * 0.05) && uniq.size < n * 0.5;
    if (type === 'number') {
      const nums = vals.map(toNum).filter((x) => x != null), s = [...nums].sort((a, b) => a - b);
      Object.assign(p, { mean: mean(nums), std: std(nums), min: s[0], max: s[s.length - 1], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), allInt: nums.every(Number.isInteger) });
    }
    if (p.isCategorical || type === 'boolean') p.top = [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return p;
  });
  return { n, cols };
}
