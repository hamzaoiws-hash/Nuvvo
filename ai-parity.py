import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import ai_server
cases = json.load(open(os.path.join(os.path.dirname(__file__), 'ai-parity.cases.json')))
ENV = {'SUPABASE_URL': 'https://x.supabase.co', 'SUPABASE_ANON_KEY': 'anon', 'GEMINI_API_KEYS': 'keyone,keytwo'}
out = []
for c in cases:
    def fetch(u, method='GET', headers=None, body=None, c=c):
        if u.endswith('/auth/v1/user'): return (401 if c.get('userOk') is False else 200), '{}'
        if u.endswith('/rpc/ai_take'): return (400, '{"message":"ai_limit"}') if c.get('quota') is False else (200, '39')
        if u.endswith('/rpc/is_mod'): return 200, 'true' if c.get('isMod') else 'false'
        return c.get('geminiStatus', 200), json.dumps(c.get('gemini') or {})
    st, obj = ai_server.handle('POST', {'authorization': 'Bearer t'}, json.dumps(c['body']).encode(), ENV.get, fetch)
    out.append([c['name'], st, obj])
print(json.dumps(out))
