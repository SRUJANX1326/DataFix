const j = async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
export const health = () => fetch('/api/health').then(j);
export const insights = (summary) => fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary }) }).then(j);
export const saveRun = (body) => fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);
export const listRuns = () => fetch('/api/save').then(j);
// Save/download that also works inside the Android WebView (blob downloads are not supported there).
export function download(name, text, mime = 'text/plain') {
  if (window.Android?.saveFile) { window.Android.saveFile(name, mime, btoa(unescape(encodeURIComponent(text)))); return true; }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = String(name || 'download').replace(/[\\/:*?\"<>|]/g, '_'); a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000); return true;
}

export const knowledge = () => fetch('/api/knowledge').then(j);
export const agentChat = (messages, datasetSummary = null) => fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, datasetSummary }) }).then(j);
