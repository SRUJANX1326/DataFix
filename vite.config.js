import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, files in /api behave exactly like Vercel serverless functions (same code, same URL: /api/<name>).
function apiDev() {
  return {
    name: 'datafix-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url.match(/^\/api\/([a-z-]+)(\?.*)?$/); if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.js`); let raw = ''; for await (const c of req) raw += c;
          req.body = raw ? JSON.parse(raw) : {}; res.status = (c) => { res.statusCode = c; return res; };
          res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
          await mod.default(req, res);
        } catch (e) { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: e.message })); }
      });
    },
  };
}
export default defineConfig(({ mode }) => { Object.assign(process.env, loadEnv(mode, process.cwd(), '')); return { plugins: [react(), apiDev()], build: { chunkSizeWarningLimit: 1500 } }; });
