// Parsers for CSV/TSV/delimited text, JSON, NDJSON and simple XML -> { columns, rows }
function detectDelim(text) {
  const lines = text.split(/\r?\n/).slice(0, 8).filter(Boolean); let best = ',', bs = -1;
  for (const d of [',', '\t', ';', '|']) { const counts = lines.map((l) => l.split(d).length - 1); const min = Math.min(...counts, 99); if (min > 0 && min * 10 + counts.length > bs) { bs = min * 10 + counts.length; best = d; } }
  return best;
}
export function parseDelimited(text, delim) {
  delim = delim || detectDelim(text); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [], lines = []; let row = [], f = '', q = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (ch === '\n') line++; f += ch; } }
    else if (ch === '"' && f === '') q = true;
    else if (ch === delim) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (!(row.length === 1 && row[0] === '')) { out.push(row); lines.push(rowLine); } row = []; line++; rowLine = line; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); out.push(row); lines.push(rowLine); }
  const columns = out[0].map((c, i) => (c.trim() || `column_${i + 1}`));
  const ragged = []; const rows = out.slice(1).map((r, i) => { if (r.length !== columns.length) { ragged.push({ row: i, found: r.length }); r = r.length < columns.length ? [...r, ...Array(columns.length - r.length).fill(null)] : r.slice(0, columns.length); } return r; });
  return { columns, rows, ragged, lines: lines.slice(1), delimiter: delim };
}
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = Array.isArray(v) ? JSON.stringify(v) : v; } return out; };
export function fromObjects(objs) {
  const columns = [], seen = new Set(); const fl = objs.map((o) => (o && typeof o === 'object' ? flat(o) : { value: o }));
  fl.forEach((o) => Object.keys(o).forEach((k) => { if (!seen.has(k)) { seen.add(k); columns.push(k); } }));
  return { columns, rows: fl.map((o) => columns.map((c) => (c in o ? o[c] : null))), ragged: [], lines: null };
}
export function parseJSON(text) {
  let data; try { data = JSON.parse(text); } catch { data = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)); }
  if (!Array.isArray(data)) { const arr = Object.values(data).find((v) => Array.isArray(v)); if (arr) data = arr; else { const ks = Object.keys(data); data = Object.values(data).every((v) => v && typeof v === 'object') ? ks.map((k) => ({ _key: k, ...data[k] })) : [data]; } }
  if (data.length && Array.isArray(data[0])) { const [h, ...b] = data; return { columns: h.map(String), rows: b, ragged: [], lines: null }; }
  return fromObjects(data);
}
export function parseXML(text) {
  const body = text.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const cnt = {}; [...body.matchAll(/<([A-Za-z_][\w.-]*)[^>]*>/g)].forEach((m) => (cnt[m[1]] = (cnt[m[1]] || 0) + 1));
  const rec = Object.entries(cnt).filter(([, n]) => n > 1).sort((a, b) => a[1] - b[1]).find(([t]) => new RegExp(`<${t}[\\s>][\\s\\S]*?<[A-Za-z]`).test(body))?.[0];
  if (!rec) throw new Error('XML: could not find repeating record elements');
  const objs = [...body.matchAll(new RegExp(`<${rec}(?:\\s[^>]*)?>([\\s\\S]*?)</${rec}>`, 'g'))].map((m) => { const o = {}; for (const f of m[1].matchAll(/<([A-Za-z_][\w.-]*)[^>]*>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim(); return o; });
  return fromObjects(objs);
}
export function parseDataset(text, filename = '') {
  const t = text.replace(/^\uFEFF/, '').trim(); const ext = filename.split('.').pop().toLowerCase(); let ds, format;
  if (ext === 'xml' || t.startsWith('<')) { ds = parseXML(t); format = 'XML'; }
  else if (['json', 'jsonl', 'ndjson'].includes(ext) || t.startsWith('[') || t.startsWith('{')) { ds = parseJSON(t); format = ext === 'jsonl' || ext === 'ndjson' ? 'NDJSON' : 'JSON'; }
  else { ds = parseDelimited(t, ext === 'tsv' ? '\t' : undefined); format = ({ '\t': 'TSV', ';': 'CSV (;)', '|': 'PSV' })[ds.delimiter] || 'CSV'; }
  if (!ds.columns.length || !ds.rows.length) throw new Error('No tabular records found in file');
  const dup = {}; ds.columns = ds.columns.map((c) => { dup[c] = (dup[c] || 0) + 1; return dup[c] > 1 ? `${c}_${dup[c]}` : c; });
  return { ...ds, format, filename };
}
const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (columns, rows) => [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
export const toJSONText = (columns, rows) => JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), null, 2);
