
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

  const model =
    process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const summary = JSON.stringify(
    (req.body || {}).summary || {}
  ).slice(0, 24000);

  const system = `
You are a senior data-quality engineer.

You receive aggregate statistics about a dataset that was audited
and auto-repaired. You never receive raw dataset rows.

Respond ONLY with valid JSON in this format:
{
  "headline": "string",
  "insights": ["string"],
  "risks": ["string"],
  "recommendations": ["string"]
}

Include:
- 4 to 6 insights about the dataset
- 3 to 5 risks or caveats
- 3 to 5 concrete recommendations

Be specific, use actual statistics, and do not use markdown.
`;

  try {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
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
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Groq API error:', result);

      return res.status(response.status).json({
        error:
          result?.error?.message ||
          'Groq request failed'
      });
    }

    const content = result?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({
        error: 'Groq returned an empty response'
      });
    }

    let insights;

    try {
      insights = JSON.parse(content);
    } catch {
      console.error('Invalid AI JSON response:', content);

      return res.status(502).json({
        error: 'AI returned invalid JSON'
      });
    }

    return res.status(200).json({
      model: result.model || model,
      ...insights
    });

  } catch (error) {
    console.error('Insights API error:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
}
