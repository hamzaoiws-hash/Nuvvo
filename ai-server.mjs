// Standalone AI server in JavaScript (Node 22.6+, no npm packages). Same behaviour as the Supabase Edge Function "ai":
// it reuses that exact code (functions/ai/index.ts), so modes, limits, safety rules and multi-key rotation are identical.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_... \
//   GEMINI_API_KEYS=key1,key2,key3 PORT=8787 node --experimental-strip-types server/ai-server.mjs
//
// Then put  aiUrl: 'https://your-server/ai'  in public/config.js. Only signed-in users can use it: their login token is checked
// against your Supabase project, and the daily allowance (ai_take) is still counted there.
import http from 'node:http';
import { handler } from '../functions/ai/index.ts';

const MAX_BODY = 64 * 1024;
export function makeServer(env = (k) => process.env[k], f = fetch) {
  return http.createServer(async (req, res) => {
    try {
      const path = (req.url || '/').split('?')[0];
      if (path === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
      if (path !== '/ai' && path !== '/') { res.writeHead(404); return res.end(); }
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413); return res.end(); } chunks.push(c); }
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = new Request('http://localhost/ai', { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await handler(r, env, f);
      res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"server"}'); }
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8787;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) console.warn('Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  makeServer().listen(port, () => console.log('AI server on :' + port));
}
