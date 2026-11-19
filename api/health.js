export default function handler(req, res) {
  res.status(200).json({ ok: true, groq: !!process.env.GROQ_API_KEY, supabase: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) });
}
