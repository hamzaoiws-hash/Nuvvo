import { geminiKeys, callGemini } from '../functions/ai/index.ts';
import { geminiKeys as gk2, callGemini as cg2 } from '../functions/ai-moderate/index.ts';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); };
for (const [K, C] of [[geminiKeys, callGemini], [gk2, cg2]]) {
  const e = (o) => (k) => o[k];
  ok(K(e({})).length === 0, 'none');
  ok(K(e({ GEMINI_API_KEY: 'AAA1' })).join() === 'AAA1', 'single');
  ok(K(e({ GEMINI_API_KEYS: 'KK1, KK2\nKK3;KK1', GEMINI_API_KEY: 'KK2' })).sort().join() === 'KK1,KK2,KK3', 'list + dedupe');
  ok(K(e({ GEMINI_API_KEYS: Array.from({ length: 20 }, (_, i) => 'k' + i).join(',') })).length === 10, 'cap 10');
  ok(K(e({ GEMINI_API_KEYS: 'a b/c, ok1' })).join() === 'ok1', 'bad chars dropped');
  // rotation: only K3 works
  let used = []; const f = async (u, o) => { used.push(o.headers['x-goog-api-key']); return o.headers['x-goog-api-key'] === 'K3' ? new Response('{"ok":1}') : new Response('{"error":"quota"}', { status: 429 }); };
  let r = await C(['K1', 'K2', 'K3'], 'https://g', '{}', f); ok(r.ok && used.length >= 1 && used[used.length - 1] === 'K3' && new Set(used).size === used.length, 'falls through to working key, no repeats');
  // all exhausted -> last 429 returned
  used = []; r = await C(['K1', 'K2'], 'https://g', '{}', async (u, o) => { used.push(1); return new Response('x', { status: 429 }); }); ok(r.status === 429 && used.length === 2, 'all exhausted -> 429 after trying each once');
  // 400 normal error is not retried; invalid-key 400 is
  used = []; r = await C(['K1', 'K2'], 'https://g', '{}', async () => { used.push(1); return new Response('bad json', { status: 400 }); }); ok(r.status === 400 && used.length === 1, '400 not retried');
  used = []; r = await C(['K1', 'K2'], 'https://g', '{}', async (u, o) => { used.push(1); return o.headers['x-goog-api-key'] === 'K2' ? new Response('{}') : new Response('{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 }); }); ok(r.ok, 'invalid key 400 -> next key');
  // network error on one key
  r = await C(['K1', 'K2'], 'https://g', '{}', async (u, o) => { if (o.headers['x-goog-api-key'] === 'K1') throw new Error('net'); return new Response('{}'); }); ok(r.ok, 'network error -> next key');
  // load spread
  const first = new Set(); for (let i = 0; i < 60; i++) await C(['A1', 'B2', 'C3'], 'https://g', '{}', async (u, o) => { first.add(o.headers['x-goog-api-key']); return new Response('{}'); }); ok(first.size === 3, 'random start spreads load');
}
console.log('pass', pass, 'fail', fail);
