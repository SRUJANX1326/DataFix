```javascript
// Groq-powered narrative insights. Receives ONLY aggregated statistics (never raw rows).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: 'GROQ_API_KEY is not configured on the server'
    });
  }

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const summary = JSON.stringify((req.body || {}).summary || {}).slice(0, 24000);

  const system = 'You are a senior data-quality engineer. You receive aggregate statistics about a dataset that was audited and auto-repaired. Respond ONLY with JSON: {"headline":string,"insights":string[],"risks":string[],"recommendations":string[]}. 4-6 insights about the data itself (distributions, relationships, segments), 3-5 risks/caveats (unresolved issues, low-confidence repairs, bias introduced by imputation), 3-5 concrete recommendations to prevent the problems at the source. Be specific, cite numbers, no markdown.';

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: summary }
        ]
      })
    });

    const j = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: j.error?.message || 'Groq request failed',
        model
      });
    }

    return res.status(200).json({
      model: j.model,
      ...JSON.parse(j.choices[0].message.content)
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message,
      model
    });
  }
}
```
