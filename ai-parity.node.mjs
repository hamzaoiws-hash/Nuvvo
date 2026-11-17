import { readFileSync } from 'node:fs';
import { handler } from '../functions/ai/index.ts';
const cases = JSON.parse(readFileSync(new URL('./ai-parity.cases.json', import.meta.url)));
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', GEMINI_API_KEYS: 'keyone,keytwo' };
const out = [];
for (const c of cases) {
  const f = async (u) => {
    if (u.endsWith('/auth/v1/user')) return new Response('{}', { status: c.userOk === false ? 401 : 200 });
    if (u.endsWith('/rpc/ai_take')) return c.quota === false ? new Response('{"message":"ai_limit"}', { status: 400 }) : new Response('39');
    if (u.endsWith('/rpc/is_mod')) return new Response(String(!!c.isMod));
    return new Response(JSON.stringify(c.gemini || {}), { status: c.geminiStatus || 200 });
  };
  const r = await handler(new Request('https://f/ai', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(c.body) }), (k) => ENV[k], f);
  out.push([c.name, r.status, await r.json()]);
}
console.log(JSON.stringify(out));
