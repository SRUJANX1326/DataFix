// Generates a deliberately dirty CSV + ground-truth file for benchmarking detection.
import { writeFileSync } from 'node:fs';
import { rng } from '../src/engine/util.js';
const R = rng(2026), pick = (a) => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1));
const geo = { Mumbai: 'Maharashtra', Pune: 'Maharashtra', Delhi: 'Delhi', Bengaluru: 'Karnataka', Chennai: 'Tamil Nadu', Hyderabad: 'Telangana', Kolkata: 'West Bengal' };
const cities = Object.keys(geo), first = ['Aarav', 'Vivaan', 'Diya', 'Isha', 'Rohan', 'Ananya', 'Kabir', 'Meera', 'Arjun', 'Sana', 'Neha', 'Rahul', 'Priya', 'Karan', 'Tara'], last = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Khan', 'Das', 'Mehta', 'Singh'];
const rows = [], truth = { missing: [], duplicate: [], invalid: [], type: [], inconsistent: [], outlier: [], integrity: [], noise: [] };
const cols = ['customer_id', 'full_name', 'email', 'phone', 'age', 'gender', 'city', 'state', 'signup_date', 'last_purchase', 'income', 'orders', 'is_active'];
for (let i = 1; i <= 400; i++) {
  const f = first[i % first.length], l = pick(last), age = int(19, 70), city = pick(cities), sd = new Date(Date.UTC(2019, 0, 1) + R() * 5 * 365 * 864e5), lp = new Date(sd.getTime() + R() * 400 * 864e5);
  const income = Math.round(age * 1500 + R() * 20000 + int(20000, 40000)); rows.push([`C${String(i).padStart(4, '0')}`, `${f} ${l}`, `${f}.${l}${i}@${pick(['gmail.com', 'yahoo.com', 'outlook.com'])}`.toLowerCase(), `+91${int(7000000000, 9999999999)}`, age, pick(['Male', 'Female']), city, geo[city], sd.toISOString().slice(0, 10), lp.toISOString().slice(0, 10), income, Math.max(1, Math.round(income / 12000 + R() * 4)), pick(['Yes', 'No'])]);
}
const mark = (t, r, c) => truth[t].push(`${r}:${c}`); const idx = (n) => cols.indexOf(n);
const rnd = (n) => int(0, 399 - 0) && Math.floor(R() * 400); const used = new Set(); const pk = () => { let r; do r = Math.floor(R() * 400); while (used.has(r)); used.add(r); return r; };
for (let k = 0; k < 30; k++) { const r = pk(), c = pick(['age', 'income', 'gender', 'city', 'orders']); mark('missing', r, idx(c)); rows[r][idx(c)] = pick(['', 'N/A', 'null', '-']); }
for (let k = 0; k < 12; k++) { const r = pk(), c = idx('gender'); const m = rows[r][c] === 'Male' ? pick(['male', 'M', 'MALE']) : pick(['female', 'F', 'FEMALE']); mark('inconsistent', r, c); rows[r][c] = m; }
for (let k = 0; k < 10; k++) { const r = pk(), c = idx('city'), ct = rows[r][c], v = ({ Mumbai: 'Mumbay', Pune: 'Pnue', Delhi: 'delhi', Bengaluru: 'Bangalore', Chennai: 'chennai', Hyderabad: 'Hyderbad', Kolkata: 'KOLKATA' })[ct]; mark('inconsistent', r, c); rows[r][c] = v; }
for (let k = 0; k < 10; k++) { const r = pk(), c = idx('signup_date'), d = new Date(rows[r][c]); mark('inconsistent', r, c); rows[r][c] = pick([`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`, `${d.toUTCString().slice(5, 16)}`]); }
for (let k = 0; k < 8; k++) { const r = pk(), c = idx('email'); mark('invalid', r, c); rows[r][c] = pick([rows[r][c].replace('@', ''), rows[r][c].replace('.com', ''), 'not-an-email']); }
for (let k = 0; k < 6; k++) { const r = pk(), c = idx('phone'); mark('invalid', r, c); rows[r][c] = rows[r][c].slice(0, 8); }
for (let k = 0; k < 6; k++) { const r = pk(), c = idx('age'); mark(k < 3 ? 'integrity' : 'outlier', r, c); rows[r][c] = pick([250, -34, 199, 420]); }
for (let k = 0; k < 6; k++) { const r = pk(), c = idx('income'); mark('outlier', r, c); rows[r][c] = Number(rows[r][c]) * int(40, 80); }
for (let k = 0; k < 5; k++) { const r = pk(), c = idx('income'); mark('type', r, c); rows[r][c] = pick(['abc', 'twenty thousand', 'TBD']); }
for (let k = 0; k < 6; k++) { const r = pk(), c = idx('income'); mark('inconsistent', r, c); rows[r][c] = `$ ${Number(rows[r][c]).toLocaleString('en-US')}`; }
for (let k = 0; k < 8; k++) { const r = pk(), c = idx('full_name'); mark('noise', r, c); rows[r][c] = pick([`  ${rows[r][c]}  `, `${rows[r][c]}\u00a0`, `<b>${rows[r][c]}</b>`, rows[r][c].toUpperCase()]); }
for (let k = 0; k < 5; k++) { const r = pk(), c = idx('state'); mark('integrity', r, c); rows[r][c] = pick(['Gujarat', 'Kerala', 'Punjab']); }
for (let k = 0; k < 5; k++) { const r = pk(), a = idx('signup_date'), b = idx('last_purchase'); const t = rows[r][a]; if (/^\d{4}-/.test(t) && /^\d{4}-/.test(rows[r][b])) { mark('integrity', r, b); rows[r][b] = new Date(new Date(t).getTime() - 100 * 864e5).toISOString().slice(0, 10); } }
const dupStart = rows.length; for (let k = 0; k < 10; k++) { const src = rows[Math.floor(R() * 400)]; rows.push([...src]); truth.duplicate.push(`${rows.length - 1}:-1`); }
for (let k = 0; k < 8; k++) { const src = [...rows[Math.floor(R() * 400)]]; src[0] = `C9${k}${k}`; src[1] = src[1].replace(/a/, 'e'); src[2] = src[2].toUpperCase(); rows.push(src); truth.duplicate.push(`${rows.length - 1}:-1`); }
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
writeFileSync(new URL('../public/sample/customers_dirty.csv', import.meta.url), [cols.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n'));
writeFileSync(new URL('../test/truth.json', import.meta.url), JSON.stringify(truth));
console.log('rows', rows.length, Object.fromEntries(Object.entries(truth).map(([k, v]) => [k, v.length])));
