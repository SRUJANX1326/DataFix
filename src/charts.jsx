// Dependency-free SVG charts styled for the dark Voice-Mail theme.
export const COL = { o: '#ff4b35', g: '#65d6a1', b: '#6ea8ff', y: '#f5c451', p: '#b58cff', m: '#5b6068' };
export const scoreColor = (v) => (v >= 95 ? COL.g : v >= 80 ? COL.y : COL.o);
const T = { fill: '#9ca2aa', fontSize: 10, fontFamily: 'DM Sans, sans-serif' };

export function Gauge({ value, label, delta, color }) {
  const r = 34, c = 2 * Math.PI * r;
  return (<div className="gauge"><svg viewBox="0 0 90 90" role="img" aria-label={`${label} ${value}`}><circle cx="45" cy="45" r={r} stroke="#242526" strokeWidth="8" fill="none" /><circle cx="45" cy="45" r={r} stroke={color || scoreColor(value)} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 45 45)" /><text x="45" y="50" textAnchor="middle" fill="#f5f5f5" fontSize="15" fontFamily="Space Grotesk" fontWeight="600">{Number(value).toFixed(1)}</text></svg><small>{label}</small>{delta != null && <em className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}</em>}</div>);
}

export function Radar({ axes, series }) {
  const cx = 150, cy = 140, R = 100, n = axes.length, pt = (i, v) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)]; };
  return (<svg viewBox="0 0 300 290" className="chart">{[25, 50, 75, 100].map((g) => <polygon key={g} points={axes.map((_, i) => pt(i, g).join(',')).join(' ')} fill="none" stroke="#2a2b2c" />)}{axes.map((a, i) => { const [x, y] = pt(i, 112); return <g key={a}><line x1={cx} y1={cy} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke="#2a2b2c" /><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" {...T}>{a}</text></g>; })}{series.map((s) => <g key={s.name}><polygon points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} fill={s.color + '33'} stroke={s.color} strokeWidth="2" />{s.values.map((v, i) => <circle key={i} cx={pt(i, v)[0]} cy={pt(i, v)[1]} r="2.5" fill={s.color} />)}</g>)}</svg>);
}

export function Legend({ items }) { return <div className="legend">{items.map(([n, c]) => <span key={n}><i style={{ background: c }} />{n}</span>)}</div>; }

export function HBars({ rows, series, max }) { // rows: [{label, values:[..]}], series: [[name,color]]
  const M = max || Math.max(1, ...rows.flatMap((r) => r.values)), h = 12 * series.length + 14;
  return (<svg viewBox={`0 0 600 ${rows.length * h + 6}`} className="chart">{rows.map((r, i) => <g key={r.label} transform={`translate(0 ${i * h + 4})`}><text x="0" y={h / 2} dominantBaseline="middle" {...T}>{r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label}</text>{r.values.map((v, k) => <g key={k}><rect x="150" y={k * 12} width={Math.max(1, (v / M) * 380)} height="9" rx="3" fill={series[k][1]} /><text x={156 + (v / M) * 380} y={k * 12 + 5} dominantBaseline="middle" {...T}>{Number.isInteger(v) ? v : v.toFixed(1)}</text></g>)}</g>)}</svg>);
}

export function Donut({ data }) {
  const tot = data.reduce((s, d) => s + d.value, 0) || 1; let a0 = -Math.PI / 2; const R = 60, r = 38;
  return (<div className="donut"><svg viewBox="0 0 150 150">{data.filter((d) => d.value > 0).map((d) => { const a1 = a0 + (d.value / tot) * Math.PI * 2 - 0.0001, big = a1 - a0 > Math.PI ? 1 : 0, p = (a, rr) => [75 + Math.cos(a) * rr, 75 + Math.sin(a) * rr]; const path = `M${p(a0, R)} A${R} ${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r} ${r} 0 ${big} 0 ${p(a0, r)}Z`; a0 = a1; return <path key={d.label} d={path} fill={d.color}><title>{d.label}: {d.value}</title></path>; })}<text x="75" y="73" textAnchor="middle" fill="#f5f5f5" fontSize="18" fontFamily="Space Grotesk" fontWeight="600">{tot}</text><text x="75" y="88" textAnchor="middle" {...T}>total</text></svg><Legend items={data.map((d) => [`${d.label} (${d.value})`, d.color])} /></div>);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
export const qualityColor = (v) => (v == null ? '#1a1b1c' : v >= 95 ? '#1f7a55' : v >= 85 ? '#6b8f3a' : v >= 70 ? '#b58a1f' : '#c8412c');
export const corrColor = (v) => (v >= 0 ? `rgb(${lerp(26, 255, v)},${lerp(27, 75, v)},${lerp(28, 53, v)})` : `rgb(${lerp(26, 110, -v)},${lerp(27, 168, -v)},${lerp(28, 255, -v)})`);
export const missColor = (v) => `rgb(${lerp(20, 255, Math.min(1, v * 2))},${lerp(21, 75, Math.min(1, v * 2))},${lerp(22, 53, Math.min(1, v * 2))})`;
export function Heatmap({ rows, cols, m, color, fmt = (v) => (v == null ? '' : Math.round(v)), cell = 44, left = 110 }) {
  const w = left + cols.length * cell, h = 44 + rows.length * 26;
  return (<div className="scroll-x"><svg viewBox={`0 0 ${w} ${h}`} style={{ minWidth: Math.min(w, 520), width: '100%' }} className="chart">{cols.map((c, j) => <text key={j} x={left + j * cell + cell / 2} y="30" textAnchor="start" transform={`rotate(-30 ${left + j * cell + cell / 2} 30)`} {...T}>{c.length > 11 ? c.slice(0, 10) + '…' : c}</text>)}{rows.map((r, i) => <g key={i}><text x="0" y={44 + i * 26 + 14} {...T}>{String(r).length > 16 ? String(r).slice(0, 15) + '…' : r}</text>{cols.map((_, j) => <g key={j}><rect x={left + j * cell + 1} y={44 + i * 26 + 1} width={cell - 2} height="24" rx="4" fill={color(m[i][j])}><title>{`${r} × ${cols[j]}: ${m[i][j] == null ? '–' : m[i][j]}`}</title></rect><text x={left + j * cell + cell / 2} y={44 + i * 26 + 13} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="9">{fmt(m[i][j])}</text></g>)}</g>)}</svg></div>);
}

export function Confusion({ cm }) {
  const cells = [['TP', cm.tp, 'Dirty cells fixed', COL.g], ['FN', cm.fn, 'Dirty cells unresolved', COL.o], ['FP', cm.fp, 'Clean cells changed', COL.y], ['TN', cm.tn, 'Clean cells untouched', COL.b]];
  return (<div><div className="cm"><span /><b>Repaired</b><b>Not repaired</b><b className="rl">Was dirty</b>{[0, 1].map((i) => <div key={i} className="cmcell" style={{ borderColor: cells[i][3] }}><strong>{cells[i][1].toLocaleString()}</strong><small>{cells[i][0]} · {cells[i][2]}</small></div>)}<b className="rl">Was clean</b>{[2, 3].map((i) => <div key={i} className="cmcell" style={{ borderColor: cells[i][3] }}><strong>{cells[i][1].toLocaleString()}</strong><small>{cells[i][0]} · {cells[i][2]}</small></div>)}</div>
    <div className="kpis"><span>Precision <b>{(cm.precision * 100).toFixed(1)}%</b></span><span>Recall <b>{(cm.recall * 100).toFixed(1)}%</b></span><span>F1 <b>{cm.f1.toFixed(3)}</b></span><span>New issues <b>{cm.newIssueCells}</b></span></div></div>);
}

export function HistOverlay({ before, after, bins = 16, title }) {
  const all = [...before, ...after]; if (all.length < 3) return null; const lo = Math.min(...all), hi = Math.max(...all), w = (hi - lo) / bins || 1;
  const h = (a) => { const o = Array(bins).fill(0); a.forEach((x) => o[Math.min(bins - 1, Math.floor((x - lo) / w))]++); return o; }, hb = h(before), ha = h(after), M = Math.max(...hb, ...ha, 1), bw = 520 / bins;
  return (<div><div className="mini-title">{title}</div><svg viewBox="0 0 560 150" className="chart">{hb.map((v, i) => <rect key={'b' + i} x={20 + i * bw} y={125 - (v / M) * 105} width={bw - 2} height={(v / M) * 105} fill={COL.o} opacity=".55" />)}{ha.map((v, i) => <rect key={'a' + i} x={20 + i * bw + bw / 4} y={125 - (v / M) * 105} width={bw / 2} height={(v / M) * 105} fill={COL.g} opacity=".9" />)}<line x1="20" x2="540" y1="125" y2="125" stroke="#333" /><text x="20" y="141" {...T}>{lo.toFixed(0)}</text><text x="540" y="141" textAnchor="end" {...T}>{hi.toFixed(0)}</text></svg></div>);
}
