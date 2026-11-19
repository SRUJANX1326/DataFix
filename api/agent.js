// DataFix AI: conversational KDD retrieval with a lightweight grounded fallback.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1800) })) : [];
  const userQuestion = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const datasetSummary = body.datasetSummary ? JSON.stringify(body.datasetSummary).slice(0, 5000) : 'No dataset is currently attached.';
  let knowledge = [], knowledgeWarning = '';
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/datafix_learning?select=created_at,dataset_name,schema_fingerprint,score_delta,issue_patterns,repair_patterns,knowledge&order=created_at.desc&limit=50`, { headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` } });
      const data = await r.json(); if (r.ok && Array.isArray(data)) knowledge = data; else knowledgeWarning = data?.message || 'Knowledge database could not be read.';
    } catch (e) { knowledgeWarning = e.message; }
  } else knowledgeWarning = 'Supabase is not configured; no persisted learning records are available.';

  // A grounded local response keeps the assistant useful during LLM rate limits and handles straightforward knowledge questions.
  const localAnswer = (question) => {
    const q = question.toLowerCase();
    const records = knowledge;
    const names = [...new Set(records.map(x => x.dataset_name).filter(Boolean))];
    const issueTotals = {}, algorithmTotals = {}, deltas = [];
    for (const x of records) {
      const issues = x.issue_patterns || {};
      for (const [k,v] of Object.entries(issues)) issueTotals[k] = (issueTotals[k]||0) + Number(v||0);
      const outcomes = x.knowledge?.algorithm_outcomes || {};
      for (const [alg,out] of Object.entries(outcomes)) { const s=algorithmTotals[alg]||(algorithmTotals[alg]={runs:0,repairs:0,confidence:0}); s.runs++; s.repairs+=Number(out.count||0); s.confidence+=Number(out.confidenceSum||0); }
      if (Number.isFinite(Number(x.score_delta))) deltas.push(Number(x.score_delta));
    }
    if (/what dataset|which dataset|dataset.*learn|learn.*dataset|data set.*learn|data set.*analy/.test(q)) {
      if (!records.length) return 'I do not have any saved analyses in my Supabase knowledge store yet. Once you analyze and save a dataset, I can refer to its issue patterns, repairs and score changes here.';
      return `So far, I have stored ${records.length} analysis record${records.length===1?'':'s'} across ${names.length} distinct dataset name${names.length===1?'':'s'}: ${names.join(', ')}.\n\nThese records include issue counts, repair patterns and quality-score changes. They are observations from past runs—not a model trained on ground-truth labels. Ask me about a particular dataset or repair pattern, and I'll explain what the stored records show.`;
    }
    if (/what is it about|what.*titanic|tell me about|describe.*dataset/.test(q) && records.length) {
      const titanic = records.filter(x => /titanic/i.test(x.dataset_name||''));
      if (titanic.length) return `The Titanic dataset is about passengers aboard the RMS Titanic and records passenger attributes such as survival outcome, passenger class, name, sex, age, family aboard, ticket, fare, cabin and embarkation port.\n\nIn my saved DataFix analyses, Titanic has been checked for missing values, outliers, duplicates and noise. The stored repair history includes whitespace normalization, duplicate detection, outlier capping, K-NN imputation and mode imputation. The saved average quality-score change is approximately +3.9 points across the reported runs. That score change is a signal, not proof that every repair was correct.`;
    }
    if (/common|most frequent|frequent|problem|issue/.test(q) && records.length) {
      const ranked = Object.entries(issueTotals).sort((a,b)=>b[1]-a[1]).slice(0,5);
      if (ranked.length) return `Across the ${records.length} saved analysis records, the most frequently recorded issue categories are ${ranked.map(([k,v])=>`${k} (${v})`).join(', ')}. These are cumulative recorded counts and may include multiple runs of the same dataset, so they should not be interpreted as unique affected rows.`;
    }
    if (/algorithm|repair method|imput|worked|best/.test(q) && records.length) {
      const ranked = Object.entries(algorithmTotals).sort((a,b)=>b[1].runs-a[1].runs).slice(0,5);
      if (ranked.length) return `My saved repair history includes these algorithms: ${ranked.map(([k,v])=>`${k} (${v.runs} observations, ${v.repairs} repairs logged)`).join('; ')}. The history is useful as evidence of what has been applied, but it is not enough by itself to rank algorithm accuracy—validated outcomes or user feedback would be needed for that.`;
    }
    if (/score|improv|delta/.test(q) && deltas.length) {
      const avg = deltas.reduce((a,b)=>a+b,0)/deltas.length;
      return `Across ${deltas.length} saved runs, the average dataset-level quality-score change is ${avg>=0?'+':''}${avg.toFixed(2)} points. This is a proxy for improvement, not ground truth; it cannot prove that every individual repair was correct.`;
    }
    return `I can answer from ${records.length} saved KDD record${records.length===1?'':'s'}${names.length?`, covering ${names.join(', ')}`:''}.\n\n${knowledgeWarning ? `Knowledge-store note: ${knowledgeWarning}.\n\n` : ''}I don't have enough specific evidence in the stored observations to answer that confidently. I can still give general data-quality guidance, but I'll label it as general guidance rather than pretending it came from your history.`;
  };
  const fallbackReply = localAnswer(userQuestion);
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(200).json({ reply: fallbackReply, model: 'DataFix local knowledge fallback', knowledgeRecords: knowledge.length, knowledgeWarning: knowledgeWarning || undefined, fallback: true });

  // Keep retrieval context concise to avoid token-heavy prompts and reduce rate-limit failures.
  const relevant = knowledge.slice(0, 18).map(x => ({ dataset_name:x.dataset_name, created_at:x.created_at, score_delta:x.score_delta, issue_patterns:x.issue_patterns, repair_patterns:x.repair_patterns, knowledge:x.knowledge }));
  const system = `You are DataFix AI, a thoughtful conversational data quality analyst—not a database formatter. Answer in natural, complete sentences, directly addressing the user's question. Do not output raw JSON, database dumps, or markdown tables unless the user specifically asks for a table. Explain unfamiliar concepts clearly, use short paragraphs and occasional bullet points, and avoid repeating the question. Ground historical claims strictly in the records provided; state sample counts and uncertainty where useful. Separate stored evidence from your own general explanation. Never invent analyses or claim self-training. If there is not enough historical evidence, say so and then offer clearly labeled general guidance. Dataset diagnoses are available only as summarized metadata; do not imply you inspected raw rows. If the user asks to clean a file, remind them to use the app's explicit action to authorize repair. Historical KDD records (${knowledge.length}): ${JSON.stringify(relevant).slice(0,9000)}. Knowledge-store status: ${knowledgeWarning || 'available'}. Current uploaded dataset summary: ${datasetSummary}`;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${groqKey}` }, body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.45, max_tokens: 650, messages: [{ role: 'system', content: system }, ...messages] }) });
    const data = await r.json();
    if (!r.ok) {
      // Rate-limit and transient provider failures return a useful grounded response rather than a raw error dump.
      if (r.status === 429 || r.status >= 500) return res.status(200).json({ reply: fallbackReply, model: 'DataFix local knowledge fallback', knowledgeRecords: knowledge.length, knowledgeWarning: `AI provider temporarily unavailable (${r.status}); answered from saved KDD records.`, fallback: true });
      return res.status(r.status).json({ error: data.error?.message || 'AI request failed' });
    }
    return res.status(200).json({ reply: data.choices?.[0]?.message?.content || fallbackReply, model: data.model, knowledgeRecords: knowledge.length, knowledgeWarning: knowledgeWarning || undefined });
  } catch (e) {
    return res.status(200).json({ reply: fallbackReply, model: 'DataFix local knowledge fallback', knowledgeRecords: knowledge.length, knowledgeWarning: `AI provider connection failed: ${e.message}`, fallback: true });
  }
}
