/* Nuvvo <-> Supabase bridge.
   app.js calls window.CH_API(method, '/api/...', body) exactly like it used to call the Worker;
   this file turns each call into Supabase queries (RLS in schema.sql does the access control). */
(function () {
'use strict';

var C = window.CH_CONFIG;
if (!window.supabase || !window.supabase.createClient) {
  window.CH_API = async function () { var e = new Error(T('مقدرناش نحمّل مكتبة الاتصال بالسيرفر. اتأكد من النت وحدّث الصفحة (Ctrl+F5).')); e.status = 0; throw e; };
  throw new Error('supabase-js did not load');
}
var sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
var BUCKET = 'files';

var CHALLENGES = [
  T('اشرح قانون نيوتن التاني بمثال من حياتك اليومية في سطرين.'),
  T('اكتب تلخيص فقرة واحدة لأهم حاجة اتعلمتها الأسبوع ده.'),
  T('إيه أحسن طريقة بتحفظ بيها قانون أو تعريف؟ اشرحها بمثال.'),
  T('اشرح مفهوم مادة بتذاكرها كأنك بتشرحه لطالب أصغر منك.'),
  T('اكتب سؤال امتحان من عندك مع إجابته النموذجية.'),
  T('إيه الغلطة اللي اتكررت معاك في الامتحانات وعملت إيه عشان تتفاداها؟'),
  T('اقترح جدول مراجعة لأسبوع قبل الامتحان لمادة واحدة.'),
  T('اشرح فكرة علمية بتحبها بتشبيه من الحياة العادية.')
];
var UPLOAD_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  file: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime']
};
var UPLOAD_LIMITS = { image: 3e6, file: 10e6, video: 25e6 };
var fileTypes = {}; // path -> content type, remembered between upload and publishing a summary

/* ------------------------------------------------------------------ helpers */
function Err(message, status) { var e = new Error(message); e.status = status || 400; return e; }
var hasArabic = function (s) { return /[؀-ۿ]/.test(s || ''); };
var ms = function (t) { return t ? Date.parse(t) : 0; };
var todayStr = function () { return new Date().toISOString().slice(0, 10); };

function fail(e) {
  var m = (e && e.message) || '', c = e && e.code, st = (e && e.status) || 0;
  if (e instanceof Error && e.status && hasArabic(m)) return e;
  if (hasArabic(m)) return Err(m, st === 401 ? 400 : (st || 400));
  if (/Invalid login credentials/i.test(m)) return Err(T('الإيميل أو الباسورد غلط'), 400);
  if (/already registered/i.test(m)) return Err(T('الإيميل ده مسجل قبل كده'), 409);
  if (/Database error saving new user/i.test(m)) return Err(T('اسم المستخدم ده مأخوذ أو مش صالح'), 409);
  if (/Email not confirmed/i.test(m)) return Err(T('لازم تأكد الإيميل الأول من الرسالة اللي وصلتك'), 400);
  if (/rate limit|too many/i.test(m)) return Err(T('محاولات كتير، استنى شوية وجرّب تاني'), 429);
  if (/Password should be|weak/i.test(m)) return Err(T('الباسورد ضعيف، لازم ٨ حروف على الأقل'), 400);
  if (/invalid email|Unable to validate email/i.test(m)) return Err(T('الإيميل مش مكتوب صح'), 400);
  if (c === '23505') return Err(T('القيمة دي مأخوذة قبل كده'), 409);
  if (c === '42501' || /row-level security/i.test(m)) return Err(T('مش مسموح'), 403);
  if (st === 401 || /JWT|not authenticated/i.test(m)) return Err(T('لازم تسجل دخول الأول'), 401);
  if (/provider is not enabled|Unsupported provider/i.test(m)) return Err(T('الدخول بالطريقة دي لسه متفعّلش من إعدادات Supabase'), 400);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return Err(T('مفيش اتصال بالإنترنت، جرّب تاني'), 0);
  console.error(e);
  return Err(T('حصلت مشكلة، جرّب تاني'), 500);
}
async function q(p) { var r = await p; if (r.error) throw fail(r.error); return r.data; }

async function session() {
  var r = await sb.auth.getSession(), s = r.data && r.data.session;
  if (!s) throw Err(T('لازم تسجل دخول الأول'), 401);
  return s;
}
async function uid() { return (await session()).user.id; }
function removeFiles(paths) {
  paths = paths.filter(Boolean);
  if (!paths.length) return Promise.resolve();
  return Promise.resolve(sb.storage.from(BUCKET).remove(paths)).catch(function () {});
}
function toggleRow(table, match, row) {
  // delete the row if it exists, otherwise insert it; resolves to true when it was inserted
  var del = sb.from(table).delete();
  Object.keys(match).forEach(function (k) { del = del.eq(k, match[k]); });
  return q(del.select()).then(function (gone) {
    if (gone && gone.length) return false;
    return q(sb.from(table).insert(row)).then(function () { return true; });
  });
}

async function meP() {
  var s = await session(), id = s.user.id;
  var r = await Promise.all([q(sb.from('profiles').select('*').eq('id', id).single()), q(sb.rpc('my_stats')), sb.rpc('is_mod'), sb.rpc('my_number'),
    sb.rpc('is_admin'), sb.from('subscriptions').select('plan,expires').maybeSingle(), sb.from('businesses').select('*').maybeSingle(), sb.rpc('name_quota')]);
  var p = r[0], st = r[1], is_mod = r[2].data === true, pnum = typeof r[3].data === 'string' ? r[3].data : '';
  var nq = Array.isArray(r[7].data) ? r[7].data[0] : r[7].data, sub = r[5].data && Date.parse(r[5].data.expires) > Date.now() ? { plan: r[5].data.plan, expires: r[5].data.expires } : null;   // these three just come back empty before hardening.sql section 11 is run   // is_mod() is absent until hardening.sql section 8 runs; then it is just false
  return { me: {
    id: id, name: p.name, email: s.user.email, bio: p.bio, avatar_key: p.avatar_path, privacy: p.privacy,
    settings: p.settings || {}, freeze_until: p.freeze_until, unread: st.unread, stats: st, is_mod: is_mod, is_admin: r[4].data === true, sub: sub, biz: r[6].data || null, pnum: pnum, banner_key: p.banner_path, nameLeft: nq ? nq.left_count : null, nameNext: nq && nq.next_at ? nq.next_at : null
  } };
}

function mapPost(r) {
  return { id: r.id, text: r.text, img_key: r.img_path, created: ms(r.created), uid: r.uid, name: r.name, avatar_key: r.avatar_path,
    likes: Number(r.likes), liked: r.liked, comments: Number(r.comments), saved: r.saved, following: r.following };
}
function guessType(name) { return /\.pdf$/i.test(name || '') ? 'application/pdf' : 'image/jpeg'; }

/* ------------------------------------------------------------------ router */
/* The AI helper normally runs as the Supabase Edge Function "ai". If CH_CONFIG.aiUrl is set, the same request goes to your own server
   (server/ai-server.mjs = Node, server/ai_server.py = Python) with the user's login token, and the answers keep the same shape. */
async function aiInvoke(body) {
  var u = (window.CH_CONFIG || {}).aiUrl;
  if (!u) return sb.functions.invoke('ai', { body: body });
  var fail = function (code) { return { data: null, error: { context: { json: async function () { return { error: code }; } } } }; };
  try {
    var ss = await sb.auth.getSession(), tok = ss.data && ss.data.session ? ss.data.session.access_token : '';
    var res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, apikey: C.key }, body: JSON.stringify(body) });
    var data = await res.json().catch(function () { return null; });
    if (res.ok && data) return { data: data, error: null };
    return { data: null, error: { context: { json: async function () { return data || { error: 'upstream' }; } } } };
  } catch (e) { return fail('upstream'); }
}

async function route(method, path, body) {
  var parts = path.split('?'), p = parts[0].replace(/^\/api\//, ''), qs = new URLSearchParams(parts[1] || ''), m, id, r;
  var K = method + ' ' + p;
  var R = function (re) { m = K.match(re); return !!m; };
  body = body || {};

  /* ----- account ----- */
  if (K === 'POST signup') {
    var nm = String(body.name || '').trim();
    if (nm.length < 2 || nm.length > 30) throw Err(T('اسم المستخدم لازم يكون من ٢ إلى ٣٠ حرف'), 400);
    r = await sb.auth.signUp({ email: body.email, password: body.password, options: { data: { name: nm }, captchaToken: await captcha() } });
    if (r.error) throw fail(r.error);
    if (!r.data.session) return { verify: true };
    return meP();
  }
  if (K === 'POST report') {
    var kinds = { post: 1, user: 1, comment: 1 }, reasons = { spam: 1, abuse: 1, inappropriate: 1, other: 1 };
    if (!kinds[body.kind] || !reasons[body.reason] || !/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) throw Err(T('البلاغ مش مكتمل'), 400);
    r = await sb.from('reports').insert({ kind: body.kind, target_id: body.id, reason: body.reason, note: String(body.note || '').slice(0, 300) });
    if (r.error && r.error.code !== '23505') throw fail(r.error);
    return { ok: true, dup: !!r.error };
  }
  if (K === 'POST verify') {
    var code = String(body.code || '').replace(/\D/g, '');
    var need = (window.CH_CONFIG && CH_CONFIG.otpLen) || 8;
    if (code.length !== need) throw Err(T('اكتب الكود كامل'), 400);
    r = await sb.auth.verifyOtp({ email: body.email, token: code, type: 'signup' });
    if (r.error) throw Err(T('الكود غلط أو انتهت صلاحيته'), 400);
    return meP();
  }
  if (K === 'POST recover') {
    var rem = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rem)) throw Err(T('الإيميل مش مكتوب صح'), 400);
    r = await sb.auth.resetPasswordForEmail(rem, { captchaToken: await captcha() });
    if (r.error && /rate limit|too many|seconds/i.test(r.error.message || '')) throw Err(T('استنى شوية وجرّب تاني'), 429);
    return { ok: true };                       // same answer whether or not the e-mail has an account
  }
  if (K === 'POST recover/verify') {
    var rc = String(body.code || '').replace(/\D/g, ''), rneed = (window.CH_CONFIG && CH_CONFIG.otpLen) || 8, npw = String(body.password || '');
    if (rc.length !== rneed) throw Err(T('اكتب الكود كامل'), 400);
    if (npw.length < 8) throw Err(T('الباسورد لازم يكون ٨ حروف على الأقل'), 400);
    r = await sb.auth.verifyOtp({ email: body.email, token: rc, type: 'recovery' });
    if (r.error) throw Err(T('الكود غلط أو انتهت صلاحيته'), 400);
    r = await sb.auth.updateUser({ password: npw });
    if (r.error) { await sb.auth.signOut(); throw Err(T('الباسورد ضعيف أو مرفوض، اطلب كود جديد وجرّب باسورد تاني'), 400); }
    return meP();
  }
  if (K === 'POST resend') {
    r = await sb.auth.resend({ type: 'signup', email: body.email, options: { captchaToken: await captcha() } });
    if (r.error) throw Err(T('استنى شوية وجرّب تاني'), 429);
    return { ok: true };
  }
  if (K === 'POST login') {
    r = await sb.auth.signInWithPassword({ email: body.email, password: body.password, options: { captchaToken: await captcha() } });
    if (r.error && /not confirmed/i.test(r.error.message || '')) { await sb.auth.resend({ type: 'signup', email: body.email, options: { captchaToken: await captcha() } }); return { verify: true }; }
    if (r.error) throw fail(r.error);
    await sb.from('profiles').update({ disabled: false }).eq('id', r.data.user.id);
    return meP();
  }
  if (R(/^POST oauth\/(google|github|discord)$/)) {
    r = await sb.auth.signInWithOAuth({ provider: m[1], options: Object.assign({ redirectTo: location.origin + location.pathname }, m[1] === 'discord' ? { scopes: 'identify email' } : {}) });
    if (r.error) throw fail(r.error);
    return { ok: true };
  }
  if (K === 'POST logout') { await sb.auth.signOut(); return { ok: true }; }
  if (K === 'GET me') return meP();

  if (K === 'PATCH me') {
    id = await uid();
    var upd = {};
    if ('bio' in body) upd.bio = String(body.bio || '').trim().slice(0, 140);
    if ('name' in body) {
      var n2 = String(body.name || '').trim();
      if (n2.length < 2 || n2.length > 30) throw Err(T('اسم المستخدم لازم يكون من ٢ إلى ٣٠ حرف'), 400);
      upd.name = n2;
    }
    if ('privacy' in body) upd.privacy = body.privacy;
    if ('freeze_until' in body) upd.freeze_until = body.freeze_until;
    if ('avatar_key' in body) {
      var old = (await q(sb.from('profiles').select('avatar_path').eq('id', id).single())).avatar_path;
      upd.avatar_path = body.avatar_key;
      if (old && old !== body.avatar_key) removeFiles([old]);
    }
    if ('banner_key' in body) {
      var oldb = (await q(sb.from('profiles').select('banner_path').eq('id', id).single())).banner_path;
      upd.banner_path = body.banner_key;
      if (oldb && oldb !== body.banner_key) removeFiles([oldb]);
    }
    if (body.settings) {
      var cur = (await q(sb.from('profiles').select('settings').eq('id', id).single())).settings || {}, b = body.settings;
      if ('color' in b) cur.color = b.color;
      if ('fs' in b) cur.fs = b.fs;
      if (b.chat && typeof b.chat === 'object') {
        var cc = Object.assign({}, cur.chat || {}), ch = b.chat;
        if ('bg' in ch && ['none', 'dots', 'lines', 'aurora', 'dusk', 'paper'].indexOf(ch.bg) >= 0) cc.bg = ch.bg;
        if ('shape' in ch && ['round', 'soft', 'square'].indexOf(ch.shape) >= 0) cc.shape = ch.shape;
        if ('size' in ch && ['s', 'm', 'l'].indexOf(ch.size) >= 0) cc.size = ch.size;
        if ('mine' in ch && (ch.mine === '' || /^#[0-9a-f]{6}$/i.test(ch.mine))) cc.mine = ch.mine;
        cur.chat = cc;
      }
      if ('grade' in b && (b.grade === '' || typeof b.grade === 'string')) cur.grade = String(b.grade).slice(0, 20);
      if ('subjects' in b) cur.subjects = String(b.subjects || '').slice(0, 200);
      if (b.notif) cur.notif = Object.assign({}, cur.notif || {}, b.notif);
      upd.settings = cur;
    }
    if (Object.keys(upd).length) {
      var ur = await sb.from('profiles').update(upd).eq('id', id);
      if (ur.error) throw (ur.error.code === '23505' ? Err(T('اسم المستخدم ده مأخوذ'), 409) : fail(ur.error));
    }
    return meP();
  }
  if (K === 'POST me/password/code') {
    var ss = await sb.auth.getSession(); if (!ss.data.session) throw Err(T('لازم تسجل دخول'), 401);
    r = await sb.auth.resetPasswordForEmail(ss.data.session.user.email, { captchaToken: await captcha() });
    if (r.error) throw Err(T('استنى شوية وجرّب تاني'), 429);
    return { ok: true };
  }
  if (K === 'POST me/password') {
    var ps = await sb.auth.getSession(), pcode = String(body.code || '').replace(/\D/g, ''), pnew = String(body.password || '');
    if (!ps.data.session) throw Err(T('لازم تسجل دخول'), 401);
    if (pcode.length !== ((window.CH_CONFIG && CH_CONFIG.otpLen) || 8)) throw Err(T('اكتب الكود كامل'), 400);
    if (pnew.length < 8) throw Err(T('الباسورد لازم يكون ٨ حروف على الأقل'), 400);
    r = await sb.auth.verifyOtp({ email: ps.data.session.user.email, token: pcode, type: 'recovery' });
    if (r.error) throw Err(T('الكود غلط أو انتهت صلاحيته'), 400);
    r = await sb.auth.updateUser({ password: pnew });
    if (r.error) throw fail(r.error);
    try { await sb.auth.signOut({ scope: 'others' }); } catch (e) { /* optional */ }
    return { ok: true };
  }
  if (K === 'POST me/disable') {
    id = await uid();
    await q(sb.from('profiles').update({ disabled: true }).eq('id', id));
    await sb.auth.signOut();
    return { ok: true };
  }
  if (K === 'POST me/delete') {
    var s = await session(); id = s.user.id;
    r = await sb.auth.signInWithPassword({ email: s.user.email, password: String(body.password || ''), options: { captchaToken: await captcha() } });
    if (r.error) throw Err(T('الباسورد غلط'), 403);
    var pr0 = await q(sb.from('profiles').select('avatar_path,banner_path').eq('id', id).single()), paths = [pr0.avatar_path, pr0.banner_path];
    (await q(sb.from('posts').select('img_path').eq('user_id', id))).forEach(function (x) { paths.push(x.img_path); });
    (await q(sb.from('summaries').select('file_path').eq('user_id', id))).forEach(function (x) { paths.push(x.file_path); });
    (await q(sb.from('reels').select('file_path').eq('user_id', id))).forEach(function (x) { paths.push(x.file_path); });
    await removeFiles(paths);
    await q(sb.rpc('delete_me'));
    await sb.auth.signOut();
    return { ok: true };
  }
  if (K === 'GET me/export') {
    id = await uid();
    var ex = await Promise.all([
      q(sb.from('profiles').select('name,bio,privacy,settings').eq('id', id).single()),
      q(sb.from('posts').select('id,text,created').eq('user_id', id)),
      q(sb.from('comments').select('post_id,text,created').eq('user_id', id)),
      q(sb.from('summaries').select('title,subject,year,file_name,created').eq('user_id', id)),
      q(sb.from('reels').select('title,created').eq('user_id', id)),
      q(sb.from('questions').select('text,created').eq('user_id', id)),
      q(sb.from('answers').select('question_id,text,created').eq('user_id', id)),
      q(sb.from('decks').select('name,cards(q,a,box)').eq('user_id', id)),
      q(sb.from('exams').select('name,date').eq('user_id', id)),
      q(sb.from('study_days').select('day,minutes').eq('user_id', id))
    ]);
    return { exported_at: new Date().toISOString(), profile: ex[0], posts: ex[1], comments: ex[2], summaries: ex[3], reels: ex[4],
      questions: ex[5], answers: ex[6], decks: ex[7], exams: ex[8], study_days: ex[9] };
  }

  /* ----- people ----- */
  if (K === 'GET users') {
    id = await uid();
    r = await Promise.all([
      q(sb.from('profiles').select('id,name,bio,avatar_path').neq('id', id).order('created', { ascending: false }).limit(100)),
      q(sb.from('follows').select('followee').eq('follower', id))
    ]);
    var fol = {}; r[1].forEach(function (x) { fol[x.followee] = 1; });
    return { users: r[0].map(function (u) { return { id: u.id, name: u.name, bio: u.bio, avatar_key: u.avatar_path, following: !!fol[u.id] }; }) };
  }
  if (R(/^GET users\/([0-9a-f-]{36})$/i)) return { profile: await q(sb.rpc('user_profile', { p_user: m[1] })) };
  if (R(/^GET users\/([0-9a-f-]{36})\/posts$/i)) return { posts: (await q(sb.rpc('user_posts', { p_user: m[1], p_limit: 30, p_offset: 0 }))).map(mapPost) };
  if (R(/^GET users\/([0-9a-f-]{36})\/summaries$/i)) {
    return { summaries: (await q(sb.rpc('user_summaries', { p_user: m[1] }))).map(function (x) {
      return { id: x.id, title: x.title, subject: x.subject, year: x.year, file_key: x.file_path, file_name: x.file_name, file_type: x.file_type,
        created: ms(x.created), uid: x.uid, name: x.name, likes: Number(x.likes), liked: x.liked, kind: x.kind, exam_year: x.exam_year };
    }) };
  }
  if (K === 'GET suggest/people') {
    r = await q(sb.rpc('suggest_people', { p_limit: 10 }));
    return { users: r.map(function (u) { return { id: u.id, name: u.name, bio: u.bio, avatar_key: u.avatar_path, mutual: Number(u.mutual) }; }) };
  }
  if (K === 'GET suggest/sharers') {
    r = await q(sb.rpc('top_sharers', { p_limit: 10 }));
    return { users: r.map(function (u) { return { id: u.id, name: u.name, bio: u.bio, avatar_key: u.avatar_path, sums: Number(u.sums), exams: Number(u.exams), following: !!u.following }; }) };
  }
  if (R(/^POST follow\/([^/]+)$/)) {
    id = await uid();
    return { following: await toggleRow('follows', { follower: id, followee: m[1] }, { follower: id, followee: m[1] }) };
  }
  if (K === 'POST me/number') {
    await q(sb.rpc('set_number', { p_num: String(body.num || '') })); return { ok: true };
  }
  if (K === 'POST users/find') {
    var fr = await q(sb.rpc('find_by_number', { p_num: String(body.num || '') })), me0 = await uid();
    var fl = await q(sb.from('follows').select('followee').eq('follower', me0)), fm = {}; fl.forEach(function (x) { fm[x.followee] = 1; });
    return { users: fr.map(function (u) { return { id: u.id, name: u.name, bio: u.bio, avatar_key: u.avatar_path, following: !!fm[u.id] }; }) };
  }
  /* ----- subscriptions and business account ----- */
  if (K === 'GET plans') return { plans: await q(sb.from('plans').select('id,name,price_egp,days,quota_mb').order('price_egp')) };
  if (K === 'POST sub/request') {
    var ref = String(body.ref || '').trim();
    if (ref.length < 3) throw Err(T('اكتب رقم العملية أو مرجع الدفع'), 400);
    r = await sb.from('sub_requests').insert({ plan: String(body.plan || ''), ref: ref.slice(0, 120) });
    if (r.error) { if (r.error.code === '23505') throw Err(T('عندك طلب لسه بيتراجع'), 409); throw fail(r.error); }
    return { ok: true };
  }
  if (K === 'GET sub/requests') return { requests: await q(sb.from('sub_requests').select('id,plan,ref,status,created').order('created', { ascending: false }).limit(5)) };
  if (K === 'POST biz') {
    var bid = await uid(), bd = { name: String(body.name || '').trim().slice(0, 60), category: String(body.category || '').trim().slice(0, 40),
      description: String(body.description || '').trim().slice(0, 300), website: String(body.website || '').trim() };
    if (bd.name.length < 2) throw Err(T('اسم النشاط مطلوب'), 400);
    var have = await q(sb.from('businesses').select('user_id').eq('user_id', bid).maybeSingle());
    if (have) await q(sb.from('businesses').update(bd).eq('user_id', bid)); else await q(sb.from('businesses').insert(Object.assign({ user_id: bid }, bd)));
    return { ok: true };
  }
  /* ----- admin ----- */
  if (K === 'GET admin/stats') return { stats: await q(sb.rpc('admin_stats')) };
  if (K === 'POST admin/users') return { users: await q(sb.rpc('admin_users', { p_q: String(body.q || '').slice(0, 60) })) };
  if (K === 'POST admin/ban') { await q(sb.rpc('admin_set_banned', { p_user: body.id, p_banned: !!body.banned })); return { ok: true }; }
  if (K === 'POST admin/grant') { await q(sb.rpc('admin_grant', { p_user: body.id, p_plan: String(body.plan || ''), p_days: body.days ? parseInt(body.days) : null })); return { ok: true }; }
  if (K === 'POST admin/revoke') { await q(sb.rpc('admin_revoke', { p_user: body.id })); return { ok: true }; }
  if (K === 'GET admin/requests') return { requests: await q(sb.rpc('admin_requests')) };
  if (K === 'POST admin/request') { await q(sb.rpc('admin_decide_request', { p_id: body.id, p_approve: !!body.approve })); return { ok: true }; }
  if (K === 'GET admin/businesses') return { businesses: await q(sb.rpc('admin_businesses')) };
  if (K === 'POST admin/business') { await q(sb.rpc('admin_decide_business', { p_user: body.id, p_approve: !!body.approve })); return { ok: true }; }
  if (K === 'GET mod/reports') {
    var mr = await q(sb.rpc('mod_reports'));
    return { reports: mr.map(function (x) { return { id: x.id, kind: x.kind, reason: x.reason, note: x.note, created: ms(x.created), reporter_name: x.reporter_name, preview: x.preview }; }) };
  }
  if (K === 'GET mod/aiflags') {
    var fl = await q(sb.rpc('mod_ai_flags'));
    return { flags: fl.map(function (x) { return { id: x.id, kind: x.kind, category: x.category, reason: x.reason, created: ms(x.created), author_name: x.author_name, preview: x.preview }; }) };
  }
  if (K === 'POST mod/aiflag/resolve') {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) throw Err(T('البلاغ مش مكتمل'), 400);
    await q(sb.rpc('mod_ai_resolve', { p_flag: body.id, p_remove: !!body.remove })); return { ok: true };
  }
  if (K === 'POST mod/resolve') {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) throw Err(T('البلاغ مش مكتمل'), 400);
    await q(sb.rpc('mod_resolve', { p_report: body.id, p_remove: !!body.remove })); return { ok: true };
  }
  if (K === 'GET ai/status') { r = await aiInvoke({ mode: 'status' }); return { enabled: !r.error && !!(r.data && r.data.enabled) }; }
  if (K === 'GET ai/left') { r = await sb.rpc('ai_left'); return { left: r.error ? null : Number(r.data) }; }
  if (K === 'POST ai') {
    r = await aiInvoke(Object.assign({ lang: window.LANG }, body));
    if (r.error) {
      var aj = null; try { aj = await r.error.context.json(); } catch (e) { /* no body */ }
      var ac = aj && aj.error, am = { bad_file: 'الملف مش مناسب. استخدم صورة (JPEG/PNG/WebP) أو PDF صغير.', limit: 'خلّصت حدّك النهاردة. جرّب بكرة.', busy: 'الخدمة مشغولة دلوقتي، جرّب بعد شوية.', blocked: 'ماقدرتش أرد على ده. جرّب صياغة تانية.', ai_off: 'الذكاء الاصطناعي لسه مش متفعّل.', forbidden: 'مش مسموح' };
      throw Err(T(am[ac] || 'حصلت مشكلة في الذكاء الاصطناعي، جرّب تاني.'), ac === 'limit' || ac === 'busy' ? 429 : 400);
    }
    return r.data;
  }
  if (R(/^POST decks\/([^/]+)\/cards\/bulk$/)) {
    var bc = (Array.isArray(body.cards) ? body.cards : []).slice(0, 10).map(function (c) { return { deck_id: m[1], q: String(c.q || '').trim().slice(0, 200), a: String(c.a || '').trim().slice(0, 300) }; }).filter(function (c) { return c.q && c.a; });
    if (bc.length) await q(sb.from('cards').insert(bc));
    return { ok: true };
  }
  if (K === 'GET blocked') return { users: await q(sb.rpc('my_blocked')) };
  if (R(/^POST block\/([^/]+)$/)) {
    id = await uid();
    return { blocked: await toggleRow('blocks', { blocker: id, blocked: m[1] }, { blocker: id, blocked: m[1] }) };
  }

  /* ----- files ----- */
  if (K === 'POST upload') {
    id = await uid();
    var kind = qs.get('kind'), blob = body;
    if (!UPLOAD_TYPES[kind]) throw Err(T('نوع الرفع مش مدعوم'), 400);
    if (!(blob instanceof Blob)) throw Err(T('الملف مش صالح'), 400);
    if (UPLOAD_TYPES[kind].indexOf(blob.type) < 0) throw Err(T('نوع الملف ده مش مسموح'), 400);
    if (!blob.size) throw Err(T('الملف فاضي'), 400);
    if (blob.size > UPLOAD_LIMITS[kind]) throw Err(T('الملف كبير، الحد الأقصى ') + UPLOAD_LIMITS[kind] / 1e6 + T(' ميجا'), 413);
    var key = id + '/' + crypto.randomUUID();
    r = await sb.storage.from(BUCKET).upload(key, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
    if (r.error) throw fail(r.error);
    fileTypes[key] = blob.type;
    return { key: key, type: blob.type, size: blob.size };
  }

  /* ----- posts ----- */
  if (K === 'GET posts') {
    var lim = Math.min(parseInt(qs.get('limit')) || 10, 30), off = Math.max(parseInt(qs.get('offset')) || 0, 0);
    var rows = await q(sb.rpc('feed_posts', { p_view: qs.get('view') || 'all', p_q: (qs.get('q') || '').slice(0, 80), p_limit: lim + 1, p_offset: off, p_seed: (qs.get('seed') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) }));
    return { posts: rows.slice(0, lim).map(mapPost), more: rows.length > lim };
  }
  if (R(/^GET posts\/([0-9a-f-]{36})$/i)) {
    var one = await q(sb.rpc('post_by_id', { p_id: m[1] }));
    if (!one.length) throw Err(T('المنشور مش موجود أو مش متاح'), 404);
    return { post: mapPost(one[0]) };
  }
  if (K === 'POST posts') {
    var np = await q(sb.from('posts').insert({ text: String(body.text || '').trim(), img_path: body.img_key || null }).select('id').single());
    return { id: np.id };
  }
  if (R(/^DELETE posts\/([^/]+)$/)) {
    var po = await q(sb.from('posts').select('img_path').eq('id', m[1]).maybeSingle());
    await q(sb.from('posts').delete().eq('id', m[1]));
    if (po) removeFiles([po.img_path]);
    return { ok: true };
  }
  if (R(/^POST posts\/([^/]+)\/like$/)) return q(sb.rpc('toggle_react', { p_kind: 'post', p_id: m[1], p_react: String((body && body.react) || 'like') }));
  if (R(/^POST posts\/([^/]+)\/save$/)) {
    id = await uid();
    return { saved: await toggleRow('saves', { user_id: id, post_id: m[1] }, { user_id: id, post_id: m[1] }) };
  }
  if (R(/^GET posts\/([^/]+)\/comments$/)) {
    var cs = await q(sb.from('comments').select('id,text,created,user_id,profiles(name,avatar_path)').eq('post_id', m[1]).order('created', { ascending: true }).limit(200));
    return { comments: cs.filter(function (c) { return c.profiles; }).map(function (c) {
      return { id: c.id, text: c.text, created: ms(c.created), uid: c.user_id, name: c.profiles.name, avatar_key: c.profiles.avatar_path };
    }) };
  }
  if (R(/^POST posts\/([^/]+)\/comments$/)) {
    id = await uid();
    var ct = String(body.text || '').trim();
    if (!ct) throw Err(T('التعليق مطلوب'), 400);
    await q(sb.from('comments').insert({ post_id: m[1], user_id: id, text: ct }));
    return { ok: true };
  }

  /* ----- library ----- */
  if (K === 'GET summaries') {
    var sr = await q(sb.rpc('summaries_list', { p_subject: qs.get('subject') || '', p_year: qs.get('year') || '', p_q: (qs.get('q') || '').slice(0, 80), p_sort: qs.get('sort') === 'likes' ? 'likes' : 'new', p_kind: qs.get('kind') === 'exam' ? 'exam' : 'sum' }));
    return { summaries: sr.map(function (x) {
      return { id: x.id, title: x.title, subject: x.subject, year: x.year, file_key: x.file_path, file_name: x.file_name, file_type: x.file_type,
        created: ms(x.created), uid: x.uid, name: x.name, likes: Number(x.likes), liked: x.liked, kind: x.kind, exam_year: x.exam_year };
    }) };
  }
  if (K === 'POST summaries') {
    id = await uid();
    await q(sb.from('summaries').insert({
      user_id: id, title: String(body.title || '').trim(), subject: String(body.subject || '').trim(), year: body.year || '',
      file_path: body.file_key || null, file_name: body.file_name || '',
      file_type: body.file_key ? (fileTypes[body.file_key] || guessType(body.file_name)) : '',
      kind: body.kind === 'exam' ? 'exam' : 'sum', exam_year: body.kind === 'exam' ? (parseInt(body.exam_year) || null) : null
    }));
    return { ok: true };
  }
  if (R(/^DELETE summaries\/([^/]+)$/)) {
    var su = await q(sb.from('summaries').select('file_path').eq('id', m[1]).maybeSingle());
    await q(sb.from('summaries').delete().eq('id', m[1]));
    if (su) removeFiles([su.file_path]);
    return { ok: true };
  }
  if (R(/^POST summaries\/([^/]+)\/like$/)) return q(sb.rpc('toggle_react', { p_kind: 'summary', p_id: m[1], p_react: String((body && body.react) || 'like') }));
  if (K === 'GET reels') {
    var rr = await q(sb.rpc('reels_list'));
    return { reels: rr.map(function (x) { return { id: x.id, title: x.title, file_key: x.file_path, created: ms(x.created), uid: x.uid, name: x.name, likes: Number(x.likes), liked: x.liked }; }) };
  }
  if (K === 'POST reels') {
    id = await uid();
    await q(sb.from('reels').insert({ user_id: id, title: String(body.title || '').trim(), file_path: body.file_key }));
    return { ok: true };
  }
  if (R(/^DELETE reels\/([^/]+)$/)) {
    var re = await q(sb.from('reels').select('file_path').eq('id', m[1]).maybeSingle());
    await q(sb.from('reels').delete().eq('id', m[1]));
    if (re) removeFiles([re.file_path]);
    return { ok: true };
  }
  if (R(/^POST reels\/([^/]+)\/like$/)) return q(sb.rpc('toggle_react', { p_kind: 'reel', p_id: m[1], p_react: String((body && body.react) || 'like') }));

  /* ----- groups ----- */
  if (K === 'GET groups') {
    id = await uid();
    r = await Promise.all([q(sb.from('groups').select('id,name,owner,created,group_members(count)')), q(sb.from('group_members').select('group_id').eq('user_id', id))]);
    var gm = {}; r[1].forEach(function (x) { gm[x.group_id] = 1; });
    var gl = r[0].map(function (g) { return { id: g.id, name: g.name, owner: g.owner, created: ms(g.created), members: g.group_members[0].count, mine: gm[g.id] ? 1 : 0 }; });
    gl.sort(function (a, b) { return (b.mine - a.mine) || (b.created - a.created); });
    return { groups: gl.slice(0, 100) };
  }
  if (K === 'POST groups') return q(sb.from('groups').insert({ name: String(body.name || '').trim() }).select('id').single());
  if (R(/^DELETE groups\/([^/]+)$/)) { await q(sb.from('groups').delete().eq('id', m[1])); return { ok: true }; }
  if (K === 'POST groups/join') {
    var gid = await q(sb.rpc('join_group', { p_code: String(body.code || '').trim() }));
    return { id: gid };
  }
  if (R(/^GET groups\/([^/]+)\/code$/)) return { code: (await q(sb.rpc('group_code', { p_group: m[1] }))) || null };
  if (R(/^POST groups\/([^/]+)\/join$/)) {            // leave a group (joining is only possible with an invite code)
    id = await uid();
    await q(sb.from('group_members').delete().eq('group_id', m[1]).eq('user_id', id));
    return { member: false };
  }
  if (R(/^GET groups\/([^/]+)\/messages$/)) {
    id = await uid();
    r = await Promise.all([
      q(sb.from('groups').select('id,name,owner,group_members(count)').eq('id', m[1]).single()),
      q(sb.from('group_members').select('user_id').eq('group_id', m[1]).eq('user_id', id).maybeSingle()),
      q(sb.from('group_msgs').select('id,text,created,user_id,profiles(name)').eq('group_id', m[1]).order('created', { ascending: false }).limit(100)),
      q(sb.rpc('group_code', { p_group: m[1] }))
    ]);
    return { group: { id: r[0].id, name: r[0].name, owner: r[0].owner, members: r[0].group_members[0].count, mine: !!r[1], code: r[3] || null },
      messages: r[2].reverse().map(function (x) { return { id: x.id, text: x.text, created: ms(x.created), uid: x.user_id, name: (x.profiles || {}).name || '' }; }) };
  }
  if (R(/^GET groups\/([^/]+)\/info$/)) {
    var gi = await Promise.all([
      q(sb.from('groups').select('owner').eq('id', m[1]).single()),
      q(sb.from('group_members').select('user_id,profiles(name,avatar_path)').eq('group_id', m[1])),
      sb.from('groups').select('description').eq('id', m[1]).maybeSingle()          // the column exists after hardening.sql section 13
    ]);
    return { owner: gi[0].owner, description: (gi[2].data && gi[2].data.description) || '',
      members: gi[1].filter(function (x) { return x.profiles; }).map(function (x) { return { id: x.user_id, name: x.profiles.name, avatar_key: x.profiles.avatar_path }; }) };
  }
  if (R(/^POST groups\/([^/]+)\/update$/)) {
    var gn = String(body.name || '').trim();
    if (gn.length < 2 || gn.length > 50) throw Err(T('اسم الخلية لازم يكون من ٢ إلى ٥٠ حرف'), 400);
    r = await sb.from('groups').update({ name: gn, description: String(body.description || '').trim().slice(0, 200) }).eq('id', m[1]);
    if (r.error && r.error.code === '42703') r = await sb.from('groups').update({ name: gn }).eq('id', m[1]);   // description column not there yet
    if (r.error) throw fail(r.error);
    return { ok: true };
  }
  if (R(/^POST groups\/([^/]+)\/regen$/)) return { code: await q(sb.rpc('regen_group_code', { p_group: m[1] })) };
  if (R(/^POST groups\/([^/]+)\/kick$/)) { await q(sb.rpc('kick_member', { p_group: m[1], p_user: body.user })); return { ok: true }; }
  if (R(/^POST groups\/([^/]+)\/messages$/)) {
    id = await uid();
    await q(sb.from('group_msgs').insert({ group_id: m[1], user_id: id, text: String(body.text || '').trim() }));
    return { ok: true };
  }

  /* ----- projects ----- */
  if (K === 'GET projects') {
    id = await uid();
    r = await Promise.all([q(sb.from('projects').select('id,name,owner,created,project_members(count),tasks(done)')), q(sb.from('project_members').select('project_id').eq('user_id', id))]);
    var pm = {}; r[1].forEach(function (x) { pm[x.project_id] = 1; });
    var pl = r[0].map(function (x) {
      return { id: x.id, name: x.name, owner: x.owner, created: ms(x.created), total: x.tasks.length,
        done: x.tasks.filter(function (t) { return t.done; }).length, members: x.project_members[0].count, mine: pm[x.id] ? 1 : 0 };
    });
    pl.sort(function (a, b) { return (b.mine - a.mine) || (b.created - a.created); });
    return { projects: pl.slice(0, 100) };
  }
  if (K === 'POST projects') return q(sb.from('projects').insert({ name: String(body.name || '').trim() }).select('id').single());
  if (R(/^GET projects\/([^/]+)$/)) {
    id = await uid();
    r = await Promise.all([
      q(sb.from('projects').select('id,name,owner,project_members(count)').eq('id', m[1]).single()),
      q(sb.from('project_members').select('user_id').eq('project_id', m[1]).eq('user_id', id).maybeSingle()),
      q(sb.from('tasks').select('id,text,done').eq('project_id', m[1]).order('created', { ascending: true }).limit(300))
    ]);
    return { project: { id: r[0].id, name: r[0].name, owner: r[0].owner, members: r[0].project_members[0].count, mine: !!r[1] }, tasks: r[2] };
  }
  if (R(/^DELETE projects\/([^/]+)$/)) { await q(sb.from('projects').delete().eq('id', m[1])); return { ok: true }; }
  if (R(/^POST projects\/([^/]+)\/join$/)) {
    id = await uid();
    return { member: await toggleRow('project_members', { project_id: m[1], user_id: id }, { project_id: m[1], user_id: id }) };
  }
  if (R(/^POST projects\/([^/]+)\/tasks$/)) {
    await q(sb.from('tasks').insert({ project_id: m[1], text: String(body.text || '').trim() }));
    return { ok: true };
  }
  if (R(/^PATCH tasks\/([^/]+)$/)) { await q(sb.from('tasks').update({ done: !!body.done }).eq('id', m[1])); return { ok: true }; }
  if (R(/^DELETE tasks\/([^/]+)$/)) { await q(sb.from('tasks').delete().eq('id', m[1])); return { ok: true }; }

  /* ----- direct messages ----- */
  if (K === 'GET chat') {
    id = await uid();
    r = await Promise.all([
      q(sb.from('profiles').select('id,name,avatar_path,freeze_until').neq('id', id).order('name').limit(100)),
      q(sb.from('dms').select('from_id,to_id,text,created').or('from_id.eq.' + id + ',to_id.eq.' + id).order('created', { ascending: false }).limit(300))
    ]);
    var last = {};
    r[1].forEach(function (d) { var o = d.from_id === id ? d.to_id : d.from_id; if (!last[o]) last[o] = d; });
    var td = todayStr();
    var us = r[0].map(function (u) {
      var l = last[u.id];
      return { id: u.id, name: u.name, avatar_key: u.avatar_path, last: l ? l.text : null, last_at: l ? ms(l.created) : 0, frozen: !!(u.freeze_until && u.freeze_until >= td) };
    });
    us.sort(function (a, b) { return (b.last_at - a.last_at) || a.name.localeCompare(b.name); });
    return { users: us };
  }
  if (R(/^GET dm\/([^/]+)$/)) {
    id = await uid();
    var other = await q(sb.from('profiles').select('id,name,avatar_path,freeze_until').eq('id', m[1]).maybeSingle());
    if (!other) throw Err(T('المستخدم مش موجود'), 404);
    var dm = await q(sb.from('dms').select('id,from_id,text,created')
      .or('and(from_id.eq.' + id + ',to_id.eq.' + other.id + '),and(from_id.eq.' + other.id + ',to_id.eq.' + id + ')')
      .order('created', { ascending: false }).limit(100));
    return { user: { id: other.id, name: other.name, avatar_key: other.avatar_path, frozen: !!(other.freeze_until && other.freeze_until >= todayStr()) },
      messages: dm.reverse().map(function (x) { return { id: x.id, from_id: x.from_id, text: x.text, created: ms(x.created) }; }) };
  }
  if (R(/^POST dm\/([^/]+)$/)) {
    id = await uid();
    var dr = await sb.from('dms').insert({ from_id: id, to_id: m[1], text: String(body.text || '').trim() });
    if (dr.error) throw (dr.error.code === '42501' ? Err(T('مش هينفع تبعت دلوقتي: حسابه متجمد وقت الامتحانات أو الشات مش متاح'), 423) : fail(dr.error));
    return { ok: true };
  }

  /* ----- questions, challenge, leaderboard ----- */
  if (K === 'GET questions') {
    var ql = await q(sb.from('questions').select('id,text,created,user_id,profiles(name),answers(count)').order('created', { ascending: false }).limit(100));
    return { questions: ql.filter(function (x) { return x.profiles; }).map(function (x) {
      return { id: x.id, text: x.text, created: ms(x.created), uid: x.user_id, name: x.profiles.name, answers: x.answers[0].count };
    }) };
  }
  if (K === 'POST questions') return q(sb.from('questions').insert({ text: String(body.text || '').trim() }).select('id').single());
  if (R(/^GET questions\/([^/]+)$/)) {
    r = await Promise.all([q(sb.from('questions').select('id,text,created,user_id,profiles(name)').eq('id', m[1]).single()), q(sb.rpc('answers_list', { p_question: m[1] }))]);
    return { question: { id: r[0].id, text: r[0].text, created: ms(r[0].created), uid: r[0].user_id, name: (r[0].profiles || {}).name || '' },
      answers: r[1].map(function (a) { return { id: a.id, text: a.text, created: ms(a.created), uid: a.uid, name: a.name, votes: Number(a.votes), voted: a.voted, accepted: !!a.accepted }; }) };
  }
  if (R(/^DELETE questions\/([^/]+)$/)) { await q(sb.from('questions').delete().eq('id', m[1])); return { ok: true }; }
  if (R(/^POST questions\/([^/]+)\/answers$/)) {
    id = await uid();
    await q(sb.from('answers').insert({ question_id: m[1], user_id: id, text: String(body.text || '').trim() }));
    return { ok: true };
  }
  if (R(/^POST answers\/([^/]+)\/accept$/)) return { accepted: await q(sb.rpc('accept_answer', { p_answer: m[1] })) };
  if (K === 'GET stories') return { stories: (await q(sb.rpc('stories_feed'))).map(function (s) { return { id: s.id, uid: s.uid, name: s.name, avatar_key: s.avatar_path, kind: s.kind, img_key: s.img_path, text: s.text, bg: s.bg, created: ms(s.created), seen: s.seen, views: Number(s.views) }; }) };
  if (K === 'POST stories') { var ns = await q(sb.rpc('create_story', { p_kind: body.kind === 'img' ? 'img' : 'text', p_img: body.img_key || null, p_text: String(body.text || ''), p_bg: parseInt(body.bg) || 0 })); return { id: ns }; }
  if (R(/^DELETE stories\/([^/]+)$/)) { await q(sb.rpc('delete_story', { p_id: m[1] })); return { ok: true }; }
  if (R(/^POST stories\/([^/]+)\/view$/)) { await q(sb.rpc('view_story', { p_id: m[1] })); return { ok: true }; }
  if (R(/^GET stories\/([^/]+)\/viewers$/)) return { viewers: (await q(sb.rpc('story_viewers', { p_id: m[1] }))).map(function (v) { return { id: v.id, name: v.name, avatar_key: v.avatar_path, created: ms(v.created) }; }) };
  if (K === 'GET city') return { city: await q(sb.rpc('city_get', { p_user: qs.get('user') || null })) };
  if (K === 'GET city/top') return { cities: (await q(sb.rpc('city_top'))).map(function (x) { return { id: x.id, name: x.name, city_name: x.city_name, avatar_key: x.avatar_path, buildings: Number(x.buildings), minutes: Number(x.minutes) }; }) };
  if (K === 'POST city/name') return { name: await q(sb.rpc('set_city_name', { p_name: body.name })) };
  if (K === 'POST city/ruin') { await q(sb.rpc('city_ruin')); return { ok: true }; }
  if (K === 'GET verified') return { ids: await q(sb.rpc('verified_ids')) };
  if (K === 'GET study/board') { var gb = qs.get('group'); return { board: (await q(sb.rpc('study_week_board', { p_group: gb || null }))).map(function (x) { return { id: x.id, name: x.name, avatar_key: x.avatar_path, minutes: Number(x.minutes) }; }) }; }
  if (K === 'GET admin/trends') return { trends: await q(sb.rpc('admin_trends')) };
  if (K === 'POST push') {
    var ep = body.sub || {}, kk = ep.keys || {};
    await q(sb.from('push_subs').upsert({ endpoint: String(ep.endpoint || '').slice(0, 600), p256dh: String(kk.p256dh || ''), auth: String(kk.auth || '') }, { onConflict: 'endpoint' }));
    return { ok: true };
  }
  if (K === 'DELETE push') { await q(sb.from('push_subs').delete().eq('endpoint', String(body.endpoint || ''))); return { ok: true }; }
  if (R(/^POST answers\/([^/]+)\/vote$/)) return q(sb.rpc('toggle_like', { p_kind: 'answer', p_id: m[1] }));
  if (K === 'GET challenge') {
    var wk = await q(sb.rpc('current_week'));
    var ca = await q(sb.from('challenge_answers').select('text,created,user_id,profiles(name)').eq('week', wk).order('created', { ascending: false }).limit(50));
    return { text: CHALLENGES[wk % CHALLENGES.length], answers: ca.filter(function (x) { return x.profiles; }).map(function (x) {
      return { text: x.text, created: ms(x.created), uid: x.user_id, name: x.profiles.name };
    }) };
  }
  if (K === 'POST challenge') {
    id = await uid();
    var wk2 = await q(sb.rpc('current_week'));
    await q(sb.from('challenge_answers').upsert({ week: wk2, user_id: id, text: String(body.text || '').trim(), created: new Date().toISOString() }, { onConflict: 'week,user_id' }));
    return { ok: true };
  }
  if (K === 'GET leaderboard') {
    var lb = await q(sb.rpc('leaderboard'));
    return { users: lb.map(function (x) { return { id: x.id, name: x.name, avatar_key: x.avatar_path, xp: Number(x.xp), level: x.level }; }) };
  }

  /* ----- notifications ----- */
  if (K === 'GET notifications') {
    id = await uid();
    r = await Promise.all([
      q(sb.from('notifications').select('id,text,created,read').eq('user_id', id).order('created', { ascending: false }).limit(40)),
      q(sb.from('profiles').select('freeze_until').eq('id', id).single())
    ]);
    var fz = r[1].freeze_until;
    return { notifications: r[0].map(function (n) { return { id: n.id, text: n.text, created: ms(n.created), read: n.read }; }), frozen: fz && fz >= todayStr() ? fz : null };
  }
  if (K === 'POST notifications/read') {
    id = await uid();
    await q(sb.from('notifications').update({ read: true }).eq('user_id', id).eq('read', false));
    return { ok: true };
  }

  /* ----- study tools ----- */
  if (K === 'GET decks') {
    var dk = await q(sb.from('decks').select('id,name,cards(box,due)').order('created', { ascending: false }).limit(100));
    var nowT = Date.now();
    return { decks: dk.map(function (d) { return { id: d.id, name: d.name, total: d.cards.length, known: d.cards.filter(function (c) { return c.box >= 3; }).length, due: d.cards.filter(function (c) { return new Date(c.due).getTime() <= nowT; }).length }; }) };
  }
  if (K === 'POST decks') return q(sb.from('decks').insert({ name: String(body.name || '').trim() }).select('id').single());
  if (R(/^GET decks\/([^/]+)$/)) {
    r = await Promise.all([q(sb.from('decks').select('id,name').eq('id', m[1]).single()), q(sb.from('cards').select('id,q,a,box,due,interval_days,ease').eq('deck_id', m[1]).order('created', { ascending: true }).limit(500))]);
    return { deck: r[0], cards: r[1] };
  }
  if (R(/^DELETE decks\/([^/]+)$/)) { await q(sb.from('decks').delete().eq('id', m[1])); return { ok: true }; }
  if (R(/^POST decks\/([^/]+)\/cards$/)) {
    await q(sb.from('cards').insert({ deck_id: m[1], q: String(body.q || '').trim(), a: String(body.a || '').trim() }));
    return { ok: true };
  }
  if (R(/^DELETE cards\/([^/]+)$/)) { await q(sb.from('cards').delete().eq('id', m[1])); return { ok: true }; }
  if (K === 'GET cards/due') return { cards: await q(sb.rpc('cards_due', { p_limit: 50 })) };
  if (R(/^POST cards\/([^/]+)\/grade$/)) { var gi = await q(sb.rpc('card_grade', { p_card: m[1], p_grade: String(body.grade || '') })); return { interval_days: gi }; }
  if (R(/^POST cards\/([^/]+)\/review$/)) { await q(sb.rpc('review_card', { p_card: m[1], p_known: !!body.known })); return { ok: true }; }
  if (K === 'POST exams/remind') { await sb.rpc('exam_reminders'); return { ok: true }; }
  if (K === 'GET exams') return { exams: await q(sb.from('exams').select('id,name,date').order('date', { ascending: true }).limit(100)) };
  if (K === 'POST exams') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw Err(T('التاريخ مش صح'), 400);
    await q(sb.from('exams').insert({ name: String(body.name || '').trim(), date: body.date }));
    return { ok: true };
  }
  if (R(/^DELETE exams\/([^/]+)$/)) { await q(sb.from('exams').delete().eq('id', m[1])); return { ok: true }; }
  if (K === 'GET study') {
    r = await Promise.all([q(sb.rpc('study_recent')), q(sb.rpc('my_stats'))]);
    return { days: r[0], stats: r[1] };
  }
  if (K === 'POST study') {
    var stt = await q(sb.rpc('add_study', { p_minutes: Math.round(Number(body.minutes)), p_day: /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day : todayStr(), p_kind: ['house', 'villa', 'flat', 'shop', 'school', 'tower'].indexOf(body.kind) >= 0 ? body.kind : null }));
    return { stats: stt };
  }

  throw Err(T('المسار مش موجود'), 404);
}


/* ----- CAPTCHA (Cloudflare Turnstile). Off when CH_CONFIG.captchaSiteKey is empty. Tokens are single-use. ----- */
function captcha() {
  var key = C.captchaSiteKey;
  if (!key) return Promise.resolve(undefined);
  function load() {
    return new Promise(function (ok, no) {
      if (window.turnstile) return ok();
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = function () { ok(); }; s.onerror = function () { no(); };
      document.head.appendChild(s);
    });
  }
  return load().then(function () {
    return new Promise(function (ok, no) {
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset-inline:0;bottom:12px;display:flex;justify-content:center;z-index:99';
      document.body.appendChild(box);
      var id, done = false;
      function end() { done = true; try { window.turnstile.remove(id); } catch (e) { /* already gone */ } box.remove(); }
      var t = setTimeout(function () { if (!done) { end(); no(); } }, 60000);
      id = window.turnstile.render(box, {
        sitekey: key, execution: 'execute', appearance: 'interaction-only', theme: 'dark',
        callback: function (tok) { clearTimeout(t); end(); ok(tok); },
        'error-callback': function () { clearTimeout(t); end(); no(); }
      });
      window.turnstile.execute(id);
    });
  }).catch(function () { throw Err(T('مقدرناش نتأكد إنك مش روبوت. حدّث الصفحة وجرّب تاني.'), 400); });
}


/* ----- realtime: tells the app "something new arrived" so it can refresh right away. Polling stays as a safety net. ----- */
var rtCh = null;
window.CH_RT = {
  start: function (userId, onEvent, onStatus) {
    try {
      if (rtCh) { sb.removeChannel(rtCh); rtCh = null; }
      rtCh = sb.channel('nuvvo-live-' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dms' }, onEvent)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_msgs' }, onEvent)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId }, onEvent)
        .subscribe(function (st) { if (onStatus) onStatus(st === 'SUBSCRIBED'); });
    } catch (e) { if (onStatus) onStatus(false); }
  },
  stop: function () { try { if (rtCh) sb.removeChannel(rtCh); } catch (e) { /* ignore */ } rtCh = null; }
};

/* reactions: add the per-emoji counts and my own reaction to every list of posts / summaries / reels (one extra call per list; optional, never blocks) */
async function withReacts(res) {
  if (!res || typeof res !== 'object') return res;
  var sets = [['post', res.posts], ['summary', res.summaries], ['reel', res.reels]];
  await Promise.all(sets.map(async function (st) {
    var rows = st[1]; if (!Array.isArray(rows) || !rows.length) return;
    try {
      var info = await q(sb.rpc('react_info', { p_kind: st[0], p_ids: rows.slice(0, 100).map(function (x) { return x.id; }) })), by = {};
      info.forEach(function (i) { var o = by[i.target_id] || (by[i.target_id] = { reacts: {}, mine: null }); o.reacts[i.react] = Number(i.n); if (i.mine) o.mine = i.react; });
      rows.forEach(function (x) { var o = by[x.id]; x.reacts = o ? o.reacts : {}; x.mine = o ? o.mine : null; });
    } catch (e) { /* the old single-like display still works */ }
  }));
  return res;
}

window.CH_API = async function (method, path, body) {
  try { var out = await route(method, path, body); return method === 'GET' ? await withReacts(out) : out; }
  catch (e) { throw fail(e); }
};
})();
