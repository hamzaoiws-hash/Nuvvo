/* Nuvvo front end. Talks to Supabase through api.js. No build step. */
(function () {
'use strict';

/* ------------------------------------------------------------------ utils */
var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
var pad = function (n) { return String(n).padStart(2, '0'); };
var dayKey = function (ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var daysLeft = function (date) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(date + 'T00:00:00') - t) / 864e5); };
function ago(ms) {
  var m = Math.floor((Date.now() - ms) / 60000), en = window.LANG !== 'ar', ag = window.LANG === 'en' ? ' ago' : '';
  if (m < 1) return T('دلوقتي');
  if (m < 60) return en ? m + 'm' + ag : 'من ' + m + ' دقيقة';
  var h = Math.floor(m / 60);
  if (h < 24) return en ? h + 'h' + ag : 'من ' + h + ' ساعة';
  return en ? Math.floor(h / 24) + 'd' + ag : 'من ' + Math.floor(h / 24) + ' يوم';
}
function hue(id) { var h = 0; id = String(id); for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return 'hsl(' + h + ' 45% 42%)'; }
var fileUrl = function (key) { return window.CH_CONFIG.url + '/storage/v1/object/public/files/' + String(key).split('/').map(encodeURIComponent).join('/'); };
function av(u, s) {
  s = s || 36;
  return '<span class="av" style="--s:' + s + 'px;background:' + hue(u.id || u.uid || '?') + '">' +
    (u.avatar_key ? '<img alt="" src="' + esc(fileUrl(u.avatar_key)) + '">' : esc(((u.name || '?').trim()[0]) || '?')) + '</span>';
}
function rich(t) {
  return esc(t).replace(/#[\p{L}\p{N}_]+/gu, function (m) { return '<button class="tag" data-act="tag" data-k="' + m + '">' + m + '</button>'; });
}
function levelOf(xp) { return Math.floor(Math.sqrt(xp / 25)) + 1; }

/* ------------------------------------------------------------------ api */
function ApiError(message, status) { this.message = message; this.status = status; }
ApiError.prototype = Object.create(Error.prototype);

async function api(method, path, body) {
  try { return await window.CH_API(method, path, body); }
  catch (e) {
    if (e && e.status === 401 && me) { me = null; D = {}; render(); }
    throw new ApiError(T((e && e.message) || 'حصلت مشكلة، جرّب تاني'), (e && e.status) || 0);
  }
}

/* ------------------------------------------------------------------ state */
var me = null;
var D = {};
var ui = {
  tab: 'feed', feedFilter: 'rand', q: '', lib: 'sum', subj: '', year: '', sort: 'rand',
  study: 'timer', deck: null, rev: null, group: null, project: null, chatWith: null, question: null,
  prof: 'posts', modal: null, openC: {}, playing: {}, editBio: false, confirm: '', authMode: 'login', authErr: '',
  ai: { mode: 'chat', chat: [], busy: false, quiz: null, text: '', style: 'summary', out: '', files: [], draft: '', plan: { msgs: [], busy: false, schedule: null, draft: '' } }, aigen: null, pendImg: null, pendFile: null, pendVid: null, theme: null, busy: false, uploading: false, lampOn: false
};
var toastT, pollT, searchT;

// Egyptian Ministry of Education stages and the subjects taught in each (subjects are stored as plain Arabic text).
/* ---------- password strength meter ---------- */
var PW_RULES = [['٨ حروف على الأقل', function (p) { return p.length >= 8; }], ['حرف كبير (A-Z)', function (p) { return /[A-Z]/.test(p); }], ['حرف صغير (a-z)', function (p) { return /[a-z]/.test(p); }], ['رقم (0-9)', function (p) { return /[0-9]/.test(p); }], ['رمز خاص (@#$!)', function (p) { return /[^A-Za-z0-9]/.test(p); }]];
function pwPaint() {
  var els = document.querySelectorAll('.pwm'), i;
  for (i = 0; i < els.length; i++) {
    var inp = document.getElementById(els[i].dataset.pw), p = inp ? inp.value : '', ok = PW_RULES.filter(function (r) { return r[1](p); }).length, lv = !p ? '' : ok <= 2 ? 'weak' : ok <= 4 ? 'mid' : 'strong';
    els[i].innerHTML = '<div class="pwm-top"><span>' + T('قوة الباسورد') + '</span><b class="pw-' + lv + '">' + (lv === 'weak' ? T('ضعيف') : lv === 'mid' ? T('متوسط') : lv === 'strong' ? T('قوي') : '') + '</b></div>' +
      '<div class="pwm-bar" role="img" aria-label="' + esc(T('قوة الباسورد')) + '"><i class="pw-' + lv + '" style="width:' + (p ? ok * 20 : 0) + '%"></i></div>' +
      '<ul class="pwm-list">' + PW_RULES.map(function (r) { var d = r[1](p); return '<li class="' + (d ? 'ok' : '') + '"><span aria-hidden="true">' + (d ? '✓' : '○') + '</span>' + esc(T(r[0])) + '</li>'; }).join('') + '</ul>';
  }
}
document.addEventListener('input', function (e) { if (e.target.type === 'password') pwPaint(); if (e.target.id === 't-range') { var tn = document.getElementById('t-num'); if (tn) tn.value = e.target.value; } });
var VERm = {};   // user id -> true for verified businesses
function vt(uid) { return VERm[uid] ? '<span class="vt" title="' + esc(T('نشاط تجاري موثّق')) + '" aria-label="' + esc(T('نشاط تجاري موثّق')) + '">✔</span>' : ''; }
var GRADES = [['أولى ابتدائي', 'p'], ['تانية ابتدائي', 'p'], ['تالتة ابتدائي', 'p'], ['رابعة ابتدائي', 'p'], ['خامسة ابتدائي', 'p'], ['سادسة ابتدائي', 'p'],
  ['أولى إعدادي', 'm'], ['تانية إعدادي', 'm'], ['تالتة إعدادي', 'm'], ['أولى ثانوي', 's'], ['تانية ثانوي', 's'], ['تالتة ثانوي', 's'], ['جامعة', 'u']];
var STAGE_SUBJ = {
  p: ['عربي', 'رياضيات', 'علوم', 'دراسات اجتماعية', 'إنجليزي', 'دين', 'حاسب آلي', 'أخرى'],
  m: ['عربي', 'رياضيات', 'علوم', 'دراسات اجتماعية', 'إنجليزي', 'لغة ثانية', 'دين', 'حاسب آلي', 'أخرى'],
  s: ['عربي', 'إنجليزي', 'لغة ثانية', 'رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'جيولوجيا', 'تاريخ', 'جغرافيا', 'فلسفة ومنطق', 'علم نفس واجتماع', 'دين', 'أخرى'],
  u: ['رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'برمجة', 'إنجليزي', 'عربي', 'أخرى']
};
var SUBJ = [];
Object.keys(STAGE_SUBJ).forEach(function (k) { STAGE_SUBJ[k].forEach(function (s) { if (SUBJ.indexOf(s) < 0) SUBJ.push(s); }); });
var YRS = GRADES.map(function (g) { return g[0]; }).concat(['ابتدائي', 'إعدادي', 'ثانوي']);   // the last three are the old stage-only values
function stageOf(grade) { for (var i = 0; i < GRADES.length; i++) if (GRADES[i][0] === grade) return GRADES[i][1]; return ''; }
function myGrade() { var g = me && me.settings && me.settings.grade; return stageOf(g) ? g : ''; }
function subjFor(grade) { return STAGE_SUBJ[stageOf(grade)] || SUBJ; }
function gradeOpts(cur, ph) { return '<option value="">' + esc(ph) + '</option>' + GRADES.map(function (g) { return '<option value="' + esc(g[0]) + '"' + (g[0] === cur ? ' selected' : '') + '>' + esc(T(g[0])) + '</option>'; }).join(''); }
async function setGrade(g) {
  me = (await api('PATCH', '/api/me', { settings: { grade: g } })).me;
  try { localStorage.removeItem('nuvvo_grade'); } catch (e) { /* storage may be blocked */ }
  ui.year = g; ui.yearSet = true; ui.subj = ''; render(); load();
}
function gradePrompt() {
  if (myGrade()) return '';
  var pend = ''; try { pend = localStorage.getItem('nuvvo_grade') || ''; } catch (e) { /* storage may be blocked */ }
  if (stageOf(pend) && !ui.gradeBusy) { ui.gradeBusy = true; setGrade(pend).catch(function () { ui.gradeBusy = false; }); return ''; }
  return '<div class="card gprompt"><label for="gp-sel"><strong>' + T('في أنهي سنة دراسية؟') + '</strong></label><span class="meta">' + T('هنعرضلك محتوى منهج وزارة التربية والتعليم الخاص بسنتك.') + '</span><select id="gp-sel" data-set="grade">' + gradeOpts('', T('اختار سنتك')) + '</select></div>';
}
var TABS = [['feed', T('الفيد')], ['reels', T('ريلز')], ['library', T('المكتبة')], ['study', T('ذاكر')], ['groups', T('خلايا')], ['projects', T('مشاريع')], ['chat', T('الشات')], ['questions', T('أسئلة')], ['profile', T('بروفايلي')]];
var TAB_IC = {
  feed: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  reels: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M10 9l5 3-5 3z"/>',
  library: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  study: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  groups: '<path d="M12 3l7.5 4.3v8.4L12 20l-7.5-4.3V7.3z"/><circle cx="12" cy="11.5" r="2.5"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  questions: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'
};
function isDark() { return ui.theme ? ui.theme === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
var BRAND = '<img class="mk" src="logo.png" alt="" width="256" height="256"><span>Nuvvo</span>';
var IC = {
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
};

function toast(m) {
  var e = $('#toast'); if (e) e.remove();
  e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = T(m);
  document.body.appendChild(e); clearTimeout(toastT); toastT = setTimeout(function () { e.remove(); }, 3200);
}

/* ------------------------------------------------------------------ images / uploads */
function resizeImage(file, max) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
      var cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);      // transparent PNGs would turn black as JPEG
      cx.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      function done(b) {
        if (!b) return reject(new Error('x'));
        // an already-small photo is kept as it is; otherwise send the compressed copy
        resolve(s === 1 && file.size <= b.size && /^image\/(jpeg|png|webp)$/.test(file.type) ? file : b);
      }
      c.toBlob(function (w) {                                            // WebP is ~30% smaller; Safari ignores it and returns PNG
        if (w && w.type === 'image/webp') return done(w);
        c.toBlob(done, 'image/jpeg', 0.8);
      }, 'image/webp', 0.8);
    };
    im.onerror = function () { URL.revokeObjectURL(url); reject(new ApiError(T('الصورة دي مش شغالة'), 0)); };
    im.src = url;
  });
}
async function upload(kind, blob) { return api('POST', '/api/upload?kind=' + kind, blob); }

/* ------------------------------------------------------------------ levels, badges */
function badgeDefs(s) {
  return [
    [T('أول منشور'), T('انشر منشور'), s.posts >= 1], [T('صانع ملخصات'), T('ارفع ٣ ملخصات'), s.summaries >= 3],
    [T('أول إجابة'), T('جاوب على سؤال'), s.answers >= 1], [T('ساعة تركيز'), T('ذاكر ٦٠ دقيقة بالمؤقت'), s.minutes >= 60],
    [T('سلسلة ٣ أيام'), T('ذاكر ٣ أيام ورا بعض'), s.streak >= 3],
    [T('اجتماعي'), T('تابع ٣ طلاب'), s.following >= 3]
  ];
}
function levelCard() {
  var s = me.stats, lv = s.level, lo = 25 * (lv - 1) * (lv - 1), hi = 25 * lv * lv, pc = Math.round((s.xp - lo) / (hi - lo) * 100);
  return '<div class="lvl"><div class="row nw"><span class="lvl-n">' + lv + T('</span><div class="grow"><div class="name">مستوى ') + lv + ' · ' + s.xp + ' XP</div>' +
    '<div class="prog"><i style="width:' + pc + T('%"></i></div><div class="meta">باقي ') + (hi - s.xp) + T(' XP للمستوى الجاي</div></div></div><div class="badges">') +
    badgeDefs(s).map(function (b) { return '<span class="bdg' + (b[2] ? '' : ' off') + '" title="' + esc(b[1]) + '">' + esc(b[0]) + '</span>'; }).join('') + '</div></div>';
}

/* ------------------------------------------------------------------ shared view pieces */
function skeleton() {
  var card = '<div class="card sk" aria-hidden="true"><div class="row nw"><i class="sk-c"></i><div class="grow"><i class="sk-l w40"></i><i class="sk-l w25"></i></div></div><i class="sk-l"></i><i class="sk-l w80"></i><i class="sk-b"></i></div>';
  return T('<div role="status" aria-live="polite"><span class="sr">جاري التحميل…</span>') + card + card + card + '</div>';
}
function searchBar(ph) {
  return '<div class="search"><svg class="si" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="q" type="text" data-q="1" placeholder="' + esc(ph) + '" value="' + esc(ui.q) + '" style="flex:1" aria-label="' + esc(ph) + '">' +
    (ui.q ? T('<button class="sx" data-act="clearq" aria-label="مسح البحث">×</button>') : '') + '</div>';
}
function nextExam() {
  var l = (D.exams || []).filter(function (e) { return daysLeft(e.date) >= 0; });
  if (!l.length) return '';
  var ex = l[0], d = daysLeft(ex.date);
  return '<div class="exam-card' + (d <= 3 ? ' soon' : '') + '"><div class="exam-n">' + (d === 0 ? T('النهاردة') : d + T('<small>يوم</small>')) + '</div><div class="grow"><div class="name">' + esc(ex.name) +
    '</div><div class="meta">' + (d <= 3 ? T('قربت، ركّز على المراجعة') : T('امتحانك الجاي')) + T('</div></div><button class="btn sm" data-act="gostudy">ذاكر دلوقتي</button></div>');
}
function findPost(id) {
  var lists = [D.posts || [], D.pposts || []];
  for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (lists[i][j].id === id) return lists[i][j];
  return null;
}
function postHTML(p) {
  var mine = p.uid === me.id, open = ui.openC[p.id], cm = (D.cm && D.cm[p.id]) || [];
  return '<article class="card' + (p.shared ? ' shared' : '') + '">' + (p.shared ? '<span class="pill">' + T('منشور مشارك معاك') + '</span>' : '') + '<div class="row nw">' + '<button class="lnk" data-act="uopen" data-id="' + esc(p.uid) + '" aria-label="' + esc(p.name) + '">' + av({ id: p.uid, name: p.name, avatar_key: p.avatar_key }) + '</button>' +
    '<div class="grow"><div class="name"><button class="lnk" data-act="uopen" data-id="' + esc(p.uid) + '">' + esc(p.name) + '</button>' + vt(p.uid) + '</div><div class="meta">' + ago(p.created) + '</div></div>' +
    (mine ? '<button class="act" data-act="delpost" data-id="' + p.id + T('">حذف</button>')
      : '<button class="act' + (p.following ? ' on' : '') + '" data-act="follow" data-id="' + p.uid + '">' + (p.following ? T('بتتابعه') : T('متابعة')) + '</button>') + '</div>' +
    (p.text ? '<p class="post-text">' + rich(p.text) + '</p>' : '') +
    (p.img_key ? '<img class="post-img" alt="" loading="lazy" src="' + esc(fileUrl(p.img_key)) + '">' : '') +
    '<div class="acts">' + reactBtn('post', p) +
    '<button class="act" data-act="ctoggle" data-id="' + p.id + T('">تعليقات ') + (p.comments || '') + '</button>' +
    '<button class="act' + (p.saved ? ' on' : '') + '" data-act="save" data-id="' + p.id + '">' + (p.saved ? T('محفوظ') : T('حفظ')) + '</button>' +
    '<button class="act" data-act="share" data-id="' + p.id + '">' + T('مشاركة') + '</button>' +
    (D.aiOn && (p.text || '').length >= 280 ? '<button class="act" data-act="aipost" data-id="' + p.id + '">✨ ' + T('لخّص') + '</button>' : '') +
    (mine ? '' : '<button class="act" data-act="report" data-kind="post" data-id="' + p.id + T('" aria-label="بلّغ عن المنشور">بلّغ</button>')) + '</div>' +
    (D.aisum && D.aisum[p.id] ? '<div class="ai-sum"><b>✨ ' + T('ملخص بالذكاء الاصطناعي') + '</b>' + aiFmt(D.aisum[p.id]) + '<div class="meta">' + T('الإجابات ممكن تبقى غلط. راجعها مع كتابك أو مدرسك.') + '</div></div>' : '') +
    (open ? '<div class="row" style="flex-direction:column;align-items:stretch">' +
      cm.map(function (c) { return '<div class="cm"><span class="name">' + esc(c.name) + '</span><span>' + esc(c.text) + '</span></div>'; }).join('') +
      '<form class="row nw" data-form="comment" data-id="' + p.id + '"><input class="grow" id="c-' + p.id + T('" type="text" placeholder="اكتب تعليق" required maxlength="300" style="width:auto"><button class="btn sm">إرسال</button></form></div>') : '') +
    '</article>';
}

/* ------------------------------------------------------------------ views */
var LAMP = T('<svg viewBox="0 0 400 560" role="img" aria-label="مصباح شارع منوّر"><defs>') +
  '<linearGradient id="lg-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd60a" stop-opacity="0.5"/><stop offset="0.7" stop-color="#ffd60a" stop-opacity="0.14"/><stop offset="1" stop-color="#ffd60a" stop-opacity="0.04"/></linearGradient>' +
  '<radialGradient id="lg-floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd60a" stop-opacity="0.35"/><stop offset="1" stop-color="#ffd60a" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="lg-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe680" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd60a" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="lg-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a27"/><stop offset="1" stop-color="#0f0f0e"/></linearGradient></defs>' +
  '<ellipse class="lp-halo" cx="200" cy="130" rx="190" ry="120" fill="url(#lg-halo)"/>' +
  '<polygon class="lp-cone" points="132,130 268,130 396,508 4,508" fill="url(#lg-cone)"/>' +
  '<ellipse class="lp-floor" cx="200" cy="512" rx="200" ry="34" fill="url(#lg-floor)"/>' +
  '<rect x="196.5" y="130" width="7" height="382" fill="#1a1a18"/><ellipse cx="200" cy="522" rx="72" ry="10" fill="#161614"/><rect x="130" y="512" width="140" height="10" rx="5" fill="#1d1d1a"/>' +
  '<path d="M104 126 C104 72 148 48 200 48 C252 48 296 72 296 126 Z" fill="url(#lg-shade)"/><rect class="lp-bulb" x="118" y="124" width="164" height="9" rx="4.5" fill="#fff3b0"/>' +
  T('<g class="lp-cord" data-act="lamp" role="button" tabindex="0" aria-label="اسحب الخيط عشان تنوّر المصباح وتظهر خانات الدخول"><circle class="lp-ring" cx="267" cy="275" r="15" fill="none" stroke="#ffd60a" stroke-width="2"/><rect x="258" y="128" width="18" height="162" fill="transparent"/><line x1="267" y1="132" x2="267" y2="262" stroke="#2c2c28" stroke-width="3"/><rect x="259" y="262" width="16" height="26" rx="5" fill="#ffd60a"/></g></svg>');
var IC_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
var IC_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/></svg>';
var IC_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
var G_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6z"/><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.8 9.3 6 12 6z"/></svg>';
var DC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
var GH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>';

function otpLen() { return (window.CH_CONFIG && CH_CONFIG.otpLen) || 8; }
function langSelect(cls) {
  return '<select id="' + (cls ? 'lp-lang' : 'st-lang') + '"' + (cls ? ' class="' + cls + '"' : '') + ' data-set="lang" aria-label="Language">' + Object.keys(window.LANGS).map(function (k) { return '<option value="' + k + '"' + (k === window.LANG ? ' selected' : '') + '>' + esc(window.LANGS[k]) + '</option>'; }).join('') + '</select>';
}
function arNum(n) { if (window.LANG !== 'ar') return String(n); return String(n).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }); }

function verifyView() {
  var st = ui.vstate || '', boxes = '';
  for (var i = 0; i < otpLen(); i++) boxes += '<input class="otp-d" id="a-c' + i + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="' + (i ? 'off' : 'one-time-code') + T('" aria-label="الرقم ') + (i + 1) + '">';
  return '<div class="lp' + (ui.lampOn ? '' : ' lp-off') + '"><form class="lp-card vf' + (st ? ' vf-' + st : '') + '" data-form="verify" novalidate>' +
    '<div class="lp-brand">' + BRAND + '</div>' +
    T('<div class="vf-t vf-idle"><h1>أكّد الإيميل</h1><p class="lp-sub">بعتنا كود من ') + arNum(otpLen()) + T(' أرقام على <b dir="ltr">') + esc(ui.pendEmail) + '</b></p></div>' +
    T('<div class="vf-t vf-chk"><h1>بنتأكد…</h1><p class="lp-sub">بنراجع الكود بتاعك</p></div>') +
    T('<div class="vf-t vf-okt"><h1>تم التأكيد</h1><p class="lp-sub">أهلاً بيك، جاري تحويلك للموقع</p></div>') +
    '<div class="otp" dir="ltr">' + boxes + '</div>' +
    '<div class="vf-spin" aria-hidden="true"></div><div class="vf-orb" aria-hidden="true"></div>' +
    '<p class="lp-err" role="alert">' + esc(ui.authErr) + '</p>' +
    T('<button class="lp-go vf-btn" type="submit">تأكيد</button>') +
    T('<button class="lp-link vf-btn" type="button" data-act="resend">ماوصلكش؟ <b>ابعت الكود تاني</b></button>') +
    T('<button class="lp-link vf-btn" type="button" data-act="authmode">رجوع</button></form>') +
    '<div class="lp-stage">' + LAMP + T('<span class="lp-hint">اسحب الخيط عشان تنوّر</span></div></div>');
}


function recoverView() {
  var reset = ui.authMode === 'reset', boxes = '';
  if (reset) for (var i = 0; i < otpLen(); i++) boxes += '<input class="otp-d" id="a-c' + i + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="' + (i ? 'off' : 'one-time-code') + T('" aria-label="الرقم ') + (i + 1) + '">';
  return '<div class="lp' + (ui.lampOn ? '' : ' lp-off') + '"><form class="lp-card' + (reset ? ' vf' : '') + '" data-form="' + (reset ? 'reset' : 'forgot') + '" novalidate>' +
    '<div class="lp-brand">' + BRAND + '</div>' +
    (reset ? '<h1>' + T('غيّر الباسورد') + '</h1><p class="lp-sub">' + T('بعتنا كود من ') + arNum(otpLen()) + T(' أرقام على') + ' <b dir="ltr">' + esc(ui.pendEmail) + '</b></p><div class="otp" dir="ltr">' + boxes + '</div>' +
      '<div class="lp-field">' + IC_LOCK + '<input id="a-pw" type="password" placeholder="' + esc(T('الباسورد الجديد (٨ حروف على الأقل)')) + '" autocomplete="new-password" dir="auto" minlength="8" aria-label="' + esc(T('الباسورد الجديد')) + '"></div>' + '<div class="pwm" data-pw="a-pw"></div>'
      : '<h1>' + T('نسيت الباسورد؟') + '</h1><p class="lp-sub">' + T('اكتب إيميلك وهنبعتلك كود لتغيير الباسورد') + '</p><div class="lp-field">' + IC_MAIL + '<input id="a-mail" type="email" placeholder="' + esc(T('الإيميل')) + '" autocomplete="email" dir="auto" aria-label="' + esc(T('الإيميل')) + '" value="' + esc(ui.pendEmail || '') + '"></div>') +
    '<p class="lp-err" role="alert">' + esc(ui.authErr) + '</p>' +
    '<button class="lp-go" type="submit">' + (reset ? T('تغيير الباسورد') : T('ابعت الكود')) + '</button>' +
    (reset ? '<button class="lp-link" type="button" data-act="resend">' + T('ماوصلكش؟ <b>ابعت الكود تاني</b>') + '</button>' : '') +
    '<button class="lp-link" type="button" data-act="authmode">' + T('رجوع') + '</button></form>' +
    '<div class="lp-stage">' + LAMP + '<span class="lp-hint">' + T('اسحب الخيط عشان تنوّر') + '</span></div></div>';
}

function authView() {
  if (ui.authMode === 'verify') return verifyView();
  if (ui.authMode === 'forgot' || ui.authMode === 'reset') return recoverView();
  var login = ui.authMode === 'login';
  return '<div class="lp' + (ui.lampOn ? '' : ' lp-off') + '"><form class="lp-card" data-form="auth" novalidate>' +
    '<div class="lp-brand">' + BRAND + '</div>' +
    '<h1>' + (login ? T('أهلاً بعودتك') : T('اعمل حسابك')) + '</h1><p class="lp-sub">' + (login ? T('اكتب بياناتك عشان تدخل حسابك') : T('ثواني وتبقى مع زمايلك')) + '</p>' +
    (login ? '' : '<div class="lp-field">' + IC_USER + T('<input id="a-name" type="text" placeholder="اسم المستخدم" autocomplete="username" maxlength="30" aria-label="اسم المستخدم"></div>')) +
    (login ? '' : '<div class="lp-field lp-sel"><select id="a-grade" aria-label="' + esc(T('في أنهي سنة دراسية؟')) + '">' + gradeOpts('', T('في أنهي سنة دراسية؟')) + '</select></div>') +
    '<div class="lp-field">' + IC_MAIL + T('<input id="a-mail" type="email" placeholder="الإيميل" autocomplete="email" dir="auto" aria-label="الإيميل"></div>') +
    '<div class="lp-field">' + IC_LOCK + T('<input id="a-pw" type="password" placeholder="الباسورد') + (login ? '' : T(' (٨ حروف على الأقل)')) + '" autocomplete="' + (login ? 'current-password' : 'new-password') + T('" dir="auto" aria-label="الباسورد"></div>') + (login ? '' : '<div class="pwm" data-pw="a-pw"></div>') +
    '<p class="lp-err" role="alert">' + esc(ui.authErr) + '</p>' +
    '<button class="lp-go" type="submit">' + (login ? T('دخول') : T('إنشاء حساب')) + '</button>' +
    (login ? '<button class="lp-link" type="button" data-act="forgot">' + T('نسيت الباسورد؟') + '</button>' : '') +
    T('<div class="lp-or">أو كمّل بـ</div>') +
    '<div class="lp-social"><button type="button" data-act="social" data-p="google">' + G_ICON + 'Google</button><button type="button" data-act="social" data-p="github">' + GH_ICON + 'GitHub</button><button type="button" data-act="social" data-p="discord">' + DC_ICON + 'Discord</button></div>' +
    '<button class="lp-link" type="button" data-act="authmode">' + (login ? T('مفيش حساب؟ <b>اعمل واحد</b>') : T('عندك حساب؟ <b>دخول</b>')) + '</button>' +
    langSelect('lp-lang') +
    (window.LANG !== 'ar' ? '<p class="lp-legal">By signing up you agree to the <a href="terms-en.html">Terms</a> and <a href="privacy-en.html">Privacy Policy</a></p></form>' : T('<p class="lp-legal">بالتسجيل أنت موافق على <a href="terms.html">الشروط</a> و<a href="privacy.html">الخصوصية</a></p></form>')) +
    '<div class="lp-stage">' + LAMP + T('<span class="lp-hint">اسحب الخيط عشان تنوّر</span></div></div>');
}

function shell(inner) {
  return T('<a class="skip" href="#main" data-act="skip">تخطّي للمحتوى</a><div class="wrap"><div class="bar"><span class="logo">') + BRAND + T('</span><span class="hello">أهلاً ') + esc(me.name) + '</span>' +
    '<button class="tg" data-act="theme" role="switch" aria-checked="' + isDark() + T('" aria-label="الوضع الليلي"><span class="tg-knob">') + IC.moon + '</span></button>' +
    T('<button class="ib" data-act="rail" aria-label="القائمة الجانبية" aria-pressed="') + (document.documentElement.classList.contains('rail-off') ? 'true' : 'false') + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></button>' +
    T('<button class="ib" data-act="settings" aria-label="الإعدادات">') + IC.gear + '</button>' +
    T('<button class="ib" data-act="notifs" aria-label="الإشعارات">') + IC.bell + (me.unread ? '<span class="dot">' + me.unread + '</span>' : '') + '</button>' +
    T('<button class="btn ghost sm" data-act="logout">خروج</button></div>') +
    T('<nav class="tabs" aria-label="الأقسام">') + TABS.map(function (t) { return '<button class="tab" data-act="tab" data-k="' + t[0] + '" title="' + t[1] + '" aria-label="' + t[1] + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '><svg class="ti" viewBox="0 0 24 24" aria-hidden="true">' + TAB_IC[t[0]] + '</svg><span class="tl">' + t[1] + '</span></button>'; }).join('') + '</nav>' +
    '<main id="main" tabindex="-1">' + inner + '</main></div>' + (ui.modal ? modalView() : '');
}

/* ---------- AI helper (Google Gemini through the `ai` Edge Function) ---------- */
function aiAck() { try { return localStorage.getItem('nuvvo_ai_ack') === '1'; } catch (e) { return !!ui.aiAck; } }
function aiFmt(t) {
  var out = '', list = false;
  String(t || '').split('\n').forEach(function (ln) {
    var m = /^\s*[-*•]\s+(.*)$/.exec(ln), s = esc(m ? m[1] : ln).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    if (m) { if (!list) { out += '<ul>'; list = true; } out += '<li>' + s + '</li>'; }
    else { if (list) { out += '</ul>'; list = false; } if (ln.trim()) out += '<p>' + s + '</p>'; }
  });
  return out + (list ? '</ul>' : '');
}
async function aiStatus() { try { D.aiOn = !!(await api('GET', '/api/ai/status')).enabled; } catch (e) { D.aiOn = false; } }
async function aiLeft() { try { D.aiLeft = (await api('GET', '/api/ai/left')).left; } catch (e) { /* optional */ } }
async function aiInit() { if (D.aiOn == null) await aiStatus(); if (D.aiOn) await aiLeft(); }
/* attachments: photos (gallery or camera) and one PDF go to Gemini together with the question */
var AI_MAX_FILES = 3;
function aiReadFile(file) {
  return new Promise(function (resolve, reject) {
    if (file.type === 'application/pdf') {
      if (file.size > 3 * 1024 * 1024) return reject(new Error(T('الـ PDF كبير. الحد الأقصى ٣ ميجا.')));
      var fr = new FileReader(); fr.onerror = function () { reject(new Error(T('ماقدرناش نقرأ الملف.'))); };
      fr.onload = function () { resolve({ mime: 'application/pdf', data: String(fr.result).split(',')[1] || '', name: String(file.name || 'PDF').slice(0, 40) }); };
      return fr.readAsDataURL(file);
    }
    if (!/^image\//.test(file.type)) return reject(new Error(T('نوع الملف مش مدعوم. صورة أو PDF بس.')));
    var url = URL.createObjectURL(file), img = new Image();
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(T('الصورة دي مش مدعومة. جرّب صورة تانية.'))); };
    img.onload = function () {
      URL.revokeObjectURL(url);
      try {
        var out = null, tries = [[1600, 0.82], [1280, 0.7], [1000, 0.6]];
        for (var i = 0; i < tries.length; i++) {
          var sc = Math.min(1, tries[i][0] / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', tries[i][1]); if (out.length < 3500000) break;
        }
        var t = document.createElement('canvas'), ts = 72 / Math.max(img.width, img.height); t.width = Math.max(1, Math.round(img.width * ts)); t.height = Math.max(1, Math.round(img.height * ts)); t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
        resolve({ mime: 'image/jpeg', data: out.split(',')[1], name: String(file.name || 'photo').slice(0, 40), thumb: t.toDataURL('image/jpeg', 0.6) });
      } catch (e) { reject(new Error(T('الصورة دي مش مدعومة. جرّب صورة تانية.'))); }
    };
    img.src = url;
  });
}
function aiAttach() {
  var F = ui.ai.files;
  return '<div class="ai-attach">' + F.map(function (f, i) {
    return '<span class="ai-file">' + (f.thumb ? '<img src="' + esc(f.thumb) + '" alt="">' : '<b aria-hidden="true">PDF</b>') + '<small>' + esc(f.name) + '</small><button type="button" class="act" data-act="aifrm" data-k="' + i + '" aria-label="' + esc(T('شيل الملف')) + '">✕</button></span>';
  }).join('') +
    (F.length < AI_MAX_FILES ? '<button type="button" class="chip" data-act="aiattach" data-k="cam">📷 ' + T('صوّر') + '</button><button type="button" class="chip" data-act="aiattach" data-k="file">🖼️ ' + T('صورة أو PDF') + '</button>' : '') +
    '<input type="file" id="ai-cam" data-chg="aifile" accept="image/*" capture="environment" hidden><input type="file" id="ai-file" data-chg="aifile" accept="image/*,application/pdf" multiple hidden></div>' +
    (F.length ? '<p class="meta">' + T('الصور والـ PDF بتتبعت لـ Google Gemini مع سؤالك. ماترفعش حاجة فيها بيانات شخصية.') + '</p>' : '');
}
function aiFilesOut() { return ui.ai.files.map(function (f) { return { mime: f.mime, data: f.data }; }); }
function aiSaveDrafts() { var a = $('#ai-in'), b = $('#ai-plan-in'), c = $('#ai-text'); if (a) ui.ai.draft = a.value; if (b) ui.ai.plan.draft = b.value; if (c) ui.ai.text = c.value; }

function aiCall(body) { return api('POST', '/api/ai', body).then(function (r) { aiLeft().then(function () { if (ui.study === 'ai') render(); }); return r; }); }
function aiNotice() {
  return '<div class="card"><h3>✨ ' + T('مساعد الذكاء الاصطناعي') + '</h3><p>' + T('الذكاء الاصطناعي بيشتغل بـ Google Gemini. أي نص تكتبه هنا بيتبعت لـ Google عشان يتعالج، وممكن Google تستخدمه لتحسين خدماتها. ماتكتبش اسمك الكامل ولا رقم تليفونك ولا عنوانك ولا أي معلومات شخصية. والإجابات ممكن تبقى غلط، فراجعها مع كتابك أو مدرسك.') + '</p><button class="btn" data-act="aiack">' + T('فهمت، ابدأ') + '</button></div>';
}
function aiView() {
  var X = ui.ai;
  if (D.aiOn == null) return skeleton();
  if (!D.aiOn) return '<div class="card"><h3>✨ ' + T('مساعد الذكاء الاصطناعي') + '</h3><p>' + T('الميزة دي لسه مش متفعّلة. هتشتغل أول ما صاحب الموقع يفعّلها.') + '</p></div>';
  if (!aiAck()) return aiNotice();
  return '<div class="seg">' + [['chat', T('شات')], ['plan', T('جدول ذكي')], ['quiz', T('اختبار')], ['simplify', T('تلخيص وتبسيط')]].map(function (x) { return '<button data-act="aimode" data-k="' + x[0] + '" aria-pressed="' + (X.mode === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    ({ chat: aiChat, plan: aiPlan, quiz: aiQuiz, simplify: aiSimple }[X.mode])() +
    '<p class="meta">' + T('الإجابات ممكن تبقى غلط. راجعها مع كتابك أو مدرسك.') + (D.aiLeft != null ? ' · ' + arNum(D.aiLeft) + ' ' + T('طلب متبقي النهاردة') : '') + '</p>';
}
function aiChat() {
  var X = ui.ai, EX = ['اشرحلي قانون نيوتن التاني', 'إزاي أذاكر للامتحان في أسبوع؟', 'إيه الفرق بين الخلية النباتية والحيوانية؟'];
  return '<div class="card ai-chat"><div class="ai-msgs" role="log" aria-live="polite">' +
    (X.chat.length ? '' : '<p class="meta">' + T('اسألني أي سؤال في مذاكرتك وأنا أشرحلك خطوة بخطوة.') + '</p><div class="chips">' + EX.map(function (e) { return '<button class="chip" data-act="aiex" data-t="' + esc(e) + '">' + esc(T(e)) + '</button>'; }).join('') + '</div>') +
    X.chat.map(function (m) { return '<div class="ai-b ' + (m.role === 'user' ? 'me' : 'bot') + '">' + (m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') + (m.att ? '<div class="meta">📎 ' + arNum(m.att) + '</div>' : '') : aiFmt(m.text)) + '</div>'; }).join('') +
    (X.busy ? '<div class="ai-b bot typing">' + T('بيفكر…') + '</div>' : '') + '</div>' +
    aiAttach() + '<form class="row nw" data-form="aichat"><textarea id="ai-in" class="grow" rows="1" maxlength="1000" style="width:auto" aria-label="' + esc(T('اكتب سؤالك هنا')) + '" placeholder="' + esc(T('اكتب سؤالك هنا')) + '">' + esc(X.draft) + '</textarea><button class="btn"' + (X.busy ? ' disabled' : '') + '>' + T('إرسال') + '</button></form>' +
    (X.chat.length ? '<button class="link" data-act="aiclear">' + T('محادثة جديدة') + '</button>' : '') + '</div>';
}
function aiAsk(text) {
  var X = ui.ai; if (X.busy) return Promise.resolve();
  var files = aiFilesOut(), n = files.length; X.files = []; X.draft = '';
  X.chat.push({ role: 'user', text: text, att: n }); X.busy = true; render(); aiScroll();
  return aiCall({ mode: 'chat', messages: X.chat.slice(-8), files: files }).then(function (r) { X.chat.push({ role: 'ai', text: r.text }); }).catch(function (e) { X.chat.pop(); throw e; }).finally(function () { X.busy = false; render(); aiScroll(); });
}
function aiScroll() { var m = $('.ai-msgs'); if (m) m.scrollTop = m.scrollHeight; }

/* AI study timetable: the helper interviews the student (subjects, exam dates, free hours...) and then writes the timetable */
var PLAN_HELLO = 'أهلاً! هسألك كام سؤال بسيط وأعملك جدول مذاكرة على مقاسك. إيه المواد اللي هتذاكرها، وامتى امتحاناتها؟ تقدر كمان ترفع صورة أو PDF لجدول الامتحانات أو المنهج.';
function aiToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function planText(sc) {
  return (sc.title ? sc.title + '\n' : '') + sc.days.map(function (d) { return d.day + '\n' + d.items.map(function (i) { return '- ' + (i.time ? i.time + ' ' : '') + i.subject + ': ' + i.task; }).join('\n'); }).join('\n\n');
}
function aiPlanTable(sc) {
  return '<div class="card plan-out"><h3>📅 ' + esc(sc.title || T('جدول المذاكرة')) + '</h3>' + sc.days.map(function (d) {
    return '<div class="plan-day"><strong>' + esc(d.day) + '</strong><table><tbody>' + d.items.map(function (i) { return '<tr><td class="plan-t">' + esc(i.time) + '</td><td class="plan-s">' + esc(i.subject) + '</td><td>' + esc(i.task) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }).join('') + '<div class="row plan-actions"><button class="btn" data-act="aiplanprint">' + T('طباعة / حفظ PDF') + '</button><button class="btn ghost" data-act="aiplancopy">' + T('نسخ') + '</button></div></div>';
}
function aiPlan() {
  var P = ui.ai.plan, hello = T(PLAN_HELLO);
  return '<div class="card ai-chat"><div class="ai-msgs" role="log" aria-live="polite"><div class="ai-b bot">' + esc(hello) + '</div>' +
    P.msgs.map(function (m) { return '<div class="ai-b ' + (m.role === 'user' ? 'me' : 'bot') + '">' + (m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') + (m.att ? '<div class="meta">📎 ' + arNum(m.att) + '</div>' : '') : aiFmt(m.text)) + '</div>'; }).join('') +
    (P.busy ? '<div class="ai-b bot typing">' + T('بيفكر…') + '</div>' : '') + '</div>' + (P.schedule ? '' : '<p class="meta">' + T('اكتب إجابتك، ولما تبقى جاهز قول "اعمل الجدول".') + '</p>') +
    aiAttach() + '<form class="row nw" data-form="aiplan"><textarea id="ai-plan-in" class="grow" rows="1" maxlength="1000" style="width:auto" aria-label="' + esc(T('اكتب إجابتك هنا')) + '" placeholder="' + esc(P.schedule ? T('عايز تعدّل حاجة في الجدول؟') : T('اكتب إجابتك هنا')) + '">' + esc(P.draft) + '</textarea><button class="btn"' + (P.busy ? ' disabled' : '') + '>' + T('إرسال') + '</button></form>' +
    (P.msgs.length ? '<button class="link" data-act="aiplanreset">' + T('ابدأ من جديد') + '</button>' : '') + '</div>' + (P.schedule ? aiPlanTable(P.schedule) : '');
}
function aiPlanAsk(text) {
  var X = ui.ai, P = X.plan; if (P.busy) return Promise.resolve();
  var files = aiFilesOut(), n = files.length; X.files = []; P.draft = '';
  P.msgs.push({ role: 'user', text: text, att: n }); P.busy = true; render(); aiScroll();
  var hist = P.msgs.slice(-14).map(function (m) { return { role: m.role, text: m.sched ? m.text + '\n' + planText(m.sched).slice(0, 1000) : m.text }; });
  return aiCall({ mode: 'plan', today: aiToday(), messages: hist, files: files }).then(function (r) {
    P.msgs.push({ role: 'ai', text: r.reply || '', sched: r.done ? r.schedule : null });
    if (r.done) P.schedule = r.schedule;
  }).catch(function (e) { P.msgs.pop(); throw e; }).finally(function () { P.busy = false; render(); aiScroll(); });
}
function aiTextBox(ph) { return '<label class="sr" for="ai-text">' + esc(ph) + '</label><textarea id="ai-text" rows="5" maxlength="6000" placeholder="' + esc(ph) + '">' + esc(ui.ai.text) + '</textarea>'; }
function aiQuiz() {
  var Q = ui.ai.quiz;
  if (!Q) return '<form class="card" data-form="aiquiz">' + aiTextBox(T('الصق نص من الملخص أو اكتب اسم الدرس')) + aiAttach() + '<div class="row nw"><label for="ai-n">' + T('عدد الأسئلة') + '</label><select id="ai-n">' + [3, 5, 8].map(function (n) { return '<option' + (n === 5 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select><span class="grow"></span><button class="btn"' + (ui.ai.busy ? ' disabled' : '') + '>' + (ui.ai.busy ? T('جاري التوليد…') : T('ولّد الاختبار')) + '</button></div></form>';
  if (Q.i >= Q.qs.length) return '<div class="card" style="text-align:center"><h3>' + T('نتيجتك') + '</h3><p style="font-size:1.6rem"><b>' + arNum(Q.score) + ' / ' + arNum(Q.qs.length) + '</b></p><button class="btn" data-act="aiquizreset">' + T('اختبار جديد') + '</button></div>';
  var q = Q.qs[Q.i];
  return '<div class="card"><div class="meta">' + T('سؤال') + ' ' + arNum(Q.i + 1) + ' / ' + arNum(Q.qs.length) + '</div><h3>' + esc(q.q) + '</h3><div class="ai-opts">' +
    q.options.map(function (o, k) { var cls = Q.picked == null ? '' : k === q.answer ? ' ok' : k === Q.picked ? ' bad' : ''; return '<button class="ai-opt' + cls + '" data-act="aipick" data-k="' + k + '"' + (Q.picked != null ? ' disabled' : '') + '>' + esc(o) + '</button>'; }).join('') + '</div>' +
    (Q.picked != null ? '<p class="ai-why"><b>' + (Q.picked === q.answer ? T('إجابة صح') + ' ✅' : T('إجابة غلط') + ' ❌') + '</b> ' + esc(q.why) + '</p><button class="btn" data-act="aiquiznext">' + T('التالي') + '</button>' : '') + '</div>';
}
function aiSimple() {
  var X = ui.ai;
  return '<form class="card" data-form="aisimple">' + aiTextBox(T('الصق النص اللي عايز تلخّصه أو تبسّطه')) + aiAttach() + '<div class="row nw"><div class="seg"><button type="button" data-act="aistyle" data-k="summary" aria-pressed="' + (X.style === 'summary') + '">' + T('لخّص') + '</button><button type="button" data-act="aistyle" data-k="simple" aria-pressed="' + (X.style === 'simple') + '">' + T('بسّط') + '</button></div><span class="grow"></span><button class="btn"' + (X.busy ? ' disabled' : '') + '>' + (X.busy ? T('جاري التوليد…') : T('ابدأ')) + '</button></div></form>' +
    (X.out ? '<div class="card ai-sum">' + aiFmt(X.out) + '<button class="link" data-act="aicopy">' + T('نسخ') + '</button></div>' : '');
}
function aiGenPanel() {
  var G = ui.aigen; if (!G) return '';
  return '<div class="card ai-gen"><h3>✨ ' + T('ولّد بطاقات بالذكاء الاصطناعي') + '</h3>' + (G.cards
    ? '<div class="meta">' + T('راجع البطاقات قبل الحفظ. ✕ بتشيل البطاقة.') + '</div>' + G.cards.map(function (c, i) { return '<div class="row nw"><div class="grow"><div class="name">' + esc(c.q) + '</div><div class="meta">' + esc(c.a) + '</div></div><button class="act" data-act="aigdel" data-k="' + i + '" aria-label="' + esc(T('حذف')) + '">✕</button></div>'; }).join('') +
      '<div class="row"><button class="btn" data-act="aisave"' + (G.cards.length ? '' : ' disabled') + '>' + T('احفظ كل البطاقات') + '</button><button class="btn ghost" data-act="aigcancel">' + T('إلغاء') + '</button></div>'
    : '<form data-form="aigen">' + aiTextBox(T('الصق نص أو اكتب اسم الدرس وهنعملك بطاقات')) + aiAttach() + '<div class="row"><button class="btn"' + (G.busy ? ' disabled' : '') + '>' + (G.busy ? T('جاري التوليد…') : T('ولّد')) + '</button><button class="btn ghost" type="button" data-act="aigcancel">' + T('إلغاء') + '</button></div></form>') + '</div>';
}
function aiModVerdict(id) {
  var v = D.aimod && D.aimod[id]; if (!v) return '';
  return '<div class="ai-sum"><span class="pill">' + T(v.verdict === 'violation' ? 'مخالفة' : v.verdict === 'ok' ? 'سليم' : 'مش واضح') + '</span> ' + esc(v.reason) + '<div class="meta">' + T('اقتراح بس، القرار ليك.') + '</div></div>';
}
function sugCard(k) {
  var list = k === 'p' ? D.sugP : D.sugS;
  if (!list || !list.length || ui.q) return '';
  var h = '<section class="card sug" aria-label="' + esc(k === 'p' ? T('ناس ممكن تعرفهم') : T('بيشاركوا ملخصات وامتحانات سابقة')) + '"><h3>' + (k === 'p' ? T('ناس ممكن تعرفهم') : T('بيشاركوا ملخصات وامتحانات سابقة')) + '</h3><div class="sug-row">';
  list.forEach(function (u) {
    var meta = k === 'p' ? (u.mutual ? arNum(u.mutual) + ' ' + T('متابعين مشتركين') : esc(u.bio || '')) : arNum(u.sums) + ' ' + T('ملخصات') + ' · ' + arNum(u.exams) + ' ' + T('امتحانات');
    h += '<div class="sug-i"><button class="lnk" data-act="uopen" data-id="' + esc(u.id) + '" aria-label="' + esc(u.name) + '">' + av(u, 52) + '</button><div class="name">' + esc(u.name) + '</div><div class="meta">' + meta + '</div>' +
      '<button class="btn sm' + (u.following ? ' ghost' : '') + '" data-act="sfollow" data-k="' + k + '" data-id="' + esc(u.id) + '">' + (u.following ? T('بتتابعه') : T('تابع')) + '</button></div>';
  });
  return h + '</div></section>';
}
function feedList() {
  var ps = D.posts, out = [], A1 = sugCard('p'), B1 = sugCard('s');
  ps.forEach(function (p, i) { out.push(postHTML(p)); if (i === 2) out.push(A1); if (i === 6) out.push(B1); });
  if (ps.length && ps.length < 3) out.push(A1);
  if (ps.length && ps.length < 7) out.push(B1);
  return out.join('');
}
function feedView() {
  if (!D.posts) return skeleton();
  return storiesBar() + nextExam() + searchBar(T('ابحث في المنشورات أو #هاشتاج')) +
    T('<form class="card" data-form="post"><textarea id="post-text" aria-label="اكتب منشور" placeholder="إيه اللي في بالك يا ') + esc(me.name) + T('؟" maxlength="1000"></textarea>') +
    '<div id="post-prev">' + (ui.pendImg ? '<img class="post-img" alt="" src="' + esc(fileUrl(ui.pendImg)) + '" style="max-height:160px;width:auto">' : '') + '</div>' +
    '<div class="row"><label class="btn ghost sm" for="post-file">' + (ui.uploading ? T('جاري الرفع…') : T('إضافة صورة')) + '</label><input id="post-file" type="file" accept="image/*" data-file="post" hidden><span class="grow"></span><button class="btn"' + (ui.uploading ? ' disabled' : '') + T('>نشر</button></div></form>') +
    '<div class="seg"><button data-act="ffilter" data-k="all" aria-pressed="' + (ui.feedFilter === 'all') + T('">الكل</button><button data-act="ffilter" data-k="fol" aria-pressed="') + (ui.feedFilter === 'fol') + T('">اللي بتتابعهم</button><button data-act="ffilter" data-k="rand" aria-pressed="') + (ui.feedFilter === 'rand') + T('" title="ترتيب عشوائي، دوس تاني تتغيّر المنشورات">عشوائي</button></div>') +
    (D.posts.length ? feedList() : '<div class="empty card">' + (ui.q ? T('مفيش نتايج للبحث ده.') : T('مفيش منشورات هنا لسه. انشر أول منشور أو تابع طلاب من بروفايلك.')) + '</div>') +
    (D.more ? T('<button class="btn ghost" data-act="more">حمّل المزيد</button>') : '');
}

function hash32(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(a) { a = (a || []).slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
var SPK_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
var SPK_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.600-7 10-7 10z"/></svg>';

function reelSlide(r) {
  return '<section class="rl" aria-label="' + esc(r.title) + '"><video class="rl-v" src="' + esc(fileUrl(r.file_key)) + '" loop playsinline muted preload="metadata"></video>' +
    '<div class="rl-heart" aria-hidden="true">' + HEART + '</div>' +
    '<div class="rl-info"><button class="rl-who" data-act="uopen" data-id="' + esc(r.uid) + '" aria-label="' + esc(T('بروفايل ') + r.name) + '">' + av({ id: r.uid, name: r.name }, 34) + '</button><div class="rl-txt"><button class="lnk rl-name" data-act="uopen" data-id="' + esc(r.uid) + '">' + esc(r.name) + '</button>' + vt(r.uid) + '<span>' + esc(r.title) + '</span></div></div>' +
    '<div class="rl-side"><button class="rl-btn rl-like' + (r.liked ? ' on' : '') + '" data-act="rlike" data-id="' + r.id + T('" aria-label="إعجاب">') + HEART + '<span>' + (r.likes || '') + '</span></button>' +
    (r.uid === me.id ? '<button class="rl-btn" data-act="delreel" data-id="' + r.id + T('" aria-label="حذف الريل"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>') : '') + '</div>' +
    '<div class="rl-prog" aria-hidden="true"><i></i></div></section>';
}
function reelsView() {
  if (!D.reels) return skeleton();
  var muted = ui.reelMuted !== false;
  return '<div class="rl-wrap">' +
    T('<div class="rl-feed" id="rlfeed" tabindex="0" aria-label="الريلز">') + (D.reels.length ? D.reels.map(reelSlide).join('') : T('<section class="rl rl-end"><p>مفيش ريلز لسه. ارفع أول واحد!</p></section>')) + '</div>' +
    T('<button class="rl-mute" data-act="rlmute" aria-label="الصوت">') + (muted ? SPK_OFF : SPK_ON) + '</button>' +
    T('<button class="rl-add" data-act="reelup" aria-label="رفع ريل">+</button></div>');
}
var reelIO = null;
function reelObserve(sec) { if (reelIO) reelIO.observe(sec); }
function initReels() {
  if (reelIO) { reelIO.disconnect(); reelIO = null; }
  var feed = $('#rlfeed'); if (ui.tab !== 'reels' || !feed || !('IntersectionObserver' in window)) return;
  reelIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var sec = e.target;
      var v = sec.querySelector('video'); if (!v) return;
      if (e.isIntersecting) {
        v.muted = ui.reelMuted !== false; var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay refused: tap to play */ });
        var nx = sec.nextElementSibling, nv = nx && nx.querySelector('video'); if (nv) nv.preload = 'auto';   // warm up the next one
        if (!nx) reelsAppend();                                                                                 // last one reached: queue more
      } else { v.pause(); try { v.currentTime = 0; } catch (x) { /* not ready */ } }
    });
  }, { root: feed, threshold: 0.65 });
  feed.querySelectorAll('.rl').forEach(reelObserve);
}
/* endless: when the user reaches the end, add the same reels again in a new random order, right under them */
function reelsAppend() {
  var feed = $('#rlfeed'); if (!feed || !D.reels || !D.reels.length) return;
  var tmp = document.createElement('div'); tmp.innerHTML = shuffle(D.reels).map(reelSlide).join('');
  Array.prototype.slice.call(tmp.children).forEach(function (sec) { feed.appendChild(sec); reelObserve(sec); });
}
var tapT = null;
document.addEventListener('click', function (e) {
  var v = e.target.classList && e.target.classList.contains('rl-v') ? e.target : null; if (!v) return;
  if (tapT) {                                                     // second tap = like (and a heart pops up)
    clearTimeout(tapT); tapT = null;
    var sec = v.closest('.rl'), lk = sec && sec.querySelector('.rl-like'), h = sec && sec.querySelector('.rl-heart');
    if (h) { h.classList.remove('go'); void h.offsetWidth; h.classList.add('go'); }
    if (lk && !lk.classList.contains('on')) lk.click();
  } else tapT = setTimeout(function () { tapT = null; if (v.paused) v.play(); else v.pause(); }, 260);
});
document.addEventListener('timeupdate', function (e) {
  var v = e.target; if (!v.classList || !v.classList.contains('rl-v') || !v.duration) return;
  var i = v.parentNode.querySelector('.rl-prog i'); if (i) i.style.width = (v.currentTime / v.duration * 100) + '%';
}, true);

function libView() {
  var tabs = '<div class="seg">' + [['sum', T('ملخصات')], ['exam', T('امتحانات سنين سابقة')]].map(function (x) { return '<button data-act="libtab" data-k="' + x[0] + '" aria-pressed="' + (ui.lib === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
  if (!D.sums) return tabs + skeleton();
  var exm = ui.lib === 'exam', thisY = new Date().getFullYear(), eyOpts = '';
  for (var ey = thisY; ey >= 2010; ey--) eyOpts += '<option value="' + ey + '">' + ey + '</option>';
  var opt = function (arr, cur, ph) { return '<option value="">' + ph + '</option>' + arr.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(T(x)) + '</option>'; }).join(''); };
  return tabs + T('<form class="card" data-form="sum"><h3>') + (exm ? T('رفع امتحان سابق') : T('رفع ملخص')) + T('</h3><div class="field"><label for="s-title">عنوان الملخص</label><input id="s-title" type="text" required minlength="2" maxlength="100"></div>') +
    T('<div class="row"><select id="s-subj" style="flex:1" required aria-label="المادة">') + opt(subjFor(myGrade()), '', T('المادة')) + T('</select><select id="s-year" style="flex:1" aria-label="السنة الدراسية">') + opt(YRS.slice(0, GRADES.length), myGrade(), T('السنة الدراسية (اختياري)')) + '</select></div>' + (exm ? '<div class="row"><select id="s-ey" style="flex:1" required aria-label="' + esc(T('سنة الامتحان')) + '"><option value="">' + esc(T('سنة الامتحان')) + '</option>' + eyOpts + '</select></div>' : '') +
    T('<div class="row"><label class="btn ghost sm" for="s-file">اختيار ملف (PDF أو صورة)</label><input id="s-file" type="file" accept="application/pdf,image/*" data-file="sum" hidden><span class="meta">') + (ui.pendFile ? esc(ui.pendFile.name) : T('مفيش ملف متختار (حد أقصى ١٠ ميجا)')) + '</span><span class="grow"></span><button class="btn"' + (ui.uploading ? ' disabled' : '') + '>' + (ui.uploading ? T('جاري الرفع…') : T('رفع الملخص')) + '</button></div></form>' +
    searchBar(T('ابحث في الملخصات')) +
    T('<div class="row"><select id="f-subj" data-set="subj" style="flex:1" aria-label="فلتر المادة">') + opt(subjFor(ui.year || myGrade()), ui.subj, T('كل المواد')) + T('</select><select id="f-year" data-set="year" style="flex:1" aria-label="فلتر السنة">') + opt(YRS, ui.year, T('كل السنين')) + '</select>' +
    T('<select id="f-sort" data-set="sort" style="flex:1" aria-label="الترتيب"><option value="new"') + (ui.sort === 'new' ? ' selected' : '') + T('>الأحدث</option><option value="rand"') + (ui.sort === 'rand' ? ' selected' : '') + T('>عشوائي</option><option value="likes"') + (ui.sort === 'likes' ? ' selected' : '') + T('>الأكثر إعجابًا</option></select></div>') +
    (D.sums.length ? D.sums.map(function (s) { return sumCard(s); }).join('') : T('<div class="empty card">مفيش ملخصات بالفلتر ده. ارفع أول ملخص.</div>'));
}

function sumKind(s) { var ty = s.file_type || ''; return ty.indexOf('image/') === 0 ? 'img' : ty === 'application/pdf' ? 'pdf' : ''; }
function dlUrl(s) { return fileUrl(s.file_key) + '?download=' + encodeURIComponent(s.file_name || s.title || 'file'); }
// o.nolike / o.noauthor are used on the profile page, where the lists are read-only copies
function sumCard(s, o) {
  o = o || {};
  var nm = o.noauthor ? '' : '<button class="lnk" data-act="uopen" data-id="' + esc(s.uid) + '">' + esc(s.name) + '</button>' + vt(s.uid) + ' · ';
  return '<div class="card"><div class="row nw"><div class="grow"><div class="name">' + esc(s.title) + '</div><div class="meta">' + nm + ago(s.created) + '</div></div><span class="pill">' + esc(T(s.subject)) + '</span></div>' +
    '<div class="row">' + (s.exam_year ? '<span class="pill on">' + s.exam_year + '</span>' : '') + '<span class="pill">' + esc(T(s.year || 'كل المستويات')) + '</span><span class="meta">' + esc(s.file_name || '') + '</span><span class="grow"></span>' +
    (s.file_key ? (sumKind(s) ? '<button class="btn ghost sm" data-act="prevsum" data-id="' + esc(s.id) + '">' + T('معاينة') + '</button>' : '') + '<a class="btn ghost sm" style="text-decoration:none" href="' + esc(dlUrl(s)) + '" download>' + T('تنزيل') + '</a>' : '') +
    (o.nolike ? '' : reactBtn('summary', s)) +
    (s.uid === me.id && !o.nolike ? '<button class="act" data-act="delsum" data-id="' + s.id + '">' + T('حذف') + '</button>' : '') + '</div></div>';
}
// in-site preview: images directly, PDFs drawn page by page with the bundled pdf.js (nothing is sent to a third party)
function prevView() {
  var s = D.psum; if (!s) return '';
  var k = sumKind(s);
  return '<div class="row nw"><span class="meta grow">' + esc(s.file_name || '') + '</span><a class="btn sm" style="text-decoration:none" href="' + esc(dlUrl(s)) + '" download>' + T('تنزيل') + '</a></div>' +
    (k === 'img' ? '<img alt="" class="prev-img" src="' + esc(fileUrl(s.file_key)) + '">' : '<div id="pdfv" class="pdfv" aria-live="polite"><p class="meta" id="pdf-st">' + T('بيتحمّل الملف...') + '</p></div>');
}
var pdfLib = null;
async function pdfOpen(s) {
  var seq = (D.pdfSeq = (D.pdfSeq || 0) + 1), box = document.createElement('div');
  D.pdfEl = box; var pv = $('#pdfv'); if (pv) pv.appendChild(box);
  var say = function (m) { var st = $('#pdf-st'); if (st) st.textContent = m; };
  try {
    if (!pdfLib) { pdfLib = await import('./vendor/pdfjs/pdf.min.mjs'); pdfLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', location.href).href; }
    var doc = await pdfLib.getDocument({ url: fileUrl(s.file_key), isEvalSupported: false }).promise, n = Math.min(doc.numPages, 40);
    for (var i = 1; i <= n; i++) {
      if (seq !== D.pdfSeq) return;                                    // another file was opened meanwhile
      var pg = await doc.getPage(i), w = Math.min(box.parentNode ? box.parentNode.clientWidth : 360, 900) || 360, vp0 = pg.getViewport({ scale: 1 }), sc = w / vp0.width, dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = pg.getViewport({ scale: sc * dpr }), cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.style.width = Math.floor(vp.width / dpr) + 'px'; cv.className = 'pdf-pg'; cv.setAttribute('aria-label', T('صفحة ') + i);
      box.appendChild(cv); await pg.render({ canvas: cv, canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (i === 1) say('');
    }
    if (doc.numPages > n) { var more = document.createElement('p'); more.className = 'meta'; more.textContent = T('المعاينة أول ') + n + T(' صفحة. نزّل الملف عشان تشوفه كله.'); box.appendChild(more); }
  } catch (e) { say(T('مقدرناش نعرض الملف هنا. جرّب التنزيل.')); }
}

/* ----- other people's profiles ----- */
function uPostCard(p) {
  return '<article class="card"><div class="meta">' + ago(p.created) + '</div>' + (p.text ? '<p class="post-text">' + rich(p.text) + '</p>' : '') +
    (p.img_key ? '<img class="post-img" alt="" loading="lazy" src="' + esc(fileUrl(p.img_key)) + '">' : '') +
    '<div class="meta">' + T('إعجاب ') + (p.likes || 0) + ' · ' + T('تعليقات ') + (p.comments || 0) + '</div></article>';
}
function userPageView() {
  var u = D.uprof; if (!u) return skeleton();
  var tab = ui.utab || 'posts';
  return '<div class="card pf-card"><div class="banner">' + (u.banner_key ? '<img alt="" src="' + esc(fileUrl(u.banner_key)) + '">' : '') + '</div>' +
    '<div class="row nw">' + av({ id: u.id, name: u.name, avatar_key: u.avatar_key }, 56) + '<div class="grow"><div class="name" style="font-size:1.1rem">' + esc(u.name) + vt(u.id) + '</div>' + (u.bio ? '<div class="meta">' + esc(u.bio) + '</div>' : '') + '</div></div>' +
    '<div class="stats"><div><b>' + u.followers + '</b><span class="meta">' + T('متابِع') + '</span></div><div><b>' + u.following + '</b><span class="meta">' + T('بيتابع') + '</span></div><div><b>' + u.posts + '</b><span class="meta">' + T('منشور') + '</span></div><div><b>' + u.level + '</b><span class="meta">' + T('المستوى') + '</span></div></div>' +
    (u.mine ? '' : '<div class="row"><button class="btn' + (u.is_following ? ' ghost' : '') + ' sm" data-act="ufollow" data-id="' + esc(u.id) + '">' + (u.is_following ? T('بتتابعه') : T('متابعة')) + '</button>' +
      (u.city_name ? '<button class="btn ghost sm" data-act="cityvisit" data-id="' + esc(u.id) + '">' + esc(u.city_name) + '</button>' : '') +
      '<span class="grow"></span><button class="act" data-act="report" data-kind="user" data-id="' + esc(u.id) + '">' + T('بلّغ') + '</button><button class="act" data-act="ublock" data-id="' + esc(u.id) + '">' + T('حظر') + '</button></div>') + '</div>' +
    '<div class="seg"><button data-act="utab" data-k="posts" aria-pressed="' + (tab === 'posts') + '">' + T('المنشورات') + '</button><button data-act="utab" data-k="sums" aria-pressed="' + (tab === 'sums') + '">' + T('الملخصات') + ' (' + u.summaries + ')</button></div>' +
    (!u.can_view && tab === 'posts' ? '<div class="empty card">' + T('حسابه خاص. تابعه عشان تشوف منشوراته.') + '</div>'
      : tab === 'posts' ? ((D.uposts || []).length ? D.uposts.map(uPostCard).join('') : '<div class="empty card">' + T('مفيش منشورات لسه.') + '</div>')
      : ((D.usums || []).length ? D.usums.map(function (s) { return sumCard(s, { noauthor: true, nolike: true }); }).join('') : '<div class="empty card">' + T('مفيش ملخصات لسه.') + '</div>'));
}

/* ----- study: timer / cards / exams ----- */
var timer = { mode: 'focus', focus: 25, brk: 5, left: 1500, running: false, end: 0, label: '', kind: '', loaded: false };
/* the student picks the focus length (5-120 minutes) and, if they like, the building that session will grow ('' = by session length) */
var BKINDS = [['house', 'بيت', '🏠'], ['villa', 'فيلا', '🏡'], ['flat', 'عمارة', '🏢'], ['shop', 'محل', '🏪'], ['school', 'مدرسة', '🏫'], ['tower', 'برج', '🏙️']];
function timerPrefLoad() {
  if (timer.loaded || !me) return; timer.loaded = true;
  try {
    var p = JSON.parse(localStorage.getItem('nuvvo_timer_' + me.id) || '{}'), f = parseInt(p.focus, 10);
    if (!timer.running && f >= 5 && f <= 120) { timer.focus = f; if (timer.mode === 'focus') timer.left = tTotal(); }
    if (BKINDS.some(function (b) { return b[0] === p.kind; })) timer.kind = p.kind;
  } catch (e) { /* storage may be blocked */ }
}
function timerPrefSave() { try { localStorage.setItem('nuvvo_timer_' + me.id, JSON.stringify({ focus: timer.focus, kind: timer.kind })); } catch (e) { /* storage may be blocked */ } }
function timerKind() { return timer.kind || cityKind(timer.focus); }
function timerPicker() {
  var auto = cityKind(timer.focus), an = BKINDS.filter(function (b) { return b[0] === auto; })[0];
  return '<div class="t-custom"><label for="t-range"><strong>' + T('مدة التركيز') + '</strong></label><div class="row nw"><input id="t-range" data-set="tmin" type="range" min="5" max="120" step="1" value="' + timer.focus + '"' + (timer.running ? ' disabled' : '') + ' aria-label="' + esc(T('مدة التركيز بالدقايق')) + '">' +
    '<input id="t-num" data-set="tmin" type="number" min="5" max="120" step="1" inputmode="numeric" value="' + timer.focus + '"' + (timer.running ? ' disabled' : '') + ' aria-label="' + esc(T('مدة التركيز بالدقايق')) + '"><span class="meta">' + T('د') + '</span></div>' +
    '<p class="meta" style="margin:4px 0">' + T('من ٥ لـ ١٢٠ دقيقة.') + '</p></div>' +
    '<div class="t-build"><strong>' + T('المبنى اللي هيتبني') + '</strong><div class="chips" role="group" aria-label="' + esc(T('المبنى اللي هيتبني')) + '"><button type="button" class="chip" data-act="tkind" data-k="" aria-pressed="' + !timer.kind + '">✨ ' + T('حسب المدة') + '</button>' +
    BKINDS.map(function (b) { return '<button type="button" class="chip" data-act="tkind" data-k="' + b[0] + '" aria-pressed="' + (timer.kind === b[0]) + '">' + b[2] + ' ' + T(b[1]) + '</button>'; }).join('') + '</div>' +
    (timer.kind ? '' : '<p class="meta" style="margin:4px 0">' + T('حسب مدة الجلسة هيتبني:') + ' ' + (an ? an[2] + ' ' + T(an[1]) : '') + '</p>') + '</div>';
}
function tTotal() { return (timer.mode === 'focus' ? timer.focus : timer.brk) * 60; }
function fmt(sec) { return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
function tPaint() {
  var a = $('#t-time'); if (a) a.textContent = fmt(timer.left);
  var r = $('#t-ring'); if (r) r.setAttribute('stroke-dashoffset', (553 * (1 - timer.left / tTotal())).toFixed(1));
  var bc = $('#t-bc'); if (bc && timer.mode === 'focus') { var pr = Math.min(1, Math.max(0, 1 - timer.left / tTotal())); var by = +bc.dataset.y, bh = +bc.dataset.h; bc.setAttribute('y', (by + bh * (1 - pr)).toFixed(1)); bc.setAttribute('height', (bh * pr + 2).toFixed(1)); }
}
function beep() {
  try {
    var C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); o.stop(c.currentTime + 0.35);
  } catch (e) { /* sound is optional */ }
}
async function tFinish() {
  timer.running = false; beep();
  if (timer.mode === 'focus') {
    var mins = timer.focus; ui.focus = false; timer.mode = 'break'; timer.left = tTotal();
    try { await api('POST', '/api/study', { minutes: mins, day: dayKey(Date.now()), kind: timer.kind || undefined }); await refreshMe(); toast(T('جلسة تركيز خلصت، +') + mins + T(' XP. اتبنى مبنى جديد في مدينتك. خد راحة ') + timer.brk + T(' دقايق')); }
    catch (e) { toast(T('الجلسة خلصت بس مقدرناش نسجلها: ') + e.message); }
    if (ui.tab === 'study') await load(); else render();
  } else { timer.mode = 'focus'; timer.left = tTotal(); toast(T('الراحة خلصت، يلا نكمل')); render(); }
}
setInterval(function () {
  if (!timer.running) return;
  timer.left = Math.max(0, Math.round((timer.end - Date.now()) / 1000)); tPaint();
  if (timer.left <= 0) tFinish();
}, 400);

function studyView() {
  var seg = '<div class="seg wrapseg">' + [['timer', T('المؤقت')], ['plan', T('الجدول')], ['board', T('التحدي')], ['cards', T('بطاقات')], ['city', T('مدينتي')], ['ai', '✨ ' + T('مساعد')], ['calc', T('آلة حاسبة')], ['exams', T('الامتحانات')]].map(function (x) { return '<button data-act="stab" data-k="' + x[0] + '" aria-pressed="' + (ui.study === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
  return seg + ({ timer: timerView, plan: planView, board: boardView, cards: cardsView, city: cityView, ai: aiView, calc: calcView, exams: examsView }[ui.study])();
}
/* ---------- glass clock ---------- */
function clockTxt() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return { t: p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()), d: d.toLocaleDateString(window.LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
}
function clockCard() { var c = clockTxt(); return '<div class="glass-clock" role="timer" aria-label="' + esc(T('الساعة')) + '"><div class="gc-in"><div class="gc-time" id="gc-time" dir="ltr">' + c.t + '</div><div class="gc-date" id="gc-date">' + esc(c.d) + '</div></div></div>'; }
setInterval(function () { var t = $('#gc-time'); if (t) { var c = clockTxt(); t.textContent = c.t; $('#gc-date').textContent = c.d; } }, 1000);
function timerView() {
  if (!D.study) return skeleton();
  timerPrefLoad();
  var st = me.stats, td = dayKey(Date.now()), map = {}, i, days = [], max = 60, DN = [T('أحد'), T('اتنين'), T('تلات'), T('أربع'), T('خميس'), T('جمعة'), T('سبت')];
  D.study.days.forEach(function (d) { map[d.day] = d.minutes; });
  for (i = 6; i >= 0; i--) { var ms = Date.now() - i * 864e5, k = dayKey(ms); days.push({ k: k, m: map[k] || 0, d: new Date(ms).getDay() }); }
  days.forEach(function (d) { if (d.m > max) max = d.m; });
  return '<div class="card"><div class="row" style="justify-content:space-between"><strong>' + (timer.mode === 'focus' ? T('وقت التركيز') : T('وقت الراحة')) + '</strong>' +
    '<div class="seg">' + [15, 25, 45, 60].map(function (p) { return '<button data-act="tpreset" data-k="' + p + '" aria-pressed="' + (timer.focus === p) + '"' + (timer.running ? ' disabled' : '') + '>' + p + T(' د</button>'); }).join('') + '</div></div>' + timerPicker() +
    '<div class="ring-wrap"><svg class="ring" viewBox="0 0 200 200" aria-hidden="true"><circle class="rt" cx="100" cy="100" r="88"/><circle id="t-ring" class="rf" cx="100" cy="100" r="88" stroke-dasharray="553" stroke-dashoffset="' + (553 * (1 - timer.left / tTotal())).toFixed(1) + '"/></svg>' +
    buildPreview() + '<div class="ring-in"><div class="ring-t" id="t-time">' + fmt(timer.left) + '</div><div class="meta">' + (timer.mode === 'focus' ? T('ركّز') : T('ريّح دماغك')) + '</div></div></div>' +
    T('<div class="field"><label for="t-label">بتذاكر إيه؟</label><input id="t-label" type="text" maxlength="60" placeholder="مثلاً: فيزياء، الباب التالت" value="') + esc(timer.label) + '"></div>' +
    '<div class="row" style="justify-content:center"><button class="btn ghost" data-act="focus">' + (ui.focus ? T('خروج من التركيز') : T('وضع التركيز')) + '</button><button class="btn" data-act="' + (timer.running ? 'tpause' : 'tstart') + '">' + (timer.running ? T('إيقاف مؤقت') : T('ابدأ')) + T('</button><button class="btn ghost" data-act="treset">من الأول</button>') + (timer.mode === 'break' ? T('<button class="btn ghost" data-act="tskip">تخطي الراحة</button>') : '') + '</div>' +
    T('<p class="meta" style="margin:0;text-align:center">الدقايق بتتسجل بعد ما الجلسة تخلص.</p></div>') +
    clockCard() + '<div class="card"><div class="stats"><div><b>' + (map[td] || 0) + T('</b><span class="meta">دقيقة النهاردة</span></div><div><b>') + st.streak + T('</b><span class="meta">يوم ورا بعض</span></div><div><b>') + st.sessions + T('</b><span class="meta">جلسة</span></div><div><b>') + (st.minutes / 60).toFixed(1) + T('</b><span class="meta">ساعة تركيز</span></div></div>') +
    T('<div class="chart" role="img" aria-label="دقايق التركيز في آخر ٧ أيام">') + days.map(function (d) { return '<div class="bar-col' + (d.k === td ? ' today' : '') + '"><b>' + (d.m || '') + '</b><i style="height:' + Math.max(2, Math.round(d.m / max * 84)) + 'px"></i><span>' + DN[d.d] + '</span></div>'; }).join('') + '</div></div>';
}
/* ----- scientific calculator (engine in calc.js) ----- */
var calc = { expr: '', ans: null, deg: true, inv: false, hist: [], done: false };
var CALC_KEYS = [
  ['inv', 'INV'], ['deg', 'DEG'], ['(', '('], [')', ')'], ['ac', 'AC'],
  ['sin', 'sin'], ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '÷'],
  ['cos', 'cos'], ['4', '4'], ['5', '5'], ['6', '6'], ['×', '×'],
  ['tan', 'tan'], ['1', '1'], ['2', '2'], ['3', '3'], ['−', '−'],
  ['ln', 'ln'], ['0', '0'], ['.', '.'], ['Ans', 'Ans'], ['+', '+'],
  ['log', 'log'], ['sqrt', '√'], ['sq', 'x²'], ['^', 'xʸ'], ['=', '='],
  ['π', 'π'], ['e', 'e'], ['!', 'n!'], ['%', '%'], ['bs', '⌫']
];
var CALC_INV = { sin: 'sin⁻¹', cos: 'cos⁻¹', tan: 'tan⁻¹', ln: 'eˣ', log: '10ˣ', sqrt: '∛', sq: 'x³' };
function calcFmt(x) { return NuvvoCalc.fmt(x); }
function calcPreview() {
  if (!calc.expr) return '';
  try { return calcFmt(NuvvoCalc.evaluate(calc.expr, { deg: calc.deg, ans: calc.ans })); } catch (e) { return ''; }
}
function calcKeyHTML(k) {
  var label = k[1], cls = 'ck';
  if (/^[0-9.]$/.test(k[0])) cls += ' num'; else if ('÷×−+='.indexOf(k[0]) >= 0) cls += ' op'; else if (k[0] === 'ac' || k[0] === 'bs') cls += ' clr';
  if (calc.inv && CALC_INV[k[0]]) label = CALC_INV[k[0]];
  if (k[0] === 'deg') label = calc.deg ? 'DEG' : 'RAD';
  var on = k[0] === 'inv' ? ' aria-pressed="' + calc.inv + '"' : '';
  return '<button type="button" class="' + cls + (k[0] === 'inv' && calc.inv ? ' on' : '') + '" data-act="ck" data-k="' + esc(k[0]) + '"' + on + '>' + esc(label) + '</button>';
}
function calcView() {
  return '<div class="card calc" dir="ltr"><div class="calc-screen"><div class="calc-hist" id="calc-hist">' + calc.hist.slice(-3).map(function (h) { return '<div>' + esc(h) + '</div>'; }).join('') + '</div>' +
    '<div class="calc-expr" id="calc-expr" aria-live="polite">' + esc(calc.expr || '0') + '</div><div class="calc-res" id="calc-res">' + esc(calcPreview()) + '</div></div>' +
    '<div class="calc-grid">' + CALC_KEYS.map(calcKeyHTML).join('') + '</div></div>';
}
function calcKeys() { var g = $('.calc-grid'); if (g) g.innerHTML = CALC_KEYS.map(calcKeyHTML).join(''); }
function calcPaint() {
  var e = $('#calc-expr'), r = $('#calc-res'), h = $('#calc-hist');
  if (e) e.textContent = calc.expr || '0';
  if (r) r.textContent = calcPreview();
  if (h) h.innerHTML = calc.hist.slice(-3).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('');
}
function calcPress(k) {
  var last = calc.expr.slice(-1), isOpK = '÷×−+^'.indexOf(k) >= 0;
  if (k === 'inv') { calc.inv = !calc.inv; return calcKeys(); }
  if (k === 'deg') { calc.deg = !calc.deg; calcKeys(); return calcPaint(); }
  if (k === 'ac') { calc.expr = ''; calc.done = false; return calcPaint(); }
  if (k === 'bs') { calc.expr = calc.expr.replace(/(asin\(|acos\(|atan\(|sinh\(|cosh\(|tanh\(|sin\(|cos\(|tan\(|ln\(|log\(|exp\(|√\(|∛\(|Ans|.)$/, ''); calc.done = false; return calcPaint(); }
  if (k === '=') {
    if (!calc.expr) return;
    try { var v = NuvvoCalc.evaluate(calc.expr, { deg: calc.deg, ans: calc.ans }), s = calcFmt(v); calc.hist.push(calc.expr + ' = ' + s); if (calc.hist.length > 20) calc.hist.shift(); calc.ans = v; calc.expr = s; calc.done = true; }
    catch (e) { var r = $('#calc-res'); if (r) r.textContent = T('خطأ'); return; }
    return calcPaint();
  }
  var map = { sin: calc.inv ? 'asin(' : 'sin(', cos: calc.inv ? 'acos(' : 'cos(', tan: calc.inv ? 'atan(' : 'tan(', ln: calc.inv ? 'exp(' : 'ln(', log: calc.inv ? '10^(' : 'log(', sqrt: calc.inv ? '∛(' : '√(', sq: calc.inv ? '³' : '²', '!': '!', '%': '%' };
  var add = map[k] !== undefined ? map[k] : k;
  if (calc.inv && CALC_INV[k]) { calc.inv = false; calcKeys(); }
  if (calc.done) { calc.done = false; if (!isOpK && '!%²³'.indexOf(add) < 0) calc.expr = ''; }      // a number after a result starts fresh; an operator continues from it
  if (isOpK && calc.expr === '' && k !== '−') add = 'Ans' + k;
  if ('÷×+^'.indexOf(last) >= 0 && '÷×+^'.indexOf(k) >= 0) calc.expr = calc.expr.slice(0, -1);       // replace a doubled operator
  calc.expr += add; calcPaint();
}

/* ---------- city builder: every finished focus session builds a building ---------- */
function cityKind(m) { return m < 25 ? 'house' : m < 45 ? 'flat' : m < 60 ? 'shop' : 'tower'; }
/* Isometric city: every district is a 5x5 slab of grass and soil with small 3D buildings on it (houses, apartment blocks, shops,
   glass towers, rubble). Buildings are drawn as flat-shaded boxes in plain SVG: no images, no libraries. */
var ISO_N = 5, ISO_SLAB = 22;
function isoP(gx, gy, z) { return [(gx - gy) * 32, (gx + gy) * 16 - (z || 0)]; }
function isoPts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
function isoShade(hex, f) {
  var n = parseInt(hex.slice(1), 16), c = function (v) { return Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))); };
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { return ('0' + c(v).toString(16)).slice(-2); }).join('');
}
function isoPoly(pts, fill, extra) { return '<polygon points="' + isoPts(pts) + '" fill="' + fill + '" stroke="rgba(0,0,0,.14)" stroke-width=".6" stroke-linejoin="round"' + (extra || '') + '/>'; }
// a box standing on the ground cell: x0..x1 and y0..y1 are fractions of the cell, z0 is the base height, h the height
function isoBox(x0, y0, x1, y1, h, col, z0) {
  z0 = z0 || 0; var t = z0 + h;
  return isoPoly([isoP(x1, y0, z0), isoP(x1, y1, z0), isoP(x1, y1, t), isoP(x1, y0, t)], isoShade(col, 0.76)) +
    isoPoly([isoP(x0, y1, z0), isoP(x1, y1, z0), isoP(x1, y1, t), isoP(x0, y1, t)], isoShade(col, 0.92)) +
    isoPoly([isoP(x0, y0, t), isoP(x1, y0, t), isoP(x1, y1, t), isoP(x0, y1, t)], isoShade(col, 1.12));
}
// windows on the left face (plane y = y1) or the right face (plane x = x1)
function isoWins(face, x0, y0, x1, y1, z0, h, cols, rows, col, op) {
  var out = '', c, r, u0, u1, v0, v1, pt = function (u, v) { return face === 'L' ? isoP(x0 + (x1 - x0) * u, y1, z0 + h * v) : isoP(x1, y0 + (y1 - y0) * u, z0 + h * v); };
  for (c = 0; c < cols; c++) for (r = 0; r < rows; r++) {
    u0 = (c + 0.2) / cols; u1 = (c + 0.8) / cols; v0 = (r + 0.22) / rows; v1 = (r + 0.74) / rows;
    out += '<polygon points="' + isoPts([pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)]) + '" fill="' + col + '"' + (op ? ' opacity="' + op + '"' : '') + '/>';
  }
  return out;
}
function isoBands(face, x0, y0, x1, y1, z0, h, n, col, op) {   // thin horizontal window bands (glass towers)
  var out = '', r, v0, v1, pt = function (u, v) { return face === 'L' ? isoP(x0 + (x1 - x0) * u, y1, z0 + h * v) : isoP(x1, y0 + (y1 - y0) * u, z0 + h * v); };
  for (r = 0; r < n; r++) { v0 = (r + 0.3) / n; v1 = (r + 0.72) / n; out += '<polygon points="' + isoPts([pt(0.08, v0), pt(0.92, v0), pt(0.92, v1), pt(0.08, v1)]) + '" fill="' + col + '" opacity="' + op + '"/>'; }
  return out;
}
var ISO_WALL = ['#e6d2ae', '#d8a487', '#cbb68c', '#e9c9a6', '#b9c4cf'], ISO_BRICK = ['#b5533c', '#a0452f', '#c4694c', '#9c5a45'], ISO_STONE = ['#c9bba0', '#d9c9a8', '#bdb09a', '#cfc3b5'], ISO_ROOF = ['#5b4a52', '#7a3b35', '#44505e', '#6a5a48'], ISO_GLASS = ['#5aa7d6', '#4f8fc4', '#6fb7e0', '#7aa9c4'];
// a gabled house (ridge along x) on a footprint, used by the house and the villa
function isoHouse(x0, y0, x1, y1, hw, rh, wall, roof, cols) {
  var ym = (y0 + y1) / 2, dw = (x0 + x1) / 2, w = '#cfe9ff';
  return { svg: isoBox(x0, y0, x1, y1, hw, wall) + isoWins('L', x0, y0, x1, y1, 0, hw, cols, 1, w, 0.95) +
    '<polygon points="' + isoPts([isoP(dw - 0.06, y1, 0), isoP(dw + 0.06, y1, 0), isoP(dw + 0.06, y1, hw * 0.62), isoP(dw - 0.06, y1, hw * 0.62)]) + '" fill="#5a3d2b"/>' + isoWins('R', x0, y0, x1, y1, 0, hw, 1, 1, w, 0.95) +
    '<polygon points="' + isoPts([isoP(x1, y0, hw), isoP(x1, y1, hw), isoP(x1, ym, hw + rh)]) + '" fill="' + isoShade(wall, 0.76) + '" stroke="rgba(0,0,0,.14)" stroke-width=".6"/>' +
    isoPoly([isoP(x0 - 0.04, y1 + 0.05, hw - 1), isoP(x1 + 0.04, y1 + 0.05, hw - 1), isoP(x1 + 0.04, ym, hw + rh), isoP(x0 - 0.04, ym, hw + rh)], isoShade(roof, 1.05)) +
    isoPoly([isoP(x1 + 0.04, y1 + 0.05, hw - 1), isoP(x1 + 0.04, ym, hw + rh), isoP(x1 + 0.04, ym, hw + rh - 1.5), isoP(x1 + 0.04, y1 + 0.05, hw - 3)], isoShade(roof, 0.7)), h: hw + rh };
}
// -> { svg, h }  the building sits on one cell; i only picks colours and sizes
function isoBldg(kind, i) {
  var a = '', h, w = '#cfe9ff', f, k, x0, y0, x1, y1;
  if (kind === 'house') return isoHouse(0.2, 0.28, 0.8, 0.72, 16, 11, ISO_WALL[i % 5], ISO_ROOF[i % 4], 2);
  if (kind === 'villa') {
    var m = isoHouse(0.08, 0.18, 0.6, 0.82, 22, 13, ISO_WALL[(i + 1) % 5], ISO_ROOF[(i + 2) % 4], 3);
    return { svg: m.svg + isoBox(0.6, 0.38, 0.93, 0.78, 12, isoShade(ISO_WALL[(i + 1) % 5], 1.04)) + '<polygon points="' + isoPts([isoP(0.66, 0.78, 0), isoP(0.88, 0.78, 0), isoP(0.88, 0.78, 8), isoP(0.66, 0.78, 8)]) + '" fill="#6b7078"/>' + isoBox(0.58, 0.36, 0.95, 0.8, 1.6, '#8d939a', 12), h: m.h };
  }
  if (kind === 'school') {
    k = ISO_WALL[(i + 3) % 5]; x0 = 0.08; x1 = 0.92; y0 = 0.28; y1 = 0.72; h = 18;
    a += isoBox(x0, y0, x1, y1, h, '#f0d78c') + isoWins('L', x0, y0, x1, y1, 5, h - 5, 6, 1, w, 0.95) + '<polygon points="' + isoPts([isoP(0.46, y1, 0), isoP(0.54, y1, 0), isoP(0.54, y1, 9), isoP(0.46, y1, 9)]) + '" fill="#5a3d2b"/>' + isoWins('R', x0, y0, x1, y1, 3, h - 3, 1, 1, w, 0.9) +
      isoBox(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 2.4, '#c0463a', h) + isoBox(0.4, 0.38, 0.6, 0.62, 13, '#f3e1a6', h + 2.4);
    var by = h + 15.4, ap = isoP(0.5, 0.5, by + 9), fl = isoP(0.5, 0.5, by + 20), cl = isoP(0.5, 0.63, h + 10);
    a += '<polygon points="' + isoPts([isoP(0.36, 0.64, by), isoP(0.64, 0.64, by), isoP(0.5, 0.5, by + 9)]) + '" fill="#c0463a" stroke="rgba(0,0,0,.14)" stroke-width=".6"/><polygon points="' + isoPts([isoP(0.64, 0.36, by), isoP(0.64, 0.64, by), isoP(0.5, 0.5, by + 9)]) + '" fill="#9c3a30" stroke="rgba(0,0,0,.14)" stroke-width=".6"/>' +
      '<circle cx="' + cl[0].toFixed(1) + '" cy="' + cl[1].toFixed(1) + '" r="2.5" fill="#fff" stroke="#6b7078" stroke-width=".7"/><line x1="' + ap[0].toFixed(1) + '" y1="' + ap[1].toFixed(1) + '" x2="' + fl[0].toFixed(1) + '" y2="' + fl[1].toFixed(1) + '" stroke="#9aa5b1" stroke-width="1"/><polygon points="' + fl[0].toFixed(1) + ',' + fl[1].toFixed(1) + ' ' + (fl[0] + 6).toFixed(1) + ',' + (fl[1] + 2).toFixed(1) + ' ' + fl[0].toFixed(1) + ',' + (fl[1] + 4).toFixed(1) + '" fill="#e5484d"/>';
    return { svg: a, h: by + 22 };
  }
  if (kind === 'flat') {
    f = 3 + (i % 3); h = f * 11; k = i % 3 === 1 ? ISO_STONE[i % 4] : ISO_BRICK[i % 4]; x0 = 0.18; x1 = 0.82; y0 = 0.18; y1 = 0.82;
    a += isoBox(x0, y0, x1, y1, h, k) + isoWins('L', x0, y0, x1, y1, 0, h, 3, f, w, 0.92) + isoWins('R', x0, y0, x1, y1, 0, h, 3, f, w, 0.8) +
      isoBox(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 2, isoShade(k, 0.85), h) + isoBox(0.34, 0.3, 0.54, 0.5, 4, '#a3a9b0', h + 2);
    return { svg: a, h: h + 6 };
  }
  if (kind === 'shop') {
    h = 24; k = ISO_WALL[(i + 2) % 5]; x0 = 0.1; x1 = 0.9; y0 = 0.2; y1 = 0.8;
    a += isoBox(x0, y0, x1, y1, h, k) +
      '<polygon points="' + isoPts([isoP(x0 + 0.04, y1, 1), isoP(x1 - 0.04, y1, 1), isoP(x1 - 0.04, y1, 11), isoP(x0 + 0.04, y1, 11)]) + '" fill="#8fd0f2" opacity=".95"/>' +
      '<polygon points="' + isoPts([isoP(x0, y1 + 0.06, 12), isoP(x1, y1 + 0.06, 12), isoP(x1, y1, 16), isoP(x0, y1, 16)]) + '" fill="' + ['#c0392b', '#1d6fa5', '#2a9d8f'][i % 3] + '" stroke="rgba(0,0,0,.14)" stroke-width=".6"/>' +
      isoWins('L', x0, y0, x1, y1, 16, 8, 4, 1, w, 0.9) + isoWins('R', x0, y0, x1, y1, 0, h, 2, 2, w, 0.8) + isoBox(0.62, 0.3, 0.78, 0.46, 4, '#a3a9b0', h);
    return { svg: a, h: h + 4 };
  }
  if (kind === 'tower') {
    h = 60 + (i % 4) * 12; k = ISO_GLASS[i % 4]; x0 = 0.2; x1 = 0.8; y0 = 0.2; y1 = 0.8;
    a += isoBox(x0, y0, x1, y1, h, k) + isoBands('L', x0, y0, x1, y1, 0, h, Math.round(h / 8), '#ffffff', 0.3) + isoBands('R', x0, y0, x1, y1, 0, h, Math.round(h / 8), '#ffffff', 0.14);
    a += isoBox(0.3, 0.3, 0.7, 0.7, 14, isoShade(k, 0.95), h) + isoBands('L', 0.3, 0.3, 0.7, 0.7, h, 14, 2, '#ffffff', 0.3);
    var ht = h + 14; if (i % 3 === 1) { a += isoBox(0.4, 0.4, 0.6, 0.6, 9, isoShade(k, 1.05), ht); ht += 9; }
    var pt = isoP(0.5, 0.5, ht), pt2 = isoP(0.5, 0.5, ht + 18);
    a += '<line x1="' + pt[0].toFixed(1) + '" y1="' + pt[1].toFixed(1) + '" x2="' + pt2[0].toFixed(1) + '" y2="' + pt2[1].toFixed(1) + '" stroke="#9aa5b1" stroke-width="1.4"/><circle cx="' + pt2[0].toFixed(1) + '" cy="' + pt2[1].toFixed(1) + '" r="1.3" fill="#e5484d"/>';
    return { svg: a, h: ht + 20 };
  }
  if (kind !== 'ruin') return isoBldg('house', i);
  // ruin: a pile of rubble
  a += isoBox(0.2, 0.3, 0.46, 0.56, 5, '#8a8580') + isoBox(0.48, 0.2, 0.74, 0.46, 8, '#76716b') + isoBox(0.4, 0.52, 0.7, 0.8, 4, '#9a948d') + isoBox(0.28, 0.58, 0.4, 0.72, 7, '#5c5752');
  return { svg: a, h: 10 };
}
function isoTree(tx, ty, sd) {
  var p = isoP(tx, ty, 0), r = 4.6 + (sd % 3) * 0.9, c = ['#3f9b3f', '#4aa845', '#368a3b'][sd % 3];
  return '<rect x="' + (p[0] - 1).toFixed(1) + '" y="' + (p[1] - 6).toFixed(1) + '" width="2" height="6" fill="#6b4a2b"/><circle cx="' + p[0].toFixed(1) + '" cy="' + (p[1] - 10).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + c + '"/><circle cx="' + (p[0] - r * 0.35).toFixed(1) + '" cy="' + (p[1] - 12).toFixed(1) + '" r="' + (r * 0.55).toFixed(1) + '" fill="#6cc45c" opacity=".85"/>';
}
// cells fill from the middle outwards, so a young city starts in the centre and spreads
var ISO_ORDER = (function () {
  var a = [], x, y; for (x = 0; x < ISO_N; x++) for (y = 0; y < ISO_N; y++) a.push([x, y]);
  var m = (ISO_N - 1) / 2; return a.sort(function (p, q) { return (Math.pow(p[0] - m, 2) + Math.pow(p[1] - m, 2)) - (Math.pow(q[0] - m, 2) + Math.pow(q[1] - m, 2)) || (p[0] + p[1]) - (q[0] + q[1]); });
})();
function isoDistrict(kinds, base, newest) {
  var n = ISO_N, SL = ISO_SLAB, items = [], top = -40, i, c, l, cell, b, seed, s = '', corner = function (gx, gy, z) { return isoP(gx, gy, z); };
  for (l = 0; l < n * n; l++) {
    cell = ISO_ORDER[l]; seed = (base + l) * 7 + cell[0] * 3 + cell[1];
    if (l < kinds.length) {
      b = isoBldg(kinds[l], base + l); top = Math.min(top, isoP(cell[0], cell[1], 0)[1] - b.h - 6);
      items.push({ d: cell[0] + cell[1] + 0.5, x: cell[0], svg: '<g transform="translate(' + isoP(cell[0], cell[1], 0)[0].toFixed(1) + ',' + isoP(cell[0], cell[1], 0)[1].toFixed(1) + ')"' + (newest && l === kinds.length - 1 ? ' class="pop"' : '') + '>' + b.svg + (seed % 2 ? isoTree(0.9, 0.12, seed) : isoTree(0.1, 0.9, seed)) + '</g>' });
    } else {
      items.push({ d: cell[0] + cell[1] + 0.5, x: cell[0], svg: '<g transform="translate(' + isoP(cell[0], cell[1], 0)[0].toFixed(1) + ',' + isoP(cell[0], cell[1], 0)[1].toFixed(1) + ')">' + isoTree(0.35, 0.4, seed) + (seed % 3 ? isoTree(0.7, 0.65, seed + 1) : '') + '</g>' });
    }
  }
  items.sort(function (p, q) { return p.d - q.d || p.x - q.x; });
  var A = corner(0, 0, 0), B = corner(n, 0, 0), C = corner(n, n, 0), Dd = corner(0, n, 0), W = n * 32 + 18, H0 = Math.min(top, -70), H1 = n * 32 + SL + 18;
  s += '<polygon points="' + isoPts([corner(-0.3, -0.3, -SL - 9), corner(n + 0.3, -0.3, -SL - 9), corner(n + 0.3, n + 0.3, -SL - 9), corner(-0.3, n + 0.3, -SL - 9)]) + '" fill="none" stroke="rgba(0,0,0,.13)" stroke-width="1.2"/>';
  s += '<polygon points="' + isoPts([Dd, C, corner(n, n, -SL), corner(0, n, -SL)]) + '" fill="#7a4e2d"/><polygon points="' + isoPts([B, C, corner(n, n, -SL), corner(n, 0, -SL)]) + '" fill="#62401f"/>';
  for (i = 0; i < 9; i++) {   // soil spots on both sides
    c = i % 2 ? corner((i * 0.61) % n, n, -SL * (0.35 + (i % 3) * 0.2)) : corner(n, (i * 0.57) % n, -SL * (0.35 + (i % 3) * 0.2));
    s += '<ellipse cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" rx="' + (3 + (i % 3) * 1.6) + '" ry="' + (2 + (i % 2)) + '" fill="' + (i % 2 ? '#6a4125' : '#52341a') + '" opacity=".7"/>';
  }
  s += '<polygon points="' + isoPts([Dd, C, corner(n, n, -6), corner(0, n, -6)]) + '" fill="#5fa03a"/><polygon points="' + isoPts([B, C, corner(n, n, -6), corner(n, 0, -6)]) + '" fill="#4c8a2d"/>';
  s += '<polygon points="' + isoPts([A, B, C, Dd]) + '" fill="#79b94a"/>';
  var gx, gy; for (gx = 0; gx < n; gx++) for (gy = 0; gy < n; gy++) if ((gx + gy) % 2) s += '<polygon points="' + isoPts([isoP(gx, gy), isoP(gx + 1, gy), isoP(gx + 1, gy + 1), isoP(gx, gy + 1)]) + '" fill="#86c455"/>';
  s += items.map(function (it) { return it.svg; }).join('');
  return '<svg class="city-map" viewBox="' + (-W) + ' ' + H0.toFixed(0) + ' ' + (2 * W) + ' ' + (H1 - H0).toFixed(0) + '" role="img" aria-label="' + esc(T('خريطة المدينة')) + '">' + s + '</svg>';
}
// newest district first; every district holds 25 buildings
function citySVG(kinds) {
  var nd = Math.max(1, Math.ceil(kinds.length / 25)), out = '', d;
  for (d = nd - 1; d >= 0; d--) out += '<div class="city-d">' + (nd > 1 ? '<div class="meta">' + T('حي') + ' ' + arNum(d + 1) + '</div>' : '') + isoDistrict(kinds.slice(d * 25, d * 25 + 25), d * 25, d === nd - 1) + '</div>';
  return out;
}
function cityTier(m) { return m < 60 ? 'قرية' : m < 300 ? 'بلدة' : m < 1200 ? 'مدينة' : 'عاصمة'; }
// the growing building shown with the timer: it rises from the ground as the session goes on
function buildPreview() {
  var p = timer.mode === 'focus' ? Math.min(1, Math.max(0, 1 - timer.left / tTotal())) : 0, b = isoBldg(timerKind(), 0), y0 = -(b.h + 6), hh = b.h + 6 + 34;
  return '<svg class="bld-prev" viewBox="-34 ' + y0 + ' 68 ' + hh + '" aria-hidden="true"><defs><clipPath id="bcl"><rect id="t-bc" data-y="' + y0 + '" data-h="' + hh + '" x="-40" y="' + (y0 + hh * (1 - p)).toFixed(1) + '" width="80" height="' + (hh * p + 2).toFixed(1) + '"/></clipPath></defs>' +
    '<polygon points="' + isoPts([isoP(0, 0), isoP(1, 0), isoP(1, 1), isoP(0, 1)]) + '" fill="#79b94a" stroke="#5fa03a" stroke-width="1"/><g clip-path="url(#bcl)"><g transform="translate(0,0)">' + b.svg + '</g></g></svg>';
}
function cityView() {
  var c = D.city; if (!c) return skeleton();
  var nd = Math.max(1, Math.ceil(c.kinds.length / 25)), h = '';
  h += '<div class="card">' + (c.mine
    ? '<form class="row nw" data-form="cityname"><input id="c-name" type="text" required minlength="2" maxlength="30" value="' + esc(c.city_name) + '" placeholder="' + esc(T('سمّي مدينتك')) + '" aria-label="' + esc(T('اسم المدينة')) + '"><button class="btn sm" type="submit">' + T('حفظ') + '</button></form>'
    : '<div class="row nw"><button class="link" data-act="cityback">' + T('رجوع لمدينتي') + '</button><div class="grow"><h3 style="margin:0">' + esc(c.city_name || T('مدينة بدون اسم')) + '</h3><span class="meta">' + T('رئيس البلدية: ') + esc(c.owner_name) + vt(c.owner) + '</span></div></div>') +
    '<div class="stats"><div><b>' + T(cityTier(c.minutes)) + '</b><span class="meta">' + T('مستوى المدينة') + '</span></div><div><b>' + c.buildings + '</b><span class="meta">' + T('مبنى') + '</span></div><div><b>' + nd + '</b><span class="meta">' + T('حي') + '</span></div><div><b>' + fmtMin(c.minutes) + '</b><span class="meta">' + T('تركيز') + '</span></div></div></div>';
  h += c.kinds.length ? '<div class="card city-card">' + citySVG(c.kinds) + (c.ruins ? '<span class="meta">' + c.ruins + ' ' + T('أنقاض من جلسات اتقطعت') + '</span>' : '') + '</div>'
    : '<div class="empty card">' + (c.mine ? T('مدينتك فاضية. خلّص جلسة تركيز وهيتبني أول مبنى.') : T('المدينة دي لسه فاضية.')) + '</div>';
  h += '<div class="card"><strong>' + T('مدن الناس') + '</strong>' + ((D.citytop || []).length ? D.citytop.map(function (r, i) {
    return '<div class="rank' + (r.id === c.owner ? ' me' : '') + '"><span class="n">' + (i + 1) + '</span>' + av(r, 30) + '<div class="grow"><div class="name">' + esc(r.city_name) + vt(r.id) + '</div><div class="meta">' + esc(r.name) + '</div></div><span class="meta">' + r.buildings + ' ' + T('مبنى') + '</span><button class="btn ghost sm" data-act="cityvisit" data-id="' + esc(r.id) + '">' + T('زيارة') + '</button></div>';
  }).join('') : '<div class="meta">' + T('لسه محدش سمّى مدينته.') + '</div>') + '</div>';
  return h;
}
// leaving a running focus session early ruins the building
function tAbandon() {
  var spent = tTotal() - Math.max(0, Math.round((timer.end - Date.now()) / 1000));
  if (timer.mode === 'focus' && timer.running && spent >= 30) {
    if (!confirm(T('لو خرجت دلوقتي المبنى هيتهدّم. تخرج؟'))) return false;
    api('POST', '/api/city/ruin').catch(function () { /* a missing ruin is harmless */ }); toast(T('المبنى اتهدّم'));
  }
  return true;
}

/* ---------- flashcards (flip cards, Leitner boxes on the server) ---------- */
/* reactions on posts and summaries: tap = like (or remove my reaction), the face button opens the other five */
var REACTS = [['like', '👍', 'إعجاب'], ['love', '❤️', 'حب'], ['haha', '😂', 'ضحك'], ['wow', '😮', 'واو'], ['sad', '😢', 'حزين'], ['angry', '😠', 'غضب']];
function reactBtn(kind, x) {
  var mine = x.mine || (x.liked ? 'like' : null), me0 = REACTS.filter(function (r) { return r[0] === mine; })[0], isOpen = ui.rp && ui.rp.k === kind && ui.rp.id === x.id;
  var top = Object.keys(x.reacts || {}).filter(function (k) { return x.reacts[k] > 0; }).sort(function (a, b) { return x.reacts[b] - x.reacts[a]; }).slice(0, 3).map(function (k) { return (REACTS.filter(function (r) { return r[0] === k; })[0] || [0, ''])[1]; }).join('');
  return '<span class="react-wrap"><button class="act react-main' + (mine ? ' on' : '') + '" data-act="react" data-k="' + kind + '" data-id="' + x.id + '" data-r="' + (mine || 'like') + '" aria-pressed="' + !!mine + '">' +
    (me0 ? me0[1] + ' ' + T(me0[2]) : '👍 ' + T('إعجاب')) + (top ? ' <span class="react-top" aria-hidden="true">' + top + '</span>' : '') + (x.likes ? ' ' + arNum(x.likes) : '') + '</button>' +
    '<button class="act react-more" data-act="rpick" data-k="' + kind + '" data-id="' + x.id + '" aria-label="' + esc(T('كل التفاعلات')) + '" aria-expanded="' + !!isOpen + '">☺</button>' +
    (isOpen ? '<span class="react-pop" role="group" aria-label="' + esc(T('كل التفاعلات')) + '">' + REACTS.map(function (r) { return '<button class="react-opt' + (mine === r[0] ? ' on' : '') + '" data-act="react" data-k="' + kind + '" data-id="' + x.id + '" data-r="' + r[0] + '" aria-label="' + esc(T(r[2])) + '" title="' + esc(T(r[2])) + '">' + r[1] + '</button>'; }).join('') + '</span>' : '') + '</span>';
}
/* spaced repetition: the same rules as the server's card_grade(), so each button can show when the card comes back */
function srsNext(c, g) {
  var e = c.ease || 2.5, i0 = c.interval_days || 0, i;
  if (g === 'again') return 0;
  if (g === 'hard') i = i0 === 0 ? 1 : Math.max(1, Math.round(i0 * 1.2));
  else if (g === 'good') i = i0 === 0 ? 1 : Math.round(i0 * e);
  else { e = Math.min(3, e + 0.15); i = i0 === 0 ? 2 : Math.max(2, Math.round(i0 * e * 1.3)); }
  return Math.min(i, 365);
}
function srsLabel(d) { return d === 0 ? T('بعد ١٠ دقايق') : d === 1 ? T('بعد يوم') : d === 2 ? T('بعد يومين') : T('بعد') + ' ' + arNum(d) + ' ' + T('أيام'); }
function dueBanner() {
  var n = (D.decks || []).reduce(function (a, d) { return a + (d.due || 0); }, 0), tot = (D.decks || []).reduce(function (a, d) { return a + d.total; }, 0);
  if (n) return '<div class="card row nw due-card"><div class="grow"><b>' + arNum(n) + '</b> ' + T('بطاقة مستحقة للمراجعة') + '<div class="meta">' + T('راجعها دلوقتي عشان تثبت في دماغك') + '</div></div><button class="btn" data-act="duereview">' + T('راجع دلوقتي') + '</button></div>';
  return tot ? '<div class="card meta">✓ ' + T('مفيش بطاقات مستحقة دلوقتي. كمّل بكرة.') + '</div>' : '';
}
function decksView() {
  if (!D.decks) return skeleton();
  return dueBanner() + '<form class="card row nw" data-form="deck"><input id="dk-name" type="text" required minlength="2" maxlength="50" placeholder="' + esc(T('اسم المجموعة، مثلًا: قوانين الفيزياء')) + '" aria-label="' + esc(T('اسم المجموعة')) + '"><button class="btn sm" type="submit">' + T('مجموعة جديدة') + '</button></form>' +
    (D.decks.length ? D.decks.map(function (d) {
      var pc = d.total ? Math.round(d.known / d.total * 100) : 0;
      return '<div class="card"><div class="row nw"><button class="lnk grow" data-act="dkopen" data-id="' + esc(d.id) + '">' + esc(d.name) + '</button><span class="meta">' + d.total + ' ' + T('بطاقة') + '</span></div>' +
        (d.due ? '<span class="meta due-n">' + arNum(d.due) + ' ' + T('مستحقة') + '</span> ' : '') +
        '<div class="pwm-bar" role="img" aria-label="' + pc + '%"><i class="pw-strong" style="width:' + pc + '%"></i></div><span class="meta">' + d.known + ' / ' + d.total + ' ' + T('محفوظة') + '</span></div>';
    }).join('') : '<div class="empty card">' + T('مفيش مجموعات لسه. اعمل أول مجموعة وضيف فيها بطاقات.') + '</div>');
}
function deckView() {
  var X = D.deck; if (!X) return skeleton();
  return '<div class="row nw"><button class="link" data-act="dkback">' + T('رجوع للمجموعات') + '</button><span class="grow"></span><button class="act" data-act="dkdel" data-id="' + esc(X.deck.id) + '">' + T('حذف المجموعة') + '</button></div>' +
    '<div class="card"><h3>' + esc(X.deck.name) + '</h3>' + (X.cards.length ? '<button class="btn" data-act="dkreview">' + T('ابدأ المراجعة') + '</button>' : '<span class="meta">' + T('ضيف بطاقة الأول.') + '</span>') + (D.aiOn && aiAck() ? ' <button class="btn ghost" data-act="aigen">✨ ' + T('ولّد بطاقات بالذكاء الاصطناعي') + '</button>' : '') + '</div>' + aiGenPanel() +
    '<form class="card" data-form="card" data-id="' + esc(X.deck.id) + '"><label for="cd-q">' + T('السؤال (الوش الأمامي)') + '</label><textarea id="cd-q" rows="2" required maxlength="200"></textarea>' +
    '<label for="cd-a">' + T('الإجابة (الوش الخلفي)') + '</label><textarea id="cd-a" rows="2" required maxlength="300"></textarea><button class="btn sm" type="submit">' + T('إضافة بطاقة') + '</button></form>' +
    X.cards.map(function (c) { return '<div class="card"><div class="row nw"><div class="grow"><div class="name">' + esc(c.q) + '</div><div class="meta">' + esc(c.a) + '</div></div><button class="act" data-act="cdel" data-id="' + esc(c.id) + '" aria-label="' + esc(T('حذف')) + '">✕</button></div></div>'; }).join('');
}
function reviewView() {
  var R0 = ui.rev, X = D.deck; if (!R0 || (!X && !R0.due)) return skeleton();
  if (R0.i >= R0.queue.length) {
    return '<div class="card" style="text-align:center"><h3>' + T('خلّصت المراجعة') + '</h3><p>' + T('عرفت') + ' <b>' + R0.known + '</b> · ' + T('محتاج تراجع') + ' <b>' + R0.again + '</b></p>' +
      '<div class="row" style="justify-content:center">' + (R0.due ? '' : '<button class="btn" data-act="dkreview">' + T('راجع تاني') + '</button>') + '<button class="btn ghost" data-act="dkexit">' + T(R0.due ? 'رجوع للمجموعات' : 'رجوع للمجموعة') + '</button></div></div>';
  }
  var c = R0.queue[R0.i];
  return '<div class="row nw"><button class="link" data-act="dkexit">' + T('إنهاء') + '</button><span class="grow"></span><span class="meta">' + (R0.i + 1) + ' / ' + R0.queue.length + '</span></div>' +
    '<div class="pwm-bar"><i class="pw-mid" style="width:' + Math.round(R0.i / R0.queue.length * 100) + '%"></i></div>' +
    '<div class="flip" data-act="cflip" role="button" tabindex="0" aria-label="' + esc(T('اضغط لقلب البطاقة')) + '"><div class="flip-in"><div class="face front"><small>' + T('سؤال') + (c.deck_name ? ' · ' + esc(c.deck_name) : '') + '</small><p>' + esc(c.q) + '</p><em>' + T('اضغط لقلب البطاقة') + '</em></div><div class="face back"><small>' + T('الإجابة') + '</small><p>' + esc(c.a) + '</p></div></div></div>' +
    '<div class="rev-btns g4">' + [['again', 'مش عارفها', 'danger'], ['hard', 'صعبة', 'ghost'], ['good', 'كويسة', ''], ['easy', 'سهلة', '']].map(function (b, i) {
      return '<button class="btn ' + b[2] + '" data-act="cgrade" data-k="' + b[0] + '"><span>' + (i + 1) + ' · ' + T(b[1]) + '</span><small>' + srsLabel(srsNext(c, b[0])) + '</small></button>';
    }).join('') + '</div>';
}
function cardsView() { return ui.rev ? reviewView() : ui.deck ? deckView() : decksView(); }
function shuffled(arr) { var b = arr.slice(), i, j, t; for (i = b.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); t = b[i]; b[i] = b[j]; b[j] = t; } return b; }

/* ---------- stories (24 hours) ---------- */
var STORY_BG = ['linear-gradient(135deg,#ff5f8d,#f6a05a)', 'linear-gradient(135deg,#4338ca,#6d5df6)', 'linear-gradient(135deg,#0f766e,#22c1a5)', 'linear-gradient(135deg,#b91c1c,#f97316)', 'linear-gradient(135deg,#1d4ed8,#38bdf8)', 'linear-gradient(135deg,#7e22ce,#ec4899)', 'linear-gradient(135deg,#166534,#a3e635)', 'linear-gradient(135deg,#111827,#4b5563)'];
function storyGroups() {
  var by = {}, out = [];
  (D.stories || []).forEach(function (s) { if (!by[s.uid]) { by[s.uid] = { uid: s.uid, name: s.name, avatar_key: s.avatar_key, list: [] }; out.push(by[s.uid]); } by[s.uid].list.push(s); });
  out.forEach(function (g) { g.seen = g.list.every(function (s) { return s.seen; }); });
  out.sort(function (x, y) { return (x.uid === me.id ? -1 : 0) - (y.uid === me.id ? -1 : 0) || (x.seen - y.seen); });
  return out;
}
function storiesBar() {
  if (!D.stories) return '';
  var gs = storyGroups(), mine = gs.filter(function (g) { return g.uid === me.id; })[0], i;
  var h = '<div class="st-bar" role="list"><div class="st-item" role="listitem"><button class="st-ring' + (mine ? '' : ' none') + '" data-act="' + (mine ? 'stopen' : 'stnew') + '" data-u="' + esc(me.id) + '" aria-label="' + esc(T('قصتك')) + '">' + av(me, 54) + '</button><button class="st-plus" data-act="stnew" aria-label="' + esc(T('إضافة قصة')) + '">+</button><span>' + T('قصتك') + '</span></div>';
  for (i = 0; i < gs.length; i++) if (gs[i].uid !== me.id) h += '<div class="st-item" role="listitem"><button class="st-ring' + (gs[i].seen ? ' seen' : '') + '" data-act="stopen" data-u="' + esc(gs[i].uid) + '" aria-label="' + esc(T('قصة ') + gs[i].name) + '">' + av(gs[i], 54) + '</button><span>' + esc(gs[i].name) + '</span></div>';
  return h + '</div>';
}
var stT = null, stStart = 0, stLeft = 5000, stHeld = false, stDown = 0;
function stSchedule(ms) { clearTimeout(stT); stStart = Date.now() - (5000 - ms); stLeft = ms; stT = setTimeout(function () { A.stnext(); }, ms); }
function stStop() { clearTimeout(stT); stT = null; }
function storyView() {
  var S0 = ui.sv; if (!S0) return '';
  var g = S0.groups[S0.g], s = g && g.list[S0.i]; if (!s) return '';
  var own = s.uid === me.id, body = s.kind === 'img'
    ? '<div class="st-media"><img alt="" src="' + esc(fileUrl(s.img_key)) + '">' + (s.text ? '<div class="st-cap">' + esc(s.text) + '</div>' : '') + '</div>'
    : '<div class="st-media st-text" style="background:' + STORY_BG[s.bg % 8] + '"><p>' + esc(s.text) + '</p></div>';
  return '<div class="st-view" role="dialog" aria-modal="true" aria-label="' + esc(T('القصص')) + '">' + body +
    '<div class="st-top"><div class="st-prog">' + g.list.map(function (x, k) { return '<i class="' + (k < S0.i ? 'done' : k === S0.i ? 'cur' : '') + '"></i>'; }).join('') + '</div>' +
    '<div class="row nw st-who">' + av(g, 34) + '<b class="grow">' + esc(g.name) + '</b><span class="meta">' + ago(s.created) + '</span>' + (own ? '<button class="st-x" data-act="stdel" data-id="' + esc(s.id) + '" aria-label="' + esc(T('حذف')) + '">' + '🗑' + '</button>' : '') + '<button class="st-x" data-act="stclose" aria-label="' + esc(T('إغلاق')) + '">✕</button></div></div>' +
    '<button class="st-zone prev" data-act="stprev" aria-label="' + esc(T('السابق')) + '"></button><button class="st-zone next" data-act="stnext" aria-label="' + esc(T('التالي')) + '"></button>' +
    (own ? '<div class="st-foot"><button class="btn ghost sm" data-act="stviews" data-id="' + esc(s.id) + '">' + s.views + ' ' + T('مشاهدة') + '</button></div>' : '') +
    (S0.viewers ? '<div class="st-sheet"><div class="row nw"><b class="grow">' + T('شاف قصتك') + '</b><button class="st-x" data-act="stviewsx" aria-label="' + esc(T('إغلاق')) + '">✕</button></div>' + (S0.viewers.length ? S0.viewers.map(function (v) { return '<div class="row nw">' + av(v, 30) + '<span class="grow">' + esc(v.name) + '</span><span class="meta">' + ago(v.created) + '</span></div>'; }).join('') : '<div class="meta">' + T('لسه محدش شاف القصة.') + '</div>') + '</div>' : '') + '</div>';
}
function storyShown() {
  var S0 = ui.sv; if (!S0) return;
  var s = S0.groups[S0.g].list[S0.i];
  if (!s.seen && s.uid !== me.id) { s.seen = true; api('POST', '/api/stories/' + s.id + '/view').catch(function () { /* a missed view is harmless */ }); }
  S0.viewers = null; stHeld = false; if (S0.paused) return; stSchedule(5000);
}
function stComposer() {
  var kind = ui.stKind || 'text', bg = ui.stBg || 0;
  return '<form data-form="story">' +
    '<div class="seg"><button type="button" data-act="stkind" data-k="text" aria-pressed="' + (kind === 'text') + '">' + T('نص') + '</button><button type="button" data-act="stkind" data-k="img" aria-pressed="' + (kind === 'img') + '">' + T('صورة') + '</button></div>' +
    (kind === 'text'
      ? '<div class="st-prev" style="background:' + STORY_BG[bg] + '"><textarea id="st-text" maxlength="200" rows="4" placeholder="' + esc(T('اكتب حاجة…')) + '" aria-label="' + esc(T('نص القصة')) + '"></textarea></div><div class="swatches">' + STORY_BG.map(function (b, i) { return '<button type="button" class="sw' + (i === bg ? ' on' : '') + '" style="background:' + b + '" data-act="stbg" data-k="' + i + '" aria-label="' + (i + 1) + '"></button>'; }).join('') + '</div>'
      : '<div class="st-prev img">' + (ui.stImg ? '<img alt="" src="' + esc(fileUrl(ui.stImg)) + '">' : '<span class="meta">' + T('اختار صورة للقصة') + '</span>') + '</div><div class="row"><label class="btn ghost sm" for="st-file">' + (ui.uploading ? T('جاري الرفع…') : T('اختار صورة')) + '</label><input id="st-file" type="file" accept="image/jpeg,image/png,image/webp" data-file="story" hidden></div><input id="st-text" type="text" maxlength="200" placeholder="' + esc(T('تعليق (اختياري)')) + '">') +
    '<button class="btn" type="submit"' + (kind === 'img' && !ui.stImg ? ' disabled' : '') + '>' + T('انشر القصة (٢٤ ساعة)') + '</button></form>';
}

/* ---------- study plan (kept on this device) and the weekly study board ---------- */
function planGet() {
  var p = {}; try { p = JSON.parse(localStorage.getItem('nuvvo_plan_' + me.id) || '{}'); } catch (e) { p = {}; }
  p.subs = p.subs || []; p.mins = p.mins || 90; p.done = p.done || {};
  return p;
}
function planSave(p) { try { localStorage.setItem('nuvvo_plan_' + me.id, JSON.stringify(p)); } catch (e) { /* storage may be blocked */ } }
function planSubjects() { return subjFor(myGrade()).filter(function (s) { return s !== 'أخرى'; }); }
// 7 days; each day gets mins/30 slots. A subject scores higher the longer since its last slot and the closer an exam that mentions it.
function buildPlan(p) {
  var subs = p.subs.length ? p.subs : planSubjects(), slots = Math.max(1, Math.round(p.mins / 30)), last = {}, out = [], i, ex = D.exams || [];
  subs.forEach(function (s) { last[s] = -3; });
  for (i = 0; i < 7; i++) {
    var ms = Date.now() + i * 864e5, key = dayKey(ms), sc = subs.map(function (s) {
      var v = (i - last[s]) * 0.6, hint = '';
      ex.forEach(function (e) { var dl = daysLeft(e.date); if (dl >= i && String(e.name).indexOf(s) >= 0) { v += Math.max(0, 8 - (dl - i)) * 1.2; hint = e.name; } });
      return { s: s, v: v, hint: hint };
    }).sort(function (x, y) { return y.v - x.v; }).slice(0, Math.min(slots, subs.length));
    sc.forEach(function (x) { last[x.s] = i; });
    out.push({ key: key, ms: ms, items: sc });
  }
  return out;
}
function planView() {
  if (!D.exams) return skeleton();
  var p = planGet(), all = planSubjects(), plan = buildPlan(p), total = 0, done = 0, DN = [T('الأحد'), T('الاتنين'), T('التلات'), T('الأربع'), T('الخميس'), T('الجمعة'), T('السبت')];
  plan.forEach(function (d) { d.items.forEach(function (x) { total++; if (p.done[d.key + '|' + x.s]) done++; }); });
  return '<div class="card"><h3>' + T('جدول المذاكرة') + '</h3><span class="meta">' + T('بيتبني من مواد سنتك وامتحاناتك اللي ضفتها. لو اسم الامتحان فيه اسم المادة، المادة دي بتتقدّم قبل الامتحان.') + '</span>' +
    '<div class="field"><label for="pl-mins">' + T('وقت المذاكرة في اليوم') + '</label><select id="pl-mins" data-set="plmins">' + [30, 60, 90, 120, 180, 240].map(function (m) { return '<option value="' + m + '"' + (p.mins === m ? ' selected' : '') + '>' + (m >= 60 ? m / 60 + (window.LANG !== 'ar' ? ' h' : ' ساعة') : m + (window.LANG !== 'ar' ? ' min' : ' دقيقة')) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>' + T('المواد (سيبها فاضية لو عايز كلها)') + '</label><div class="chips">' + all.map(function (s) { return '<button type="button" class="chip' + (p.subs.indexOf(s) >= 0 ? ' on' : '') + '" data-act="plsub" data-s="' + esc(s) + '" aria-pressed="' + (p.subs.indexOf(s) >= 0) + '">' + esc(T(s)) + '</button>'; }).join('') + '</div></div>' +
    '<div class="meta">' + T('اتخلّص') + ' ' + done + ' / ' + total + '</div></div>' +
    plan.map(function (d, i) {
      var dt = new Date(d.ms);
      return '<div class="card"><strong>' + (i === 0 ? T('النهاردة') : DN[dt.getDay()]) + ' <span class="meta">' + dt.getDate() + '/' + (dt.getMonth() + 1) + '</span></strong>' + d.items.map(function (x) {
        var k = d.key + '|' + x.s, on = !!p.done[k];
        return '<label class="chk plan-it' + (on ? ' done' : '') + '"><input type="checkbox" data-act="pldone" data-k="' + esc(k) + '"' + (on ? ' checked' : '') + '><span>' + esc(T(x.s)) + '</span>' + (x.hint ? ' <span class="pill">' + esc(x.hint) + '</span>' : '') + '</label>';
      }).join('') + '</div>';
    }).join('');
}
function fmtMin(m) { return m >= 60 ? Math.floor(m / 60) + T(' س ') + (m % 60 ? m % 60 + T(' د') : '') : m + T(' د'); }
function boardView() {
  if (!D.board) return skeleton();
  var mine = (D.groups || []).filter(function (g) { return g.mine; });
  return '<div class="card"><h3>' + T('تحدي المذاكرة الأسبوعي') + '</h3><span class="meta">' + T('مين ذاكر أكتر في آخر ٧ أيام. الدقايق بتتحسب من المؤقت.') + '</span>' +
    '<select data-set="bgroup" aria-label="' + esc(T('ترتيب')) + '"><option value="">' + T('كل الطلاب') + '</option>' + mine.map(function (g) { return '<option value="' + esc(g.id) + '"' + (ui.bgroup === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select></div>' +
    (D.board.length ? '<div class="card">' + D.board.map(function (r, i) {
      return '<div class="rank' + (r.id === me.id ? ' me' : '') + '"><span class="n">' + (i + 1) + '</span>' + av(r, 30) + '<button class="grow name lnk" data-act="cityvisit" data-id="' + esc(r.id) + '">' + esc(r.name) + vt(r.id) + '</button><span class="meta">' + fmtMin(r.minutes) + '</span></div>';
    }).join('') + '</div>' : '<div class="empty card">' + T('لسه محدش ذاكر الأسبوع ده. ابدأ المؤقت وكون أول واحد!') + '</div>') ;
}

function examsView() {

  if (!D.exams) return skeleton();
  return T('<form class="card" data-form="exam"><h3>ضيف امتحان</h3><div class="row"><input id="ex-name" class="grow" type="text" placeholder="اسم الامتحان" required minlength="2" maxlength="60" style="width:auto"><input id="ex-date" type="date" required style="width:auto" aria-label="تاريخ الامتحان"><button class="btn">إضافة</button></div></form>') +
    (D.exams.length ? D.exams.map(function (e) {
      var d = daysLeft(e.date), past = d < 0;
      return '<div class="exam-card' + (!past && d <= 3 ? ' soon' : '') + '" style="' + (past ? 'opacity:.55' : '') + '"><div class="exam-n">' + (past ? T('عدّى') : (d === 0 ? T('النهاردة') : d + T('<small>يوم</small>'))) + '</div><div class="grow"><div class="name">' + esc(e.name) + '</div><div class="meta">' + esc(e.date) + '</div></div><button class="act" data-act="exdel" data-id="' + e.id + T('">حذف</button></div>');
    }).join('') : T('<div class="empty card">مفيش امتحانات متسجلة. ضيف أول امتحان عشان العد التنازلي يظهر في الفيد.</div>'));
}

function groupsView() {
  if (ui.group) {
    if (!D.gmsgs) return skeleton();
    var g = D.gmsgs.group, ms = D.gmsgs.messages;
    return T('<button class="link" data-act="gback">رجوع للخلايا</button>') + (g.code ? T('<div class="card"><div class="meta">كود الدعوة (ابعته لزمايلك عشان ينضموا):</div><div class="row nw"><b class="grow" dir="ltr" style="letter-spacing:.12em;font-size:1.2rem" id="gcode">') + esc(g.code) + '</b><button class="btn ghost sm" data-act="copycode" data-v="' + esc(g.code) + T('">نسخ</button></div></div>') : '') + '<div class="card"><div class="row"><h2 class="grow">' + esc(g.name) + '</h2><span class="pill">' + g.members + T(' أعضاء</span>') + '<button class="ib" data-act="gset" data-id="' + g.id + '" aria-label="' + esc(T('إعدادات الخلية')) + '">' + IC.gear + '</button><button class="btn ghost sm" data-act="gjoin" data-id="' + g.id + '">' + (g.mine ? T('خروج من الخلية') : T('انضمام')) + '</button></div>' +
      '<div id="thread"' + chatAttrs() + ' aria-live="polite">' + (ms.map(function (m) { return '<div class="bubble' + (m.uid === me.id ? ' me' : '') + '"><div class="meta" style="color:inherit;opacity:.75">' + esc(m.name) + '</div>' + esc(m.text) + '</div>'; }).join('') || T('<div class="empty">ابدأ المحادثة</div>')) + '</div>' +
      (g.mine ? '<form class="row nw" data-form="gmsg" data-id="' + g.id + T('"><input class="grow" id="gm" type="text" placeholder="اكتب رسالة" required maxlength="500" style="width:auto"><button class="btn">إرسال</button></form>') : T('<div class="meta">انضم عشان تبعت رسائل</div>')) + '</div>';
  }
  if (!D.groups) return skeleton();
  return T('<form class="card" data-form="gcode"><h3>انضم بكود دعوة</h3><div class="row nw"><input class="grow" id="g-code" type="text" dir="ltr" placeholder="الكود" required minlength="6" maxlength="20" autocomplete="off" autocapitalize="none" style="width:auto"><button class="btn">انضمام</button></div></form>') +
    T('<form class="card" data-form="group"><h3>إنشاء خلية</h3><div class="row nw"><input class="grow" id="g-name" type="text" placeholder="اسم الخلية" required minlength="2" maxlength="50" style="width:auto"><button class="btn">إنشاء</button></div></form>') +
    (D.groups.length ? D.groups.map(function (g) { return '<button class="list-btn" data-act="gopen" data-id="' + g.id + '"><div class="grow"><div class="name">' + esc(g.name) + '</div><div class="meta">' + g.members + T(' أعضاء') + (g.mine ? T(' · انت عضو') : '') + '</div></div></button>'; }).join('')
      : T('<div class="empty card">مفيش خلايا لسه. اعمل خلية جديدة، أو اكتب كود دعوة من زميلك.</div>'));
}

function projView() {
  if (ui.project) {
    if (!D.proj) return skeleton();
    var p = D.proj.project, ts = D.proj.tasks, d = ts.filter(function (k) { return k.done; }).length, pc = ts.length ? Math.round(d / ts.length * 100) : 0;
    return T('<button class="link" data-act="pback">رجوع للمشاريع</button><div class="card"><div class="row"><h2 class="grow">') + esc(p.name) + '</h2><span class="pill">' + d + ' / ' + ts.length + '</span>' +
      '<button class="btn ghost sm" data-act="pjoin" data-id="' + p.id + '">' + (p.mine ? T('مغادرة') : T('انضمام')) + '</button>' + (p.owner === me.id ? '<button class="act" data-act="pdel" data-id="' + p.id + T('">حذف المشروع</button>') : '') + '</div><div class="prog"><i style="width:' + pc + '%"></i></div><div class="meta">' + p.members + T(' أعضاء</div>') +
      (ts.map(function (k) { return '<div class="task' + (k.done ? ' done' : '') + '"><input type="checkbox" id="k-' + k.id + '" data-act="ktoggle" data-id="' + k.id + '"' + (k.done ? ' checked' : '') + (p.mine ? '' : ' disabled') + '><label class="grow" for="k-' + k.id + '"><span>' + esc(k.text) + '</span></label>' + (p.mine ? '<button class="act" data-act="kdel" data-id="' + k.id + T('">حذف</button>') : '') + '</div>'; }).join('') || T('<div class="empty">مفيش مهام لسه</div>')) +
      (p.mine ? '<form class="row nw" data-form="task" data-id="' + p.id + T('"><input class="grow" id="k-new" type="text" placeholder="مهمة جديدة" required maxlength="120" style="width:auto"><button class="btn">إضافة مهمة</button></form>') : T('<div class="meta">انضم للمشروع عشان تضيف مهام</div>')) + '</div>';
  }
  if (!D.projects) return skeleton();
  return T('<form class="card" data-form="project"><h3>إنشاء مشروع</h3><div class="row nw"><input class="grow" id="pr-name" type="text" placeholder="اسم المشروع" required minlength="2" maxlength="60" style="width:auto"><button class="btn">إنشاء</button></div></form>') +
    (D.projects.length ? D.projects.map(function (p) { var pc = p.total ? Math.round(p.done / p.total * 100) : 0; return '<button class="list-btn" data-act="popen" data-id="' + p.id + '" style="flex-direction:column;align-items:stretch"><div class="name">' + esc(p.name) + '</div><div class="prog"><i style="width:' + pc + '%"></i></div><div class="meta">' + p.done + T(' من ') + p.total + T(' مهمة خلصت · ') + p.members + T(' أعضاء</div></button>'); }).join('')
      : T('<div class="empty card">مفيش مشاريع لسه. اعمل مشروع وقسّمه لمهام.</div>'));
}

function chatView() {
  if (ui.chatWith) {
    if (!D.dm) return skeleton();
    var o = D.dm.user, ms = D.dm.messages;
    return T('<button class="link" data-act="cback">رجوع</button><div class="card"><div class="row nw">') + av(o, 40) + '<div class="grow name">' + esc(o.name) + (o.frozen ? T(' <span class="pill">متجمد وقت الامتحانات</span>') : '') + '</div><button class="act" data-act="block" data-id="' + o.id + T('">حظر</button><button class="act" data-act="report" data-kind="user" data-id="') + o.id + T('">بلّغ</button></div>') +
      '<div id="thread"' + chatAttrs() + ' aria-live="polite">' + (ms.map(function (m) { return '<div class="bubble' + (m.from_id === me.id ? ' me' : '') + '">' + esc(m.text) + '</div>'; }).join('') || T('<div class="empty">ابعت أول رسالة</div>')) + '</div>' +
      '<form class="row nw" data-form="dm" data-id="' + o.id + T('"><input class="grow" id="dm" type="text" placeholder="اكتب رسالة" required maxlength="500" style="width:auto"><button class="btn">إرسال</button></form></div>');
  }
  if (!D.chat) return skeleton();
  return T('<h3>اختار حد تتكلم معاه</h3>') + (D.chat.length ? D.chat.map(function (u) { return '<button class="list-btn" data-act="copen" data-id="' + u.id + '">' + av(u, 40) + '<div class="grow"><div class="name">' + esc(u.name) + '</div><div class="meta">' + (u.last ? esc(u.last.slice(0, 50)) : T('ابدأ محادثة')) + '</div></div></button>'; }).join('')
    : T('<div class="empty card">لسه مفيش طلاب تانيين. ادعي زمايلك للموقع.</div>'));
}

function qView() {
  if (ui.question) {
    if (!D.qd) return skeleton();
    var q = D.qd.question;
    return T('<button class="link" data-act="qback">رجوع للأسئلة</button><div class="card"><div class="name">') + esc(q.text) + '</div><div class="meta"><button class="lnk" data-act="uopen" data-id="' + esc(q.uid) + '">' + esc(q.name) + '</button> · ' + ago(q.created) + '</div>' + (q.uid === me.id ? '<button class="act" style="align-self:flex-start" data-act="delq" data-id="' + q.id + T('">حذف السؤال</button>') : '') + '</div>' +
      D.qd.answers.map(function (a) { return '<div class="card' + (a.accepted ? ' best' : '') + '"><div class="row nw"><span class="name grow"><button class="lnk" data-act="uopen" data-id="' + esc(a.uid) + '">' + esc(a.name) + '</button>' + vt(a.uid) + (a.accepted ? ' <span class="pill on">' + T('أفضل إجابة') + '</span>' : '') + '</span>' + (q.uid === me.id ? '<button class="act' + (a.accepted ? ' on' : '') + '" data-act="accept" data-id="' + a.id + '">' + (a.accepted ? T('إلغاء الاختيار') : T('اختار كأفضل إجابة')) + '</button>' : '') + (a.uid === me.id ? '' : '<button class="act' + (a.voted ? ' on' : '') + '" data-act="vote" data-id="' + a.id + T('">مفيد ') + (a.votes || '') + '</button>') + '</div><p class="post-text">' + esc(a.text) + '</p></div>'; }).join('') +
      '<form class="card" data-form="answer" data-id="' + q.id + T('"><textarea id="ans" aria-label="إجابتك" placeholder="اكتب إجابتك" required minlength="2" maxlength="800"></textarea><button class="btn" style="align-self:flex-start">إرسال الإجابة</button></form>');
  }
  if (!D.questions || !D.chal || !D.lb) return skeleton();
  return T('<div class="card challenge"><span class="chtag">التحدي الأسبوعي</span><h3>') + esc(D.chal.text) + '</h3>' +
    D.chal.answers.map(function (a) { return '<div class="cm"><span class="name">' + esc(a.name) + '</span><span>' + esc(a.text) + '</span></div>'; }).join('') +
    T('<form class="row" style="flex-direction:column;align-items:stretch" data-form="chal"><textarea id="chal" aria-label="إجابة التحدي" placeholder="إجابتك على التحدي" required minlength="2" maxlength="500"></textarea><button class="btn" style="align-self:flex-start">نشر تحدي</button></form></div>') +
    T('<form class="card" data-form="ask"><div class="row nw"><input class="grow" id="q-text" type="text" placeholder="اسأل سؤال" required minlength="3" maxlength="200" style="width:auto"><button class="btn">اسأل</button></div></form>') +
    (D.questions.length ? D.questions.map(function (q) { return '<button class="list-btn" data-act="qopen" data-id="' + q.id + '"><div class="grow"><div class="name">' + esc(q.text) + '</div><div class="meta">' + esc(q.name) + ' · ' + q.answers + T(' إجابات</div></div></button>'); }).join('') : T('<div class="empty card">مفيش أسئلة لسه. اسأل أول سؤال.</div>')) +
    T('<div class="card"><h3>لوحة المتصدرين</h3>') + D.lb.map(function (r, i) { return '<div class="rank"><span class="n">' + (i + 1) + '</span>' + av(r, 30) + '<span class="grow name">' + esc(r.name) + '</span><span class="meta">' + r.xp + T(' XP · مستوى ') + r.level + '</span></div>'; }).join('') + '</div>';
}

function profView() {
  if (!D.pposts || !D.users) return skeleton();
  var s = me.stats, list = D.pposts, sug = D.users.filter(function (u) { return !u.following; });
  return '<div class="card pf-card"><div class="banner">' + (me.banner_key ? '<img alt="" src="' + esc(fileUrl(me.banner_key)) + '">' : '') + '<label class="btn ghost sm banner-btn" for="bnf">' + T('تغيير الغلاف') + '</label><input id="bnf" type="file" accept="image/*" data-file="banner" hidden></div><div class="row nw">' + av(me, 64) + '<div class="grow"><h2>' + esc(me.name) + '</h2><div class="meta">' + esc(me.email) + '</div></div></div>' +
    T('<div class="row"><label class="btn ghost sm" for="avf">تغيير صورة البروفايل</label><input id="avf" type="file" accept="image/*" data-file="avatar" hidden></div>') + levelCard() +
    '<div class="stats"><div><b>' + s.posts + T('</b><span class="meta">منشور</span></div><div><b>') + s.followers + T('</b><span class="meta">متابعين</span></div><div><b>') + s.following + T('</b><span class="meta">متابَعون</span></div></div>') +
    (ui.editBio ? '<form class="row nw" data-form="bio"><input class="grow" id="bio" type="text" value="' + esc(me.bio) + T('" maxlength="140" style="width:auto" aria-label="البايو"><button class="btn sm">حفظ</button></form>')
      : '<div>' + (me.bio ? esc(me.bio) : T('<span class="meta">لسه معملتش بايو</span>')) + T('</div><button class="link" data-act="editbio">تعديل البايو</button>')) + '</div>' +
    '<div class="seg"><button data-act="ptab" data-k="posts" aria-pressed="' + (ui.prof === 'posts') + T('">منشوراتي</button><button data-act="ptab" data-k="saved" aria-pressed="') + (ui.prof === 'saved') + T('">المحفوظات</button></div>') +
    (list.length ? list.map(postHTML).join('') : T('<div class="empty card">مفيش حاجة هنا لسه</div>')) +
    findCard() +
    (sug.length ? T('<div class="card"><h3>طلاب تقدر تتابعهم</h3>') + sug.map(function (u) { return '<div class="row nw">' + av(u, 34) + '<div class="grow"><div class="name">' + esc(u.name) + '</div><div class="meta">' + esc(u.bio) + '</div></div><button class="btn sm" data-act="follow" data-id="' + u.id + T('">متابعة</button></div>'); }).join('') + '</div>' : '');
}

function pageWrap(title, inner) {
  var chev = window.LANG !== 'ar' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7';
  return '<div class="page" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="page-bar"><button class="ib" data-act="close" aria-label="' + esc(T('رجوع')) + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + chev + '"/></svg></button><h2>' + esc(title) + '</h2></div><div class="page-in">' + inner + '</div></div>';
}
var CHAT_BG = [['none', 'بدون'], ['dots', 'نقاط'], ['lines', 'خطوط'], ['aurora', 'أورورا'], ['dusk', 'غروب'], ['paper', 'ورق']];
var CHAT_SHAPE = [['round', 'دايري'], ['soft', 'ناعم'], ['square', 'مربع']];
var CHAT_SIZE = [['s', 'صغير'], ['m', 'متوسط'], ['l', 'كبير']];
var CHAT_SW = ['', '#f2a900', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0f172a'];
function chatCfg() {
  var c = (me && me.settings && me.settings.chat) || {};
  function pick(list, v, d) { return list.some(function (x) { return x[0] === v; }) ? v : d; }
  return { bg: pick(CHAT_BG, c.bg, 'none'), shape: pick(CHAT_SHAPE, c.shape, 'round'), size: pick(CHAT_SIZE, c.size, 'm'), mine: /^#[0-9a-f]{6}$/i.test(c.mine || '') ? c.mine : '' };
}
function chatAttrs() {
  var c = chatCfg(), st = '';
  if (c.mine) { var n = parseInt(c.mine.slice(1), 16), lum = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; st = '--bub-me:' + c.mine + ';--bub-fg:' + (lum > 0.6 ? '#1c1400' : '#fff') + ';'; }
  return ' class="thread cs-' + c.bg + ' cb-' + c.shape + ' cz-' + c.size + '" style="' + st + '"';
}
function chatSection() {
  var c = chatCfg();
  function seg(key, list) { return '<div class="seg">' + list.map(function (x) { return '<button type="button" data-act="chset" data-k="' + key + '" data-v="' + x[0] + '" aria-pressed="' + (c[key] === x[0]) + '">' + T(x[1]) + '</button>'; }).join('') + '</div>'; }
  return '<div class="set"><strong>' + T('تخصيص الشات') + '</strong>' +
    '<div class="thread-prev"><div' + chatAttrs() + '><div class="bubble">' + T('أهلاً! عامل إيه؟') + '</div><div class="bubble me">' + T('تمام، لسه بذاكر') + '</div><div class="bubble">' + T('بالتوفيق') + '</div></div></div>' +
    '<div class="field"><label>' + T('الخلفية') + '</label>' + seg('bg', CHAT_BG) + '</div>' +
    '<div class="field"><label>' + T('لون رسايلي') + '</label><div class="swatches">' + CHAT_SW.map(function (s) { return '<button type="button" class="sw' + (c.mine === s ? ' on' : '') + '" data-act="chset" data-k="mine" data-v="' + s + '" aria-label="' + esc(s || T('الأصلي')) + '" aria-pressed="' + (c.mine === s) + '" style="background:' + (s || 'var(--accent)') + '"></button>'; }).join('') + '</div></div>' +
    '<div class="field"><label>' + T('شكل الرسايل') + '</label>' + seg('shape', CHAT_SHAPE) + '</div>' +
    '<div class="field"><label>' + T('حجم الخط في الشات') + '</label>' + seg('size', CHAT_SIZE) + '</div></div>';
}
function dateOnly(s) { return String(s || '').slice(0, 10); }
function planName(id) { var p = (D.plans || []).filter(function (x) { return x.id === id; })[0]; return p ? T(p.name) : id; }

/* ---------- browser push (needs vapidPublicKey in config.js and the Edge Function from the README) ---------- */
function pushOK() { return !!((window.CH_CONFIG || {}).vapidPublicKey) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function b64u(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
function pushSection() {
  if (!pushOK()) return '';
  var on = Notification.permission === 'granted' && ui.pushOn;
  return '<div class="set"><strong>' + T('إشعارات الموبايل') + '</strong><span class="meta">' + T('هتوصلك إشعارات الرسايل والإعجابات حتى لو التطبيق مقفول.') + '</span>' +
    '<button class="btn ' + (on ? 'ghost ' : '') + 'sm" data-act="pushtoggle">' + (on ? T('إيقاف الإشعارات') : T('تفعيل الإشعارات')) + '</button></div>';
}
async function pushState() {
  try { var reg = await navigator.serviceWorker.ready, s = await reg.pushManager.getSubscription(); ui.pushOn = !!s; } catch (e) { ui.pushOn = false; }
}
function planSection() {
  var cur = me.sub, last = (D.subreqs || [])[0], pend = last && last.status === 'pending';
  var h = '<div class="set"><strong>' + T('الاشتراك') + '</strong><div class="row">' +
    (cur ? '<span class="pill on">' + esc(planName(cur.plan)) + '</span><span class="meta">' + T('لحد') + ' ' + esc(dateOnly(cur.expires)) + '</span>' : '<span class="pill">' + T('مجاني') + '</span>') + '</div>';
  (D.plans || []).forEach(function (p) {
    h += '<div class="row nw"><div class="grow"><div class="name">' + esc(T(p.name)) + '</div><div class="meta">' + p.price_egp + ' ' + T('جنيه') + ' / ' + p.days + ' ' + T('يوم') + ' · ' + Math.round(p.quota_mb / 1024) + ' GB ' + T('تخزين') + '</div></div></div>';
  });
  var vc = String((window.CH_CONFIG || {}).vodafoneCash || '').replace(/[^0-9+]/g, '');
  if (vc && !pend && (D.plans || []).length) h += '<div class="vc"><strong>' + T('الدفع بفودافون كاش') + '</strong><ol><li>' + T('حوّل المبلغ على الرقم ده:') + ' <b dir="ltr">' + esc(vc) + '</b> <button type="button" class="btn ghost sm" data-act="copycode" data-v="' + esc(vc) + '">' + T('نسخ') + '</button></li><li>' + T('انسخ رقم العملية من رسالة التأكيد.') + '</li><li>' + T('اختار الباقة والصق رقم العملية تحت وابعت الطلب.') + '</li></ol></div>';
  if (pend) h += '<div class="pill">' + T('طلبك قيد المراجعة') + '</div>';
  else if ((D.plans || []).length) {
    h += '<form class="field" data-form="subreq"><label for="sr-plan">' + T('اطلب اشتراك') + '</label><div class="row nw"><select id="sr-plan" class="grow" style="width:auto">' +
      (D.plans || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(T(p.name)) + ' - ' + p.price_egp + '</option>'; }).join('') + '</select></div>' +
      '<input id="sr-ref" type="text" maxlength="120" placeholder="' + esc(T('رقم عملية التحويل أو مرجع الدفع')) + '" required minlength="3"><button class="btn sm" type="submit">' + T('ابعت الطلب') + '</button>' +
      '<span class="meta">' + T('ادفع بالطريقة اللي الإدارة حددتها وبعدين اكتب رقم العملية. الاشتراك بيتفعّل بعد المراجعة.') + '</span></form>';
  }
  if (last && last.status === 'rejected') h += '<span class="meta">' + T('آخر طلب اترفض') + '</span>';
  return h + '</div>';
}
function bizSection() {
  var b = me.biz, st = b ? b.status : '', paid = !!(me.sub && me.sub.plan === 'business');
  return '<div class="set"><strong>' + T('الحساب التجاري') + '</strong>' +
    '<span class="meta">' + T('تفعيل الحساب التجاري بـ ٢٠٠ جنيه في الشهر: اطلب باقة "حساب تجاري" من الاشتراك فوق وبعد الدفع والمراجعة بيتوثّق نشاطك.') + '</span>' +
    (b ? '<div class="row"><span class="pill' + (b.verified && paid ? ' on' : '') + '">' + (b.verified && paid ? '✔ ' + T('موثّق') : b.verified ? T('الاشتراك انتهى، جدّده') : st === 'rejected' ? T('اترفض') : paid ? T('قيد المراجعة') : T('محتاج دفع ٢٠٠ جنيه')) + '</span></div>' : '<span class="meta">' + T('لو عندك نشاط تجاري سجّله وهنراجعه ونوثّقه.') + '</span>') +
    '<form class="field" data-form="biz"><input id="bz-name" type="text" maxlength="60" required minlength="2" placeholder="' + esc(T('اسم النشاط')) + '" value="' + esc(b ? b.name : '') + '">' +
    '<input id="bz-cat" type="text" maxlength="40" placeholder="' + esc(T('التصنيف (مثلاً: مكتبة)')) + '" value="' + esc(b ? b.category : '') + '">' +
    '<textarea id="bz-desc" maxlength="300" rows="2" placeholder="' + esc(T('وصف قصير')) + '">' + esc(b ? b.description : '') + '</textarea>' +
    '<input id="bz-web" type="url" dir="ltr" maxlength="120" placeholder="https://" value="' + esc(b ? b.website : '') + '">' +
    '<button class="btn sm" type="submit">' + (b ? T('حفظ') : T('سجّل النشاط')) + '</button></form></div>';
}

function nameHint() {
  var l = me.nameLeft;
  if (l == null) return '<span class="meta">' + T('تقدر تغيّر اسم المستخدم ٣ مرات كل ٣ شهور.') + '</span>';
  if (l > 0) return '<span class="meta">' + T('تقدر تغيّر اسم المستخدم ٣ مرات كل ٣ شهور.') + ' ' + T('باقي لك') + ' ' + arNum(l) + ' ' + T(l === 1 ? 'مرة' : 'مرات') + '</span>';
  return '<span class="meta">' + T('خلّصت مرات تغيير الاسم. تقدر تغيّره تاني يوم') + ' ' + esc(me.nameNext ? new Date(me.nameNext).toLocaleDateString(window.LOCALE) : '') + '</span>';
}
// changing the password from Settings needs a code sent to the account's e-mail
function pwField() {
  if (!ui.pwStep) return '<div class="field"><label>' + T('تغيير الباسورد') + '</label><span class="meta">' + T('هنبعتلك كود على إيميلك الأول عشان نتأكد إنك صاحب الحساب.') + ' <b dir="ltr">' + esc(me.email || '') + '</b></span><button class="btn sm" data-act="pwcode">' + T('ابعت كود التغيير') + '</button></div>';
  return '<form class="field" data-form="pwchange"><label for="st-code">' + T('الكود اللي وصلك على إيميلك') + '</label><input id="st-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="' + otpLen() + '" autocomplete="one-time-code" dir="ltr" required placeholder="' + '•'.repeat(otpLen()) + '">' +
    '<label for="st-pw">' + T('باسورد جديد (٨ حروف على الأقل)') + '</label><input id="st-pw" type="password" autocomplete="new-password" minlength="8" required><div class="pwm" data-pw="st-pw"></div>' +
    '<label for="st-pw2">' + T('أعد كتابة الباسورد') + '</label><input id="st-pw2" type="password" autocomplete="new-password" minlength="8" required>' +
    '<div class="row"><button class="btn sm" type="submit">' + T('تغيير الباسورد') + '</button><button class="btn ghost sm" type="button" data-act="pwcode">' + T('ابعت الكود تاني') + '</button><button class="btn ghost sm" type="button" data-act="pwcancel">' + T('إلغاء') + '</button></div></form>';
}
function groupSettingsView() {
  var g = (D.gmsgs && D.gmsgs.group) || {}, X = D.gset;
  if (!X) return skeleton();
  var owner = X.owner === me.id, code = g.code;
  var h = '<div class="set"><strong>' + T('عن الخلية') + '</strong>' + (owner
    ? '<form class="field" data-form="gupd" data-id="' + esc(g.id) + '"><label for="gs-name">' + T('اسم الخلية') + '</label><input id="gs-name" type="text" required minlength="2" maxlength="50" value="' + esc(g.name) + '">' +
      '<label for="gs-desc">' + T('وصف الخلية') + '</label><textarea id="gs-desc" rows="2" maxlength="200" placeholder="' + esc(T('مثلاً: مذاكرة كيمياء ثانوية عامة')) + '">' + esc(X.description) + '</textarea><button class="btn sm" type="submit">' + T('حفظ') + '</button></form>'
    : '<div class="name">' + esc(g.name) + '</div>' + (X.description ? '<p>' + esc(X.description) + '</p>' : '')) + '</div>';
  if (owner) h += '<div class="set"><strong>' + T('كود الدعوة') + '</strong><div class="row nw"><b class="grow" dir="ltr" style="letter-spacing:.12em;font-size:1.2rem">' + esc(code || '') + '</b><button class="btn ghost sm" data-act="copycode" data-v="' + esc(code || '') + '">' + T('نسخ') + '</button></div>' +
    '<button class="btn ghost sm" data-act="gregen" data-id="' + esc(g.id) + '">' + T('تغيير الكود') + '</button><span class="meta">' + T('لو غيّرت الكود، الكود القديم مش هيشتغل تاني، واللي انضموا بالفعل مش هيتأثروا.') + '</span></div>';
  h += '<div class="set"><strong>' + T('الأعضاء') + ' (' + X.members.length + ')</strong>' + X.members.map(function (u) {
    return '<div class="row nw">' + av(u, 34) + '<div class="grow"><div class="name">' + esc(u.name) + '</div></div>' + (u.id === X.owner ? '<span class="pill on">' + T('المالك') + '</span>'
      : owner ? '<button class="btn ghost sm" data-act="gkick" data-id="' + esc(g.id) + '" data-u="' + esc(u.id) + '">' + T('إزالة') + '</button>' : '') + '</div>';
  }).join('') + '</div>';
  h += '<div class="set">' + (owner ? '<button class="btn danger" data-act="gdelete" data-id="' + esc(g.id) + '">' + T('حذف الخلية نهائيًا') + '</button>' : g.mine ? '<button class="btn danger" data-act="gleave" data-id="' + esc(g.id) + '">' + T('خروج من الخلية') + '</button>' : '') + '</div>';
  return h;
}

function trendsHTML(tr) {
  if (!tr) return '';
  var one = function (key, title) {
    var mx = 1; tr.days.forEach(function (d) { if (d[key] > mx) mx = d[key]; });
    return '<div class="card"><strong>' + T(title) + '</strong><div class="chart" role="img" aria-label="' + esc(T(title)) + '">' + tr.days.map(function (d) {
      return '<div class="bar-col"><b>' + (d[key] || '') + '</b><i style="height:' + Math.max(2, Math.round(d[key] / mx * 70)) + 'px"></i><span>' + new Date(d.day).getDate() + '</span></div>'; }).join('') + '</div></div>';
  };
  var list = function (arr, k, title) {
    return arr.length ? '<div class="card"><strong>' + T(title) + '</strong>' + arr.map(function (x) { return '<div class="row nw"><span class="grow">' + esc(T(x[k])) + '</span><b>' + x.n + '</b></div>'; }).join('') + '</div>' : '';
  };
  return one('users', 'مستخدمين جدد (١٤ يوم)') + one('posts', 'منشورات (١٤ يوم)') + one('minutes', 'دقايق مذاكرة (١٤ يوم)') + list(tr.subjects, 'subject', 'أكتر المواد في المكتبة') + list(tr.grades, 'grade', 'المستخدمين حسب السنة');
}
function adminView() {
  var A0 = ui.adm || 'stats', X = D.adm || {}, tabs = [['stats', T('نظرة عامة')], ['users', T('المستخدمين')], ['reqs', T('طلبات الاشتراك')], ['biz', T('الأنشطة التجارية')], ['reports', T('البلاغات')]];
  var seg = '<div class="seg wrapseg">' + tabs.map(function (t) { return '<button data-act="admtab" data-k="' + t[0] + '" aria-pressed="' + (A0 === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>', h = '';
  if (A0 === 'stats') {
    var s = X.stats, L = [['users', 'المستخدمين'], ['new_7d', 'جدد آخر ٧ أيام'], ['posts', 'منشورات'], ['reels', 'ريلز'], ['summaries', 'ملخصات'], ['subs', 'اشتراكات شغالة'], ['requests', 'طلبات اشتراك'], ['biz_pending', 'أنشطة قيد المراجعة'], ['reports', 'بلاغات مفتوحة'], ['banned', 'حسابات موقوفة']];
    h = !s ? skeleton() : '<div class="adm-grid">' + L.map(function (x) { return '<div class="card adm-n"><b>' + (s[x[0]] == null ? 0 : s[x[0]]) + '</b><span class="meta">' + T(x[1]) + '</span></div>'; }).join('') + '</div>' + trendsHTML(X.trends);
  } else if (A0 === 'users') {
    h = '<form class="row nw" data-form="admq"><input class="grow" id="adm-q" type="text" style="width:auto" placeholder="' + esc(T('ابحث بالاسم أو الإيميل')) + '" maxlength="60"><button class="btn sm" type="submit">' + T('بحث') + '</button></form>' +
      (!X.users ? skeleton() : X.users.length ? X.users.map(function (u) {
        var on = u.plan && Date.parse(u.expires) > Date.now();
        return '<div class="card"><div class="row nw"><div class="grow"><div class="name">' + esc(u.name) + (u.banned ? ' <span class="pill">' + T('موقوف') + '</span>' : '') + '</div><div class="meta" dir="ltr">' + esc(u.email) + '</div>' +
          '<div class="meta">' + (on ? esc(planName(u.plan)) + ' · ' + esc(dateOnly(u.expires)) : T('مجاني')) + '</div></div></div>' +
          '<div class="row">' + (D.plans || []).map(function (p) { return '<button class="btn ghost sm" data-act="admgrant" data-id="' + u.id + '" data-plan="' + esc(p.id) + '">+ ' + esc(T(p.name)) + '</button>'; }).join('') +
          (on ? '<button class="btn ghost sm" data-act="admrevoke" data-id="' + u.id + '">' + T('إلغاء الاشتراك') + '</button>' : '') +
          '<button class="btn ' + (u.banned ? 'ghost' : 'danger') + ' sm" data-act="admban" data-id="' + u.id + '" data-v="' + (u.banned ? '' : '1') + '">' + (u.banned ? T('فك الإيقاف') : T('إيقاف الحساب')) + '</button></div></div>';
      }).join('') : '<div class="empty card">' + T('مفيش نتايج للبحث ده') + '</div>');
  } else if (A0 === 'reqs') {
    h = !X.reqs ? skeleton() : X.reqs.length ? X.reqs.map(function (r) {
      return '<div class="card"><div class="name">' + esc(r.name) + ' · ' + esc(planName(r.plan)) + '</div><div class="meta" dir="auto">' + esc(r.ref) + '</div><div class="meta">' + ago(Date.parse(r.created)) + '</div>' +
        '<div class="row"><button class="btn sm" data-act="admreq" data-id="' + r.id + '" data-ok="1">' + T('قبول وتفعيل') + '</button><button class="btn ghost sm" data-act="admreq" data-id="' + r.id + '">' + T('رفض') + '</button></div></div>';
    }).join('') : '<div class="empty card">' + T('مفيش طلبات') + '</div>';
  } else if (A0 === 'biz') {
    h = !X.biz ? skeleton() : X.biz.length ? X.biz.map(function (b) {
      return '<div class="card"><div class="name">' + esc(b.name) + (b.verified ? ' ✔' : '') + ' <span class="pill">' + esc(b.status) + '</span></div><div class="meta">' + esc(b.owner) + (b.category ? ' · ' + esc(b.category) : '') + '</div>' +
        (b.description ? '<p>' + esc(b.description) + '</p>' : '') + (b.website ? '<a class="meta" dir="ltr" href="' + esc(b.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(b.website) + '</a>' : '') +
        (b.paid ? '<span class="pill on">' + T('دافع') + '</span>' : '<span class="pill">' + T('لسه مادفعش') + '</span>') + '<div class="row"><button class="btn sm" data-act="admbiz" data-id="' + b.user_id + '" data-ok="1"' + (b.paid ? '' : ' disabled') + '>' + T('توثيق') + '</button><button class="btn ghost sm" data-act="admbiz" data-id="' + b.user_id + '">' + T('رفض') + '</button></div></div>';
    }).join('') : '<div class="empty card">' + T('مفيش أنشطة') + '</div>';
  } else {
    var mr = D.modrep;
    h = aiFlagsHTML() + (!mr ? skeleton() : mr.length ? mr.map(modReportHTML).join('') : '<div class="empty card">' + T('مفيش بلاغات') + '</div>');
  }
  return seg + h;
}
var AI_CAT = { harassment: 'إساءة', hate: 'كراهية', sexual: 'محتوى جنسي', violence: 'عنف', self_harm: 'إيذاء النفس', spam: 'سبام', personal_info: 'بيانات شخصية', other: 'أخرى' };
function aiFlagsHTML() {
  var f = D.modflags; if (!f || !f.length) return '';
  return '<h3>🛡️ ' + T('تنبيهات المراقبة') + '</h3>' + f.map(function (x) {
    return '<div class="cm"><div class="grow"><span class="pill">' + esc(T(x.kind === 'post' ? 'منشور' : x.kind === 'reel' ? 'ريل' : 'ملخص')) + '</span> <span class="pill">' + esc(T(AI_CAT[x.category] || 'أخرى')) + '</span>' +
      '<p>' + esc(x.preview || '') + '</p><p class="meta">' + esc(x.reason || '') + '</p><p class="meta">' + esc(x.author_name || '') + ' · ' + ago(x.created) + ' · ' + T('اقتراح بس، القرار ليك.') + '</p></div>' +
      '<div class="row"><button class="btn danger sm" data-act="aiflagres" data-id="' + esc(x.id) + '" data-rm="1">' + T('حذف المحتوى') + '</button><button class="btn ghost sm" data-act="aiflagres" data-id="' + esc(x.id) + '">' + T('تجاهل') + '</button></div></div>';
  }).join('');
}
function modReportHTML(r) {
  return '<div class="cm"><div class="grow"><span class="pill">' + esc(T(r.kind === 'post' ? 'منشور' : r.kind === 'comment' ? 'تعليق' : 'مستخدم')) + '</span> <span class="pill">' + esc(T(r.reason === 'spam' ? 'سبام أو إعلانات' : r.reason === 'abuse' ? 'إساءة أو تنمّر' : r.reason === 'inappropriate' ? 'محتوى غير مناسب' : 'سبب تاني')) + '</span>' +
    '<p>' + esc(r.preview || '') + '</p>' + (r.note ? '<p class="meta">' + esc(r.note) + '</p>' : '') + '<p class="meta">' + esc(r.reporter_name || '') + ' · ' + ago(r.created) + '</p></div>' +
    '<div class="row"><button class="btn danger sm" data-act="modres" data-id="' + r.id + '" data-rm="1"' + (r.kind === 'user' ? ' hidden' : '') + '>' + T('حذف المحتوى') + '</button><button class="btn ghost sm" data-act="modres" data-id="' + r.id + '">' + T('تجاهل') + '</button>' + (D.aiOn ? '<button class="btn ghost sm" data-act="aimod" data-id="' + r.id + '">✨ ' + T('فحص بالذكاء الاصطناعي') + '</button>' : '') + '</div>' + aiModVerdict(r.id) + '</div>';
}

function findCard() {
  var f = D.found;
  return T('<form class="card" data-form="findnum"><h3>دور على طالب برقمه</h3><div class="row nw"><input class="grow" id="fn-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="11" dir="ltr" placeholder="٠١٢٣٤٥٦٧٨٩٠١" aria-label="رقم الطالب" style="width:auto"><button class="btn sm" type="submit">بحث</button></div>') +
    (f ? (f.length ? f.map(function (u) { return '<div class="row nw">' + av(u, 34) + '<div class="grow"><div class="name">' + esc(u.name) + '</div><div class="meta">' + esc(u.bio) + '</div></div><button class="btn sm' + (u.following ? ' ghost' : '') + '" type="button" data-act="follow" data-id="' + u.id + '">' + (u.following ? T('بتتابعه') : T('متابعة')) + '</button></div>'; }).join('') : T('<div class="meta">مفيش حد بالرقم ده</div>')) : '') + '</form>';
}

function modalView() {
  var m = ui.modal, h = '';
  if (m === 'notifs') {
    var l = D.notifs || [];
    h = T('<h2>الإشعارات</h2>') + (D.frozenUntil ? T('<div class="pill">الإشعارات متجمدة لحد ') + esc(D.frozenUntil) + '</div>' : '') +
      (l.length ? l.map(function (n) { return '<div class="cm" style="' + (n.read ? '' : 'border-inline-start:3px solid var(--accent)') + '"><span>' + esc(T(n.text)) + '</span><span class="meta">' + ago(n.created) + '</span></div>'; }).join('') : T('<div class="empty">مفيش إشعارات</div>'));
  } else if (m === 'mod') {
    var mr0 = D.modrep;
    h = T('<h2>لوحة الإشراف</h2>') + aiFlagsHTML() + (!mr0 ? T('<p class="meta">جاري التحميل…</p>') : mr0.length ? mr0.map(modReportHTML).join('') : T('<div class="empty">مفيش بلاغات</div>'));
  } else if (m === 'export') {
    h = T('<h2>بياناتك (JSON)</h2><textarea class="json" id="expjson" aria-label="بياناتك" readonly>') + esc(D.exportText || '') + T('</textarea><div class="row"><button class="btn" data-act="copyexp">نسخ</button><button class="btn ghost" data-act="dlexp">تحميل كملف</button></div>');
  } else if (m === 'reelup') {
    h = T('<h2>ارفع ريل</h2><form data-form="reel" class="set"><div class="field"><label for="reel-title">العنوان</label><input id="reel-title" type="text" required minlength="2" maxlength="80"></div>') +
      T('<div class="row"><label class="btn ghost sm" for="reel-file">اختيار فيديو</label><input id="reel-file" type="file" accept="video/mp4,video/webm,video/quicktime" data-file="reel" hidden><span class="meta">') + (ui.pendVid ? esc(ui.pendVid.name) : T('مفيش فيديو متختار (حد أقصى ٢٥ ميجا)')) + '</span></div>' +
      '<button class="btn" type="submit"' + (ui.uploading ? ' disabled' : '') + '>' + (ui.uploading ? T('بيترفع…') : T('رفع')) + '</button></form>';
  } else if (m === 'share') {
    var sh = ui.share || {}, wa = 'https://wa.me/?text=' + encodeURIComponent(sh.msg || ''), tg = 'https://t.me/share/url?url=' + encodeURIComponent(sh.url || '') + '&text=' + encodeURIComponent(sh.text || '');
    h = '<h2>' + T('مشاركة المنشور') + '</h2><div class="share-grid">' +
      '<a class="share-b s-wa" href="' + wa + '" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.4.6-.3.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/></svg><span>WhatsApp</span></a>' +
      '<a class="share-b s-tg" href="' + tg + '" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.6c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.1 13.1.2 11.6c-1.1-.3-1.1-1.1.2-1.6L20.1 2.6c.9-.3 1.7.2 1.8 1.7z" transform="translate(1 1) scale(.92)"/></svg><span>Telegram</span></a>' +
      '<button class="share-b" data-act="sharecopy" type="button"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><span>' + T('نسخ') + '</span></button>' +
      (navigator.share ? '<button class="share-b" data-act="sharemore" type="button"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span>' + T('المزيد') + '</span></button>' : '') + '</div>';
  } else if (m && m.indexOf('report:') === 0) {
    h = T('<h2>بلّغ عن ') + (m.split(':')[1] === 'user' ? T('مستخدم') : T('منشور')) + '</h2><form data-form="report" class="set">' +
      T('<div class="field"><label for="rp-reason">السبب</label><select id="rp-reason" required><option value="spam">سبام أو إعلانات</option><option value="abuse">إساءة أو تنمّر</option><option value="inappropriate">محتوى غير مناسب</option><option value="other">سبب تاني</option></select></div>') +
      T('<div class="field"><label for="rp-note">تفاصيل (اختياري)</label><textarea id="rp-note" maxlength="300" rows="3"></textarea></div>') +
      T('<button class="btn" type="submit">إرسال البلاغ</button></form>');
  } else if (m && m.indexOf('img:') === 0) {
    var s = (D.sums || []).filter(function (x) { return x.id === m.slice(4); })[0];
    h = '<h2>' + esc(s ? s.title : '') + '</h2>' + (s && s.file_key ? '<img alt="" src="' + esc(fileUrl(s.file_key)) + '" style="max-width:100%;border-radius:8px">' : '');
  } else {
    var st = me.settings || {}, n = st.notif || {};
    var blk = (D.blocked || []).map(function (u) { return '<div class="row nw"><span class="grow">' + esc(u.name) + '</span><button class="btn ghost sm" data-act="unblock" data-id="' + u.id + T('">إلغاء الحظر</button></div>'); }).join('') || T('<span class="meta">محدش محظور</span>');
    h = '<div class="set">' + (me.pnum
      ? '<div class="field"><label>' + T('رقمك الخاص') + '</label><input type="text" dir="ltr" value="' + esc(me.pnum) + '" readonly><span class="meta">' + T('الرقم ده ثابت ومابيتغيرش.') + '</span></div>'
      : '<form class="field" data-form="savenum"><label for="st-num">' + T('رقمك الخاص (١١ رقم)') + '</label><div class="row nw"><input id="st-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="11" dir="ltr" class="grow" style="width:auto"><button class="btn sm" type="submit">' + T('حفظ') + '</button></div><span class="meta">' + T('اختر رقم من ١١ رقم وإدّيه لزمايلك، يلاقوك بيه. ماتستخدمش رقم تليفونك. تنبيه: بعد ما تحفظه مش هتقدر تغيّره.') + '</span></form>') + '</div>' +
      '<div class="set"><div class="field"><label for="st-lang">Language / اللغة</label>' + langSelect('') + '</div></div>' +
      '<div class="set"><div class="field"><label for="st-grade">' + T('السنة الدراسية (منهج وزارة التربية والتعليم)') + '</label><select id="st-grade" data-set="grade">' + gradeOpts(myGrade(), T('اختار سنتك')) + '</select></div></div>' +
      T('<div class="set"><div class="field"><label for="st-color">لون التطبيق</label><div class="row"><input id="st-color" type="color" value="') + (st.color || '#f2a900') + T('" style="width:56px;height:36px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--surface2)"><button class="btn ghost sm" data-act="applycolor">تطبيق</button><button class="btn ghost sm" data-act="resetcolor">اللون الأصلي</button></div></div>') +
      T('<div class="field"><label>حجم الخط</label><div class="seg">') + [['s', T('صغير')], ['m', T('متوسط')], ['l', T('كبير')]].map(function (x) { return '<button data-act="fs" data-k="' + x[0] + '" aria-pressed="' + ((st.fs || 'm') === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div></div>' +
      T('<div class="set"><div class="field"><label for="st-priv">خصوصية البروفايل</label><select id="st-priv" data-set="privacy"><option value="all"') + (me.privacy === 'all' ? ' selected' : '') + T('>يشوفه أي حد</option><option value="followers"') + (me.privacy === 'followers' ? ' selected' : '') + T('>المتابعين بس</option><option value="none"') + (me.privacy === 'none' ? ' selected' : '') + T('>محدش (خاص)</option></select></div></div>') +
      T('<div class="set"><strong>الإشعارات</strong>') + [['likes', T('لايكات على منشوراتي')], ['comments', T('تعليقات على منشوراتي')], ['follows', T('متابعين جدد')]].map(function (x) { return '<label class="chk"><input type="checkbox" data-set="n_' + x[0] + '"' + (n[x[0]] !== false ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join('') + '</div>' +
      T('<div class="set"><div class="field"><label for="st-subj">موادك المفضلة (افصل بفاصلة)</label><div class="row nw"><input id="st-subj" type="text" value="') + esc(st.subjects || '') + T('" style="width:auto" class="grow" maxlength="200"><button class="btn sm" data-act="savesubj">حفظ المواد</button></div></div></div>') +
      T('<div class="set"><strong>تجميد الحساب وقت الامتحانات</strong><span class="meta">هيتم تجميد الإشعارات والرسائل الواردة لحد التاريخ ده، وهيرجع طبيعي أوتوماتيك.</span><div class="row nw"><input id="st-frz" type="date" value="') + esc(me.freeze_until || '') + T('" style="width:auto" class="grow" aria-label="تاريخ نهاية التجميد"><button class="btn sm" data-act="freeze">تجميد لحد التاريخ ده</button></div>') +
      (me.freeze_until && me.freeze_until >= dayKey(Date.now()) ? T('<button class="btn ghost sm" data-act="unfreeze">إلغاء التجميد دلوقتي</button>') : '') + '</div>' +
      T('<div class="set"><div class="field"><label for="st-un">اسم مستخدم جديد</label><div class="row nw"><input id="st-un" type="text" style="width:auto" class="grow" minlength="2" maxlength="30"><button class="btn sm" data-act="rename">تحديث اسم المستخدم</button></div>') + nameHint() + '</div>' +
      pwField() + '</div>' +
      T('<div class="set"><strong>المستخدمين المحظورين</strong>') + blk + '</div>' +
      chatSection() + pushSection() + planSection() + bizSection() +
      (me.is_admin ? '<div class="set"><button class="btn" data-act="adminopen">' + T('لوحة الأدمن') + '</button></div>' : me.is_mod ? '<div class="set"><button class="btn ghost" data-act="modopen">' + T('لوحة الإشراف') + '</button></div>' : '') +
      T('<div class="set"><button class="btn ghost" data-act="export">تصدير بياناتي (JSON)</button><button class="btn danger" data-act="disable">') + (ui.confirm === 'disable' ? T('اضغط تاني للتأكيد') : T('تعطيل الحساب مؤقتًا')) + '</button>' +
      (ui.confirm === 'wipe' ? T('<div class="wipe"><label for="st-del">اكتب الباسورد عشان تأكد الحذف النهائي</label><input id="st-del" type="password" autocomplete="current-password"><button class="btn danger" data-act="wipe">احذف حسابي وكل بياناتي نهائيًا</button></div>') : T('<button class="btn danger" data-act="wipe">حذف بياناتي نهائيًا</button>')) + '</div>';
  }
  if (m === 'user') return pageWrap(D.uprof ? D.uprof.name : T('الملف الشخصي'), userPageView());
  if (m === 'prev') return pageWrap(D.psum ? D.psum.title : '', prevView());
  if (m === 'story') return storyView();
  if (m === 'stnew') return pageWrap(T('قصة جديدة'), stComposer());
  if (m === 'gset') return pageWrap(T('إعدادات الخلية'), groupSettingsView());
  if (m === 'admin') return pageWrap(T('لوحة الأدمن'), adminView());
  if (m === 'settings') {
    var lg = '<p class="meta"><a href="' + (window.LANG !== 'ar' ? 'terms-en.html' : 'terms.html') + '" target="_blank" rel="noopener">' + T('الشروط') + '</a> · <a href="' + (window.LANG !== 'ar' ? 'privacy-en.html' : 'privacy.html') + '" target="_blank" rel="noopener">' + T('الخصوصية') + '</a></p>';
    return '<div class="page" role="dialog" aria-modal="true" aria-label="' + esc(T('إعدادات الحساب')) + '"><div class="page-bar"><button class="ib" data-act="close" aria-label="' + esc(T('رجوع')) + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (window.LANG !== 'ar' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg></button><h2>' + T('إعدادات الحساب') + '</h2></div><div class="page-in">' + h + lg + '</div></div>';
  }
  return T('<div class="ov" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="نافذة">') + h + T('<button class="btn ghost" data-act="close">إغلاق</button></div></div>');
}

/* ------------------------------------------------------------------ render */
function applyPrefs() {
  var r = document.documentElement, st = r.style, s = (me && me.settings) || {}, c = s.color;
  if (c) {
    var n = parseInt(c.slice(1), 16), lum = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
    st.setProperty('--accent', c); st.setProperty('--accent-ink', c); st.setProperty('--accent-fg', lum > 0.6 ? '#1c1400' : '#ffffff');
  } else { ['--accent', '--accent-ink', '--accent-fg'].forEach(function (p) { st.removeProperty(p); }); }
  st.setProperty('--fs', { s: '12.5px', m: '14px', l: '16.5px' }[s.fs || 'm']);
  if (ui.theme) r.setAttribute('data-theme', ui.theme); else r.removeAttribute('data-theme');
  var tc = document.querySelector('meta[name="theme-color"]');   // browser / installed-app bar colour follows the theme
  if (tc) tc.setAttribute('content', !me ? '#0a0a09' : (isDark() ? '#0f1217' : '#f3f5f7'));
}
if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (!ui.theme) render(); }); } catch (e) { /* old browser */ } }

function render() {
  var app = $('#app'), keep = {}, sc = window.scrollY, fid = document.activeElement && document.activeElement.id;
  app.querySelectorAll('input[id],textarea[id],select[id]').forEach(function (e) {
    if (e.type === 'file') return;
    keep[e.id] = e.type === 'checkbox' ? e.checked : e.value;
  });
  applyPrefs();
  try { if (navigator.setAppBadge) { if (me && me.unread) navigator.setAppBadge(me.unread); else navigator.clearAppBadge(); } } catch (e) { /* badge not supported */ }
  document.body.classList.toggle('auth-on', !me);
  var cvs = $('#flies'); if (cvs) cvs.hidden = !!me;
  if (!me) { app.innerHTML = authView(); restore(keep, fid); return; }
  var view = { feed: feedView, reels: reelsView, library: libView, study: studyView, groups: groupsView, projects: projView, chat: chatView, questions: qView, profile: profView }[ui.tab]();
  document.body.classList.toggle('focus', !!ui.focus && ui.tab === 'study' && ui.study === 'timer');
  app.innerHTML = shell(gradePrompt() + view);
  restore(keep, fid);
  var pdfBox = $('#pdfv'); if (pdfBox && D.pdfEl && !pdfBox.contains(D.pdfEl)) pdfBox.appendChild(D.pdfEl);
  initReels();
  var th = $('#thread'); if (th) th.scrollTop = th.scrollHeight;
  window.scrollTo(0, sc);
  var md = $('.modal');                                              // dialogs: move focus in, give it back on close
  if (md && !md.contains(document.activeElement)) { ui.opener = document.activeElement; md.setAttribute('tabindex', '-1'); md.focus(); }
  else if (!md && ui.opener) { var o = ui.opener; ui.opener = null; if (o && o.isConnected && o.focus) try { o.focus(); } catch (e) { /* gone */ } }
}
var restoreBase;
function restore(keep, fid) { restoreBase(keep, fid); pwPaint(); }
restoreBase = function (keep, fid) {
  Object.keys(keep).forEach(function (id) {
    var e = document.getElementById(id);
    if (e && e.type !== 'checkbox' && e.dataset.set == null && e.dataset.q == null && !e.hasAttribute('readonly')) e.value = keep[id];
  });
  if (fid && !ui.modal) { var f = document.getElementById(fid); if (f && f.focus) try { f.focus(); } catch (e) { /* element gone */ } }
};

/* ------------------------------------------------------------------ data loading */
async function refreshMe() { me = (await api('GET', '/api/me')).me; }
function feedQS(offset) {
  var p = ['limit=10', 'offset=' + offset, 'view=' + (ui.feedFilter === 'fol' ? 'following' : 'all')];
  if (ui.q) p.push('q=' + encodeURIComponent(ui.q));
  if (ui.feedFilter === 'rand') p.push('seed=' + (ui.seed || (ui.seed = Math.random().toString(36).slice(2, 10))));
  return p.join('&');
}
async function load() {
  var t = ui.tab;
  if (me && !D.verDone) { D.verDone = true; api('GET', '/api/verified').then(function (r) { r.ids.forEach(function (i) { VERm[i] = true; }); render(); }).catch(function () { /* the tick is optional */ }); }
  try {
    if (t === 'feed') {
      var r = await Promise.all([api('GET', '/api/posts?' + feedQS(0)), api('GET', '/api/exams'), refreshMe()]);
      D.posts = r[0].posts; D.more = r[0].more; D.exams = r[1].exams;
      if (!D.aiTried) { D.aiTried = true; aiStatus().then(render); }
      if (!D.sugTried) { D.sugTried = true; Promise.all([api('GET', '/api/suggest/people'), api('GET', '/api/suggest/sharers')]).then(function (sr) { D.sugP = sr[0].users; D.sugS = sr[1].users; render(); }).catch(function () { /* suggestions need hardening.sql section 20 */ }); }
      if (!D.storiesTried) { D.storiesTried = true; api('GET', '/api/stories').then(function (sr) { D.stories = sr.stories; render(); }).catch(function () { /* stories need hardening.sql section 18 */ }); }
      if (!ui.sharedId) { try { ui.sharedId = sessionStorage.getItem('nuvvo_post'); sessionStorage.removeItem('nuvvo_post'); } catch (e) { /* storage may be blocked */ } }
      if (ui.sharedId) {
        try { var sp = (await api('GET', '/api/posts/' + ui.sharedId)).post; sp.shared = true; D.posts = [sp].concat(D.posts.filter(function (x) { return x.id !== sp.id; })); }
        catch (e) { toast(e.message); ui.sharedId = null; }
      }
    } else if (t === 'reels') {
      D.reels = shuffle((await api('GET', '/api/reels')).reels);
    } else if (t === 'library') {
      {
        if (!ui.yearSet && myGrade()) { ui.year = myGrade(); ui.yearSet = true; }
        var qs = ['sort=' + (ui.sort === 'rand' ? 'new' : ui.sort)]; if (ui.lib === 'exam') qs.push('kind=exam'); if (ui.subj) qs.push('subject=' + encodeURIComponent(ui.subj)); if (ui.year) qs.push('year=' + encodeURIComponent(ui.year)); if (ui.q) qs.push('q=' + encodeURIComponent(ui.q));
        D.sums = (await api('GET', '/api/summaries?' + qs.join('&'))).summaries;
        if (ui.sort === 'rand') { var sd = ui.sseed || (ui.sseed = Math.random().toString(36).slice(2, 10)); D.sums = D.sums.map(function (x) { return [hash32(x.id + sd), x]; }).sort(function (p, q) { return p[0] - q[0]; }).map(function (p) { return p[1]; }); }
      }
    } else if (t === 'study') {
      if (ui.study === 'timer') { D.study = await api('GET', '/api/study'); me.stats = D.study.stats; }
      else if (ui.study === 'exams' || ui.study === 'plan') D.exams = (await api('GET', '/api/exams')).exams;
      else if (ui.study === 'ai') { await aiInit(); }
      else if (ui.study === 'cards') { if (ui.deck) D.deck = await api('GET', '/api/decks/' + ui.deck); else D.decks = (await api('GET', '/api/decks')).decks; }
      else if (ui.study === 'city') { var cr = await Promise.all([api('GET', '/api/city' + (ui.cityUser ? '?user=' + ui.cityUser : '')), api('GET', '/api/city/top')]); D.city = cr[0].city; D.citytop = cr[1].cities; }
      else if (ui.study === 'board') { var bg = await Promise.all([api('GET', '/api/study/board' + (ui.bgroup ? '?group=' + ui.bgroup : '')), api('GET', '/api/groups')]); D.board = bg[0].board; D.groups = bg[1].groups; }
    } else if (t === 'groups') {
      if (ui.group) D.gmsgs = await api('GET', '/api/groups/' + ui.group + '/messages');
      else D.groups = (await api('GET', '/api/groups')).groups;
    } else if (t === 'projects') {
      if (ui.project) D.proj = await api('GET', '/api/projects/' + ui.project);
      else D.projects = (await api('GET', '/api/projects')).projects;
    } else if (t === 'chat') {
      if (ui.chatWith) D.dm = await api('GET', '/api/dm/' + ui.chatWith);
      else D.chat = (await api('GET', '/api/chat')).users;
    } else if (t === 'questions') {
      if (ui.question) D.qd = await api('GET', '/api/questions/' + ui.question);
      else {
        var qr = await Promise.all([api('GET', '/api/questions'), api('GET', '/api/challenge'), api('GET', '/api/leaderboard')]);
        D.questions = qr[0].questions; D.chal = qr[1]; D.lb = qr[2].users;
      }
    } else if (t === 'profile') {
      var pr = await Promise.all([api('GET', '/api/posts?limit=30&view=' + (ui.prof === 'saved' ? 'saved' : 'mine')), api('GET', '/api/users'), refreshMe()]);
      D.pposts = pr[0].posts; D.users = pr[1].users;
    }
  } catch (e) { if (e.status !== 401) toast(e.message); }
  if (t === ui.tab) render();
}
function goTab(t) {
  ui.tab = t; ui.sharedId = null; ui.q = ''; ui.deck = ui.rev = ui.group = ui.project = ui.chatWith = ui.question = null; ui.modal = null; ui.confirm = '';
  ['posts', 'reels', 'sums', 'deck', 'gmsgs', 'proj', 'dm', 'qd'].forEach(function (k) { delete D[k]; });
  render(); load();
}

/* live updates for open chats */
var liveOK = false, pollBusy = false, liveT = null;
async function pollOnce() {
  if (!me || document.hidden || ui.modal || pollBusy) return;
  pollBusy = true;
  try {
    if (ui.tab === 'groups' && ui.group) {
      var g = await api('GET', '/api/groups/' + ui.group + '/messages');
      var a = D.gmsgs && D.gmsgs.messages, b = g.messages;
      if (!a || a.length !== b.length || (b.length && a[a.length - 1].id !== b[b.length - 1].id)) { D.gmsgs = g; render(); }
    } else if (ui.tab === 'chat' && ui.chatWith) {
      var d = await api('GET', '/api/dm/' + ui.chatWith);
      var a2 = D.dm && D.dm.messages, b2 = d.messages;
      if (!a2 || a2.length !== b2.length || (b2.length && a2[a2.length - 1].id !== b2[b2.length - 1].id)) { D.dm = d; render(); }
    } else {
      var m = (await api('GET', '/api/me')).me;
      if (m.unread !== me.unread) { me.unread = m.unread; render(); }
    }
  } catch (e) { /* transient network errors are fine here */ }
  pollBusy = false;
}
/* live updates for open chats: realtime when it connects (instant), polling as a safety net (every 5s, or 20s while realtime is on) */
function startPolling() {
  clearInterval(pollT);
  var n = 0;
  pollT = setInterval(function () { n++; if (!liveOK || n % 4 === 0) pollOnce(); }, 5000);
}
function startLive() {
  if (!me || !window.CH_RT) return;
  CH_RT.start(me.id, function () { clearTimeout(liveT); liveT = setTimeout(pollOnce, 150); }, function (ok) { liveOK = ok; });
}
function stopLive() { liveOK = false; if (window.CH_RT) CH_RT.stop(); }

/* ------------------------------------------------------------------ actions */
function clearVals() { for (var i = 0; i < arguments.length; i++) { var e = document.getElementById(arguments[i]); if (e) e.value = ''; } }
function patchPostState(id, fn) { var p = findPost(id); if (p) fn(p); }

var A = {
  lamp: function () {
    ui.lampOn = !ui.lampOn;
    var e = $('.lp'); if (e) e.classList.toggle('lp-off', !ui.lampOn);
    var c = $('.lp-cord'); if (c) { c.classList.remove('pull'); void c.getBoundingClientRect(); c.classList.add('pull'); }
    if (ui.lampOn) setTimeout(function () { var m = $('#a-mail'); if (m && ui.lampOn) m.focus(); }, 500);
  },
  social: async function (d) {
    ui.authErr = '';
    try { await api('POST', '/api/oauth/' + d.p); }  // the browser leaves for the provider's page here
    catch (e) { ui.authErr = e.message; render(); }
  },
  resend: async function () {
    try { await api('POST', ui.authMode === 'reset' ? '/api/recover' : '/api/resend', { email: ui.pendEmail }); ui.authErr = ''; toast(T('بعتنا كود جديد')); } catch (e) { ui.authErr = e.message; render(); }
  },
  authmode: function () { ui.authMode = ui.authMode === 'login' ? 'signup' : 'login'; ui.authErr = ''; render(); },
  forgot: function () { ui.authMode = 'forgot'; ui.authErr = ''; var m = $('#a-mail'); ui.pendEmail = m ? m.value.trim() : ''; render(); },
  theme: function () {
    var cur = ui.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    ui.theme = cur === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('nuvvo_theme', ui.theme); } catch (e) { /* storage may be blocked */ }
    render();
  },
  rail: function () {
    var on = document.documentElement.classList.toggle('rail-off');
    try { localStorage.setItem('nuvvo_rail', on ? 'off' : 'on'); } catch (e) { /* storage may be blocked */ }
    var b = $('[data-act=rail]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  },
  lang: function (d) { var l = d && d.l; setLang(l || (window.LANG === 'en' ? 'ar' : 'en')); },
  logout: async function () { try { await api('POST', '/api/logout'); } catch (e) { /* already signed out */ } afterLogout(); },
  tab: function (d) { goTab(d.k); },
  skip: function () { var m = $('#main'); if (m) m.focus(); },
  settings: async function () {
    ui.modal = 'settings'; ui.confirm = ''; if (pushOK()) await pushState(); render(); D.blocked = (await api('GET', '/api/blocked')).users; render();
    try { D.plans = (await api('GET', '/api/plans')).plans; D.subreqs = (await api('GET', '/api/sub/requests')).requests; render(); } catch (e) { /* plans exist only after hardening.sql section 11 */ }
  },
  ck: function (d) { calcPress(d.k); },
  gset: async function (d) {
    ui.modal = 'gset'; delete D.gset; render();
    try { D.gset = await api('GET', '/api/groups/' + d.id + '/info'); } catch (e) { toast(e.message); ui.modal = null; }
    render();
  },
  gregen: async function (d) {
    if (!confirm(T('تغيير كود الدعوة؟ الكود القديم هيتبطل.'))) return;
    var r = await api('POST', '/api/groups/' + d.id + '/regen'); if (D.gmsgs && D.gmsgs.group) D.gmsgs.group.code = r.code; render(); toast(T('الكود اتغيّر'));
  },
  gkick: async function (d) {
    if (!confirm(T('إزالة العضو ده من الخلية؟'))) return;
    await api('POST', '/api/groups/' + d.id + '/kick', { user: d.u }); D.gset = await api('GET', '/api/groups/' + d.id + '/info'); render();
  },
  gleave: async function (d) {
    if (!confirm(T('تخرج من الخلية؟'))) return;
    await api('POST', '/api/groups/' + d.id + '/join'); ui.modal = null; ui.group = null; delete D.gmsgs; render(); load();
  },
  gdelete: async function (d) {
    if (!confirm(T('حذف الخلية وكل رسايلها نهائيًا؟'))) return;
    await api('DELETE', '/api/groups/' + d.id); ui.modal = null; ui.group = null; delete D.gmsgs; render(); load();
  },
  chset: async function (d) {
    var patch = {}; patch[d.k] = d.v || '';
    me.settings = me.settings || {}; me.settings.chat = Object.assign({}, me.settings.chat || {}, patch); render();
    try { me = (await api('PATCH', '/api/me', { settings: { chat: patch } })).me; render(); } catch (e) { toast(e.message); }
  },
  adminopen: function () { ui.modal = 'admin'; ui.adm = 'stats'; D.adm = {}; render(); loadAdmin(); },
  admtab: function (d) { ui.adm = d.k; render(); loadAdmin(); },
  admgrant: async function (d) { if (!confirm(T('تفعيل الاشتراك ده للمستخدم؟'))) return; await api('POST', '/api/admin/grant', { id: d.id, plan: d.plan }); toast(T('اتفعّل')); loadAdmin(); },
  admrevoke: async function (d) { if (!confirm(T('إلغاء اشتراك المستخدم؟'))) return; await api('POST', '/api/admin/revoke', { id: d.id }); loadAdmin(); },
  admban: async function (d) { if (d.v && !confirm(T('إيقاف الحساب ده؟ مش هيقدر ينشر أو يبعت.'))) return; await api('POST', '/api/admin/ban', { id: d.id, banned: !!d.v }); loadAdmin(); },
  admreq: async function (d) { await api('POST', '/api/admin/request', { id: d.id, approve: !!d.ok }); loadAdmin(); },
  admbiz: async function (d) { await api('POST', '/api/admin/business', { id: d.id, approve: !!d.ok }); loadAdmin(); },
  notifs: async function () {
    ui.modal = 'notifs'; render();
    var r = await api('GET', '/api/notifications'); D.notifs = r.notifications; D.frozenUntil = r.frozen; render();
    await api('POST', '/api/notifications/read'); me.unread = 0;
  },
  close: function () { ui.modal = null; ui.confirm = ''; render(); },
  closeov: function () { A.close(); },
  tag: function (d) { ui.tab = 'feed'; ui.q = d.k; ui.feedFilter = 'all'; render(); load(); },
  clearq: function () { ui.q = ''; render(); load(); },
  gostudy: function () { goTab('study'); },
  /* feed */
  ffilter: function (d) { ui.feedFilter = d.k; if (d.k === 'rand') ui.seed = Math.random().toString(36).slice(2, 10); load(); },
  more: async function () { var r = await api('GET', '/api/posts?' + feedQS(D.posts.filter(function (x) { return !x.shared; }).length)); D.posts = D.posts.concat(r.posts.filter(function (x) { return !D.posts.some(function (y) { return y.id === x.id; }); })); D.more = r.more; render(); },
  like: async function (d) { var r = await api('POST', '/api/posts/' + d.id + '/like'); patchPostState(d.id, function (p) { p.liked = r.liked ? 1 : 0; p.likes = r.count; }); render(); },
  save: async function (d) { var r = await api('POST', '/api/posts/' + d.id + '/save'); patchPostState(d.id, function (p) { p.saved = r.saved ? 1 : 0; }); if (ui.tab === 'profile' && ui.prof === 'saved') return load(); render(); },
  ctoggle: async function (d) {
    ui.openC[d.id] = !ui.openC[d.id]; render();
    if (ui.openC[d.id]) { D.cm = D.cm || {}; D.cm[d.id] = (await api('GET', '/api/posts/' + d.id + '/comments')).comments; render(); }
  },
  delpost: async function (d) { await api('DELETE', '/api/posts/' + d.id); toast(T('المنشور اتحذف')); load(); },
  sfollow: async function (d) {
    var r = await api('POST', '/api/follow/' + d.id);
    if (d.k === 'p') D.sugP = (D.sugP || []).filter(function (u) { return u.id !== d.id; });
    else (D.sugS || []).forEach(function (u) { if (u.id === d.id) u.following = !!r.following; });
    D.sugTried = false; render();
  },
  follow: async function (d) { var r = await api('POST', '/api/follow/' + d.id); (D.found || []).forEach(function (u) { if (u.id === d.id) u.following = !!r.following; }); load(); },
  /* library */
  libtab: function (d) { ui.lib = d.k; ui.q = ''; render(); load(); },
  rplay: function (d) { ui.playing[d.id] = !ui.playing[d.id]; render(); },
  rlike: async function (d) {
    var r = await api('POST', '/api/reels/' + d.id + '/like');
    if (ui.tab === 'reels') {                       // update in place so the video keeps playing
      document.querySelectorAll('.rl-like[data-id="' + d.id + '"]').forEach(function (b) { b.classList.toggle('on', !!r.liked); b.querySelector('span').textContent = r.count || ''; });
      (D.reels || []).forEach(function (x) { if (x.id === d.id) { x.liked = r.liked; x.likes = r.count; } });
    } else load();
  },
  rlmute: function () {
    ui.reelMuted = ui.reelMuted === false;
    document.querySelectorAll('.rl-v').forEach(function (v) { v.muted = ui.reelMuted; });
    var b = $('.rl-mute'); if (b) b.innerHTML = ui.reelMuted ? SPK_OFF : SPK_ON;
  },
  rlmore: function () { delete D.reels; render(); load(); },
  reelup: function () { ui.modal = 'reelup'; ui.pendVid = null; render(); },
  delreel: async function (d) { await api('DELETE', '/api/reels/' + d.id); load(); },
  rpick: function (d) { ui.rp = ui.rp && ui.rp.k === d.k && ui.rp.id === d.id ? null : { k: d.k, id: d.id }; render(); },
  react: async function (d) {
    var path = { post: 'posts', summary: 'summaries', reel: 'reels' }[d.k]; if (!path) return; ui.rp = null;
    var r = await api('POST', '/api/' + path + '/' + d.id + '/like', { react: d.r }), fn = function (x) { x.liked = r.liked ? 1 : 0; x.likes = r.count; x.mine = r.mine; x.reacts = r.counts || {}; };
    if (d.k === 'post') patchPostState(d.id, fn);
    else Object.keys(D).forEach(function (k) { if (Array.isArray(D[k])) D[k].forEach(function (x) { if (x && x.id === d.id) fn(x); }); });
    render();
  },
  slike: async function (d) { await api('POST', '/api/summaries/' + d.id + '/like'); load(); },
  delsum: async function (d) { await api('DELETE', '/api/summaries/' + d.id); load(); },
  prevsum: function (d) {
    var s = (D.sums || []).concat(D.usums || []).filter(function (x) { return x.id === d.id; })[0]; if (!s) return;
    D.psum = s; ui.modal = 'prev'; render(); if (sumKind(s) === 'pdf') pdfOpen(s);
  },
  uopen: async function (d) {
    if (d.id === me.id) { ui.modal = null; ui.tab = 'profile'; render(); load(); return; }
    ui.modal = 'user'; ui.utab = 'posts'; delete D.uprof; delete D.uposts; delete D.usums; render();
    try {
      var r = await Promise.all([api('GET', '/api/users/' + d.id), api('GET', '/api/users/' + d.id + '/posts'), api('GET', '/api/users/' + d.id + '/summaries')]);
      D.uprof = r[0].profile; D.uposts = r[1].posts; D.usums = r[2].summaries;
    } catch (e) { ui.modal = null; toast(e.message); }
    render();
  },
  utab: function (d) { ui.utab = d.k; render(); },
  ufollow: async function (d) { var r = await api('POST', '/api/follow/' + d.id); D.uprof.is_following = !!r.following; D.uprof.followers += r.following ? 1 : -1; render(); },
  ublock: async function (d) { if (!confirm(T('تحظر المستخدم ده؟'))) return; await api('POST', '/api/block/' + d.id); ui.modal = null; toast(T('تم الحظر')); render(); load(); },
  /* study */
  aiack: function () { try { localStorage.setItem('nuvvo_ai_ack', '1'); } catch (e) { ui.aiAck = true; } render(); },
  aimode: function (d) { aiSaveDrafts(); ui.ai.mode = d.k; render(); },
  aiattach: function (d) { var el = document.getElementById(d.k === 'cam' ? 'ai-cam' : 'ai-file'); if (el) el.click(); },
  aifrm: function (d) { aiSaveDrafts(); ui.ai.files.splice(+d.k, 1); render(); },
  aiplanreset: function () { ui.ai.plan = { msgs: [], busy: false, schedule: null, draft: '' }; render(); },
  aiplanprint: function () { window.print(); },
  aiplancopy: function () { try { navigator.clipboard.writeText(planText(ui.ai.plan.schedule)).then(function () { toast(T('اتنسخ')); }, function () { /* clipboard blocked */ }); } catch (e) { /* clipboard blocked */ } },
  aiex: function (d) { return aiAsk(d.t); },
  aiclear: function () { ui.ai.chat = []; render(); },
  aistyle: function (d) { ui.ai.text = ($('#ai-text') || {}).value || ui.ai.text; ui.ai.style = d.k; render(); },
  aicopy: function () { try { navigator.clipboard.writeText(ui.ai.out); toast(T('اتنسخ')); } catch (e) { /* clipboard blocked */ } },
  aipick: function (d) { var Q = ui.ai.quiz; if (Q.picked != null) return; Q.picked = +d.k; if (Q.picked === Q.qs[Q.i].answer) Q.score++; render(); },
  aiquiznext: function () { var Q = ui.ai.quiz; Q.i++; Q.picked = null; render(); },
  aiquizreset: function () { ui.ai.quiz = null; ui.ai.text = ''; render(); },
  aigen: function () { if (!aiAck()) { ui.study = 'ai'; render(); return; } ui.aigen = { busy: false, cards: null }; render(); },
  aigcancel: function () { ui.aigen = null; render(); },
  aigdel: function (d) { ui.aigen.cards.splice(+d.k, 1); render(); },
  aisave: async function () { var G = ui.aigen; await api('POST', '/api/decks/' + ui.deck + '/cards/bulk', { cards: G.cards }); ui.aigen = null; D.deck = await api('GET', '/api/decks/' + ui.deck); render(); toast(T('تم حفظ البطاقات')); },
  aipost: async function (d) {
    if (!aiAck()) { if (!confirm(T('الذكاء الاصطناعي بيشتغل بـ Google Gemini. أي نص تكتبه هنا بيتبعت لـ Google عشان يتعالج، وممكن Google تستخدمه لتحسين خدماتها. ماتكتبش اسمك الكامل ولا رقم تليفونك ولا عنوانك ولا أي معلومات شخصية. والإجابات ممكن تبقى غلط، فراجعها مع كتابك أو مدرسك.'))) return; A.aiack(); }
    var p = (D.posts || []).filter(function (x) { return x.id === d.id; })[0]; if (!p) return;
    var r = await aiCall({ mode: 'simplify', style: 'summary', text: p.text }); (D.aisum = D.aisum || {})[p.id] = r.text; render();
  },
  aimod: async function (d) {
    var r0 = (D.modrep || []).filter(function (x) { return String(x.id) === String(d.id); })[0]; if (!r0) return;
    var r = await aiCall({ mode: 'moderate', text: r0.preview || '' }); (D.aimod = D.aimod || {})[d.id] = r; render();
  },
  stab: function (d) { ui.study = d.k; render(); load(); },
  /* flashcards */
  dkopen: function (d) { ui.deck = d.id; ui.rev = null; delete D.deck; render(); load(); },
  dkback: function () { ui.deck = null; ui.rev = null; delete D.deck; delete D.decks; render(); load(); },
  dkexit: function () { ui.rev = null; delete D.deck; delete D.decks; render(); load(); },
  dkdel: async function (d) { if (!confirm(T('حذف المجموعة وكل بطاقاتها؟'))) return; await api('DELETE', '/api/decks/' + d.id); A.dkback(); },
  cdel: async function (d) { await api('DELETE', '/api/cards/' + d.id); D.deck = await api('GET', '/api/decks/' + ui.deck); render(); },
  dkreview: function () {
    var cs = D.deck.cards, now = Date.now(), due = cs.filter(function (c) { return new Date(c.due).getTime() <= now; }).sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
    ui.rev = { queue: (due.length ? due : shuffled(cs)).map(function (c) { return Object.assign({}, c); }), i: 0, known: 0, again: 0 }; render();
  },
  duereview: async function () {
    var r = await api('GET', '/api/cards/due'); if (!r.cards.length) { delete D.decks; load(); return; }
    ui.rev = { queue: r.cards, i: 0, known: 0, again: 0, due: true }; render();
  },
  cflip: function () { var f = $('.flip'); if (f) f.classList.toggle('on'); },
  cgrade: async function (d) {
    var R0 = ui.rev, c = R0 && R0.queue[R0.i], g = d.k; if (!c || ['again', 'hard', 'good', 'easy'].indexOf(g) < 0) return;
    api('POST', '/api/cards/' + c.id + '/grade', { grade: g }).catch(function () { /* the next card still works */ });
    if (g === 'again') { R0.again++; if (!c._re) { c._re = true; R0.queue.push(Object.assign({}, c, { interval_days: 0 })); } } else R0.known++;
    R0.i++; render();
  },
  /* stories */
  stnew: function () { ui.stKind = 'text'; ui.stBg = 0; ui.stImg = null; ui.modal = 'stnew'; render(); },
  stkind: function (d) { ui.stKind = d.k; render(); },
  stbg: function (d) { ui.stBg = parseInt(d.k) || 0; var p = $('.st-prev'); if (p) p.style.background = STORY_BG[ui.stBg]; document.querySelectorAll('.swatches .sw').forEach(function (b, i) { b.classList.toggle('on', i === ui.stBg); }); },
  stopen: function (d) {
    var gs = storyGroups(), gi = -1, i; for (i = 0; i < gs.length; i++) if (gs[i].uid === d.u) gi = i;
    if (gi < 0) return A.stnew();
    var first = 0; for (i = 0; i < gs[gi].list.length; i++) if (!gs[gi].list[i].seen) { first = i; break; }
    ui.sv = { groups: gs, g: gi, i: first, paused: false }; ui.modal = 'story'; render(); storyShown();
  },
  stclose: function () { stStop(); ui.sv = null; ui.modal = null; render(); },
  stnext: function () {
    if (stHeld) { stHeld = false; return; }
    var S0 = ui.sv; if (!S0) return;
    if (S0.i + 1 < S0.groups[S0.g].list.length) S0.i++; else if (S0.g + 1 < S0.groups.length) { S0.g++; S0.i = 0; } else return A.stclose();
    render(); storyShown();
  },
  stprev: function () {
    if (stHeld) { stHeld = false; return; }
    var S0 = ui.sv; if (!S0) return;
    if (S0.i > 0) S0.i--; else if (S0.g > 0) { S0.g--; S0.i = S0.groups[S0.g].list.length - 1; }
    render(); storyShown();
  },
  stviews: async function (d) { stLeft = Math.max(300, 5000 - (Date.now() - stStart)); stStop(); ui.sv.paused = true; ui.sv.viewers = (await api('GET', '/api/stories/' + d.id + '/viewers')).viewers; render(); },
  stviewsx: function () { ui.sv.viewers = null; ui.sv.paused = false; render(); stSchedule(stLeft); },
  stdel: async function (d) {
    if (!confirm(T('حذف القصة دي؟'))) return;
    await api('DELETE', '/api/stories/' + d.id);
    D.stories = D.stories.filter(function (x) { return x.id !== d.id; });
    var gs = storyGroups(), S0 = ui.sv, cur = S0.groups[S0.g]; stStop();
    var ng = gs.filter(function (g) { return g.uid === cur.uid; })[0];
    if (!ng) return A.stclose();
    ui.sv = { groups: gs, g: gs.indexOf(ng), i: Math.min(S0.i, ng.list.length - 1), paused: false }; render(); storyShown();
  },
  focus: function () {
    if (ui.focus) { if (!tAbandon()) return; timer.running = false; timer.left = tTotal(); ui.focus = false; render(); return; }
    ui.focus = true; if (!timer.running) { timer.end = Date.now() + timer.left * 1000; timer.running = true; } render();
  },
  cityvisit: function (d) { ui.modal = null; ui.cityUser = d.id; ui.tab = 'study'; ui.study = 'city'; delete D.city; render(); load(); },
  cityback: function () { ui.cityUser = ''; delete D.city; render(); load(); },
  tstart: function () { timer.end = Date.now() + timer.left * 1000; timer.running = true; render(); },
  tpause: function () { timer.left = Math.max(0, Math.round((timer.end - Date.now()) / 1000)); timer.running = false; render(); },
  treset: function () { if (!tAbandon()) return; timer.running = false; timer.left = tTotal(); ui.focus = false; render(); },
  tskip: function () { if (!tAbandon()) return; timer.running = false; timer.mode = 'focus'; timer.left = tTotal(); render(); },
  tpreset: function (d) { if (timer.running) return; timer.focus = +d.k; if (timer.mode === 'focus') timer.left = tTotal(); timerPrefSave(); render(); },
  tkind: function (d) { timer.kind = d.k || ''; timerPrefSave(); render(); },
  exdel: async function (d) { await api('DELETE', '/api/exams/' + d.id); load(); },
  /* groups / projects / chat / questions */
  gopen: function (d) { ui.group = d.id; delete D.gmsgs; render(); load(); },
  gback: function () { ui.group = null; delete D.gmsgs; render(); load(); },
  gjoin: async function (d) { await api('POST', '/api/groups/' + d.id + '/join'); ui.group = null; delete D.gmsgs; render(); load(); },
  share: function (d) {
    var all = (D.posts || []).concat(D.pposts || []), p = all.filter(function (x) { return x.id === d.id; })[0];
    if (!p) return;
    var body = String(p.text || '').trim(); if (body.length > 200) body = body.slice(0, 197) + '…';
    var url = location.origin + location.pathname.replace(/index\.html$/, '') + '#post=' + p.id, text = (body ? '“' + body + '”\n— ' : '') + p.name;
    ui.share = { url: url, text: text, msg: text + '\n' + url }; ui.modal = 'share'; render();
  },
  sharecopy: function () { var s = ui.share || {}; try { navigator.clipboard.writeText(s.msg).then(function () { toast(T('اتنسخ')); }); } catch (e) { toast(s.msg); } },
  sharemore: function () { var s = ui.share || {}; try { navigator.share({ text: s.text, url: s.url }).catch(function () { /* cancelled */ }); } catch (e) { /* unsupported */ } },
  copycode: function (d) { try { navigator.clipboard.writeText(d.v); toast(T('اتنسخ')); } catch (e) { toast(d.v); } },
  popen: function (d) { ui.project = d.id; delete D.proj; render(); load(); },
  pback: function () { ui.project = null; delete D.proj; render(); load(); },
  pjoin: async function (d) { await api('POST', '/api/projects/' + d.id + '/join'); load(); },
  pdel: async function (d) { await api('DELETE', '/api/projects/' + d.id); ui.project = null; load(); },
  ktoggle: async function (d) { var t = D.proj.tasks.filter(function (x) { return x.id === d.id; })[0]; await api('PATCH', '/api/tasks/' + d.id, { done: !t.done }); load(); },
  kdel: async function (d) { await api('DELETE', '/api/tasks/' + d.id); load(); },
  copen: function (d) { ui.chatWith = d.id; delete D.dm; render(); load(); },
  cback: function () { ui.chatWith = null; delete D.dm; render(); load(); },
  report: function (d) { ui.modal = 'report:' + d.kind + ':' + d.id; render(); },
  block: async function (d) { await api('POST', '/api/block/' + d.id); ui.chatWith = null; toast(T('تم الحظر')); load(); },
  modopen: async function () { ui.modal = 'mod'; delete D.modrep; delete D.modflags; render(); D.modrep = (await api('GET', '/api/mod/reports')).reports; try { D.modflags = (await api('GET', '/api/mod/aiflags')).flags; } catch (e) { /* needs hardening.sql section 22 */ } render(); },
  aiflagres: async function (d) { await api('POST', '/api/mod/aiflag/resolve', { id: d.id, remove: !!d.rm }); D.modflags = (await api('GET', '/api/mod/aiflags')).flags; render(); },
  modres: async function (d) { await api('POST', '/api/mod/resolve', { id: d.id, remove: !!d.rm }); D.modrep = (await api('GET', '/api/mod/reports')).reports; render(); },
  unblock: async function (d) { await api('POST', '/api/block/' + d.id); D.blocked = (await api('GET', '/api/blocked')).users; render(); },
  qopen: function (d) { ui.question = d.id; delete D.qd; render(); load(); },
  qback: function () { ui.question = null; delete D.qd; render(); load(); },
  delq: async function (d) { await api('DELETE', '/api/questions/' + d.id); ui.question = null; load(); },
  plsub: function (d) { var p = planGet(), i = p.subs.indexOf(d.s); if (i >= 0) p.subs.splice(i, 1); else p.subs.push(d.s); planSave(p); render(); },
  pldone: function (d) { var p = planGet(); if (p.done[d.k]) delete p.done[d.k]; else p.done[d.k] = 1; planSave(p); render(); },
  pushtoggle: async function () {
    var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await api('DELETE', '/api/push', { endpoint: sub.endpoint }); await sub.unsubscribe(); ui.pushOn = false; render(); return; }
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast(T('الإشعارات متقفلة من إعدادات المتصفح'));
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(window.CH_CONFIG.vapidPublicKey) });
    await api('POST', '/api/push', { sub: sub.toJSON() }); ui.pushOn = true; render(); toast(T('الإشعارات اشتغلت'));
  },
  accept: async function (d) { await api('POST', '/api/answers/' + d.id + '/accept'); load(); },
  vote: async function (d) { await api('POST', '/api/answers/' + d.id + '/vote'); load(); },
  ptab: function (d) { ui.prof = d.k; load(); },
  editbio: function () { ui.editBio = true; render(); },
  /* settings */
  fs: async function (d) { me = (await api('PATCH', '/api/me', { settings: { fs: d.k } })).me; render(); },
  applycolor: async function () { me = (await api('PATCH', '/api/me', { settings: { color: $('#st-color').value } })).me; render(); toast(T('اللون اتغير')); },
  resetcolor: async function () { me = (await api('PATCH', '/api/me', { settings: { color: '' } })).me; render(); },
  savesubj: async function () { me = (await api('PATCH', '/api/me', { settings: { subjects: $('#st-subj').value } })).me; toast(T('اتحفظت المواد')); },
  freeze: async function () { var v = $('#st-frz').value; if (!v) return toast(T('اختار تاريخ الأول')); me = (await api('PATCH', '/api/me', { freeze_until: v })).me; render(); toast(T('الحساب اتجمد لحد ') + v); },
  unfreeze: async function () { me = (await api('PATCH', '/api/me', { freeze_until: null })).me; render(); },
  rename: async function () { var v = $('#st-un').value.trim(); if (!v) return toast(T('اكتب الاسم الجديد')); me = (await api('PATCH', '/api/me', { name: v })).me; clearVals('st-un'); try { me = (await api('GET', '/api/me')).me; } catch (e) { /* keep */ } render(); toast(T('الاسم اتحدث')); },
  pwcode: async function () { await api('POST', '/api/me/password/code'); ui.pwStep = true; render(); var c = $('#st-code'); if (c) c.focus(); toast(T('بعتنا الكود على إيميلك')); },
  pwcancel: function () { ui.pwStep = false; render(); },
  export: async function () { D.exportText = JSON.stringify(await api('GET', '/api/me/export'), null, 2); ui.modal = 'export'; render(); },
  copyexp: function () { var ta = $('#expjson'); try { navigator.clipboard.writeText(ta.value).then(function () { toast(T('اتنسخ')); }, function () { ta.select(); }); } catch (e) { ta.select(); } },
  dlexp: function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([D.exportText], { type: 'application/json' })); a.download = 'nuvvo-data.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  },
  disable: async function () { if (ui.confirm !== 'disable') { ui.confirm = 'disable'; render(); return; } await api('POST', '/api/me/disable'); afterLogout(); },
  wipe: async function () {
    if (ui.confirm !== 'wipe') { ui.confirm = 'wipe'; render(); return; }
    var pw = $('#st-del').value; if (!pw) return toast(T('اكتب الباسورد الأول'));
    await api('POST', '/api/me/delete', { password: pw }); afterLogout(); toast(T('الحساب اتحذف'));
  }
};

function afterLogout() { stopLive(); me = null; timer.loaded = false; timer.kind = ''; D = {}; VERm = {}; ui.focus = false; ui.year = ''; ui.yearSet = false; ui.subj = ''; ui.gradeBusy = false; ui.modal = null; ui.rev = null; ui.deck = null; ui.q = ''; ui.confirm = ''; timer.running = false; timer.mode = 'focus'; timer.left = timer.focus * 60; render(); }

async function loadAdmin() {
  var k = ui.adm || 'stats';
  try {
    if (k === 'stats') { var sr = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/trends')]); D.adm.stats = sr[0].stats; D.adm.trends = sr[1].trends; }
    else if (k === 'users') { if (!D.plans) D.plans = (await api('GET', '/api/plans')).plans; D.adm.users = (await api('POST', '/api/admin/users', { q: ($('#adm-q') || {}).value || '' })).users; }
    else if (k === 'reqs') { if (!D.plans) D.plans = (await api('GET', '/api/plans')).plans; D.adm.reqs = (await api('GET', '/api/admin/requests')).requests; }
    else if (k === 'biz') D.adm.biz = (await api('GET', '/api/admin/businesses')).businesses;
    else { D.modrep = (await api('GET', '/api/mod/reports')).reports; try { D.modflags = (await api('GET', '/api/mod/aiflags')).flags; } catch (e) { /* needs hardening.sql section 22 */ } }
  } catch (e) { toast(e.message); }
  if (ui.modal === 'admin') render();
}
var F = {
  cityname: async function () {
    var r = await api('POST', '/api/city/name', { name: $('#c-name').value }); D.city.city_name = r.name; D.citytop = (await api('GET', '/api/city/top')).cities; render(); toast(T('اتحفظ'));
  },
  aiplan: async function () { var el = $('#ai-plan-in'), tx = (el.value || '').trim(); if (!tx && !ui.ai.files.length) return; el.value = ''; await aiPlanAsk(tx || T('شوف الملف المرفوع')); },
  aichat: async function () { var el = $('#ai-in'), tx = (el.value || '').trim(); if (!tx && !ui.ai.files.length) return; el.value = ''; await aiAsk(tx || T('شوف الملف المرفوع')); },
  aiquiz: async function () {
    var X = ui.ai, tx = $('#ai-text').value.trim(); X.text = tx; if (tx.length < 3 && !X.files.length) return toast(T('اكتب نص أطول شوية أو ارفع صورة'));
    var nq = +$('#ai-n').value || 5, fl = aiFilesOut(); X.busy = true; render();
    try { var r = await aiCall({ mode: 'quiz', text: tx, n: nq, files: fl }); X.files = []; X.quiz = { qs: r.questions, i: 0, score: 0, picked: null }; } finally { X.busy = false; render(); }
  },
  aisimple: async function () {
    var X = ui.ai, tx = $('#ai-text').value.trim(); X.text = tx; if (tx.length < 3 && !X.files.length) return toast(T('اكتب نص أطول شوية أو ارفع صورة'));
    var fl = aiFilesOut(); X.busy = true; X.out = ''; render();
    try { X.out = (await aiCall({ mode: 'simplify', style: X.style, text: tx, files: fl })).text; X.files = []; } finally { X.busy = false; render(); }
  },
  aigen: async function () {
    var G = ui.aigen, tx = $('#ai-text').value.trim(); if (tx.length < 3 && !ui.ai.files.length) return toast(T('اكتب نص أطول شوية أو ارفع صورة'));
    var fl = aiFilesOut(); G.busy = true; render();
    try { G.cards = (await aiCall({ mode: 'cards', text: tx, n: 8, files: fl })).cards; ui.ai.files = []; } finally { G.busy = false; render(); }
  },
  deck: async function () { await api('POST', '/api/decks', { name: $('#dk-name').value }); delete D.decks; load(); },
  card: async function (f, d) { await api('POST', '/api/decks/' + d.id + '/cards', { q: $('#cd-q').value, a: $('#cd-a').value }); D.deck = await api('GET', '/api/decks/' + d.id); render(); var q0 = $('#cd-q'); if (q0) { q0.value = ''; $('#cd-a').value = ''; q0.focus(); } },
  story: async function () {
    var kind = ui.stKind || 'text', tx = ($('#st-text') || {}).value || '';
    await api('POST', '/api/stories', { kind: kind, img_key: kind === 'img' ? ui.stImg : null, text: tx, bg: ui.stBg || 0 });
    ui.modal = null; ui.stImg = null; D.stories = (await api('GET', '/api/stories')).stories; render(); toast(T('القصة اتنشرت'));
  },
  pwchange: async function () {
    var code = $('#st-code').value.replace(/\D/g, ''), pw = $('#st-pw').value;
    if (code.length !== otpLen()) return toast(T('اكتب الكود كامل'));
    if (pw.length < 8) return toast(T('الباسورد لازم يكون ٨ حروف على الأقل'));
    if (pw !== $('#st-pw2').value) return toast(T('الباسورد مش متطابق'));
    await api('POST', '/api/me/password', { code: code, password: pw }); ui.pwStep = false; render(); toast(T('الباسورد اتحدث وباقي الأجهزة اتفصلت'));
  },
  gupd: async function (f, d) {
    await api('POST', '/api/groups/' + d.id + '/update', { name: $('#gs-name').value, description: $('#gs-desc').value });
    D.gset = await api('GET', '/api/groups/' + d.id + '/info'); D.gmsgs = await api('GET', '/api/groups/' + d.id + '/messages'); render(); toast(T('اتحفظ'));
  },
  admq: function () { return loadAdmin(); },
  subreq: async function () {
    await api('POST', '/api/sub/request', { plan: $('#sr-plan').value, ref: $('#sr-ref').value });
    D.subreqs = (await api('GET', '/api/sub/requests')).requests; render(); toast(T('الطلب اتبعت'));
  },
  biz: async function () {
    await api('POST', '/api/biz', { name: $('#bz-name').value, category: $('#bz-cat').value, description: $('#bz-desc').value, website: $('#bz-web').value });
    me = (await api('GET', '/api/me')).me; render(); toast(T('اتحفظ'));
  },
  findnum: async function () {
    var v = $('#fn-num').value.replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }).replace(/\D/g, '');
    if (v.length !== 11) return toast(T('الرقم لازم يكون ١١ رقم'));
    D.found = (await api('POST', '/api/users/find', { num: v })).users; render();
  },
  savenum: async function () {
    var v = $('#st-num').value.replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }).replace(/\D/g, '');
    if (v && v.length !== 11) return toast(T('الرقم لازم يكون ١١ رقم'));
    if (!v) return toast(T('اكتب الرقم'));
    if (!confirm(T('الرقم مش هيتغير بعد الحفظ. تكمّل؟'))) return;
    await api('POST', '/api/me/number', { num: v }); me.pnum = v; render(); toast(T('اتحفظ الرقم'));
  },
  report: async function () {
    var p = String(ui.modal || '').split(':'), r = await api('POST', '/api/report', { kind: p[1], id: p[2], reason: $('#rp-reason').value, note: $('#rp-note').value.trim() });
    ui.modal = null; render(); toast(r.dup ? T('بلّغت عنه قبل كده') : T('وصلنا بلاغك، شكراً'));
  },
  forgot: async function () {
    var em = $('#a-mail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { ui.authErr = T('الإيميل مش مكتوب صح'); render(); return; }
    try { await api('POST', '/api/recover', { email: em }); } catch (e) { ui.authErr = e.message; render(); return; }
    ui.pendEmail = em; ui.authMode = 'reset'; ui.authErr = ''; ui.lampOn = true; render(); var c0 = $('#a-c0'); if (c0) c0.focus();
  },
  reset: async function () {
    var code = otpCode(), pw = $('#a-pw').value;
    if (code.length !== otpLen()) { ui.authErr = T('اكتب الكود المكوّن من ') + arNum(otpLen()) + T(' أرقام'); render(); return; }
    if (pw.length < 8) { ui.authErr = T('الباسورد لازم يكون ٨ حروف على الأقل'); render(); return; }
    var r;
    try { r = await api('POST', '/api/recover/verify', { email: ui.pendEmail, code: code, password: pw }); }
    catch (e) { ui.authErr = e.message; render(); return; }
    me = r.me; ui.authErr = ''; ui.authMode = 'login'; ui.tab = 'feed'; D = {}; render(); load(); startLive(); remindExams(); toast(T('الباسورد اتغيّر'));
  },
  auth: async function () {
    var login = ui.authMode === 'login', body = { email: $('#a-mail').value.trim(), password: $('#a-pw').value };
    if (!login) { body.name = $('#a-name').value.trim(); var gv = ($('#a-grade') || {}).value; if (stageOf(gv)) { try { localStorage.setItem('nuvvo_grade', gv); } catch (e) { /* storage may be blocked */ } } }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { ui.authErr = T('الإيميل مش مكتوب صح'); render(); return; }
    if (!login && body.name.length < 2) { ui.authErr = T('اسم المستخدم لازم يكون حرفين على الأقل'); render(); return; }
    if (!login && body.password.length < 8) { ui.authErr = T('الباسورد لازم يكون ٨ حروف على الأقل'); render(); return; }
    if (login && !body.password) { ui.authErr = T('اكتب الباسورد'); render(); return; }
    var res;
    try { res = await api('POST', login ? '/api/login' : '/api/signup', body); }
    catch (e) { ui.authErr = e.message; render(); return; }
    if (res.verify) { ui.authMode = 'verify'; ui.pendEmail = body.email; ui.authErr = ''; ui.lampOn = true; render(); var c0 = $('#a-c0'); if (c0) c0.focus(); return; }
    me = res.me;
    ui.authErr = ''; ui.tab = 'feed'; D = {}; render(); load(); startLive(); remindExams();
  },
  verify: async function () {
    var code = otpCode(), card = $('.vf');
    if (code.length !== otpLen()) { ui.authErr = T('اكتب الكود المكوّن من ') + arNum(otpLen()) + T(' أرقام'); var er = $('.lp-err'); if (er) er.textContent = ui.authErr; return; }
    var er2 = $('.lp-err'); if (er2) er2.textContent = ''; ui.authErr = '';
    setVf('chk');
    var t0 = Date.now(), r;
    try { r = await api('POST', '/api/verify', { email: ui.pendEmail, code: code }); }
    catch (e) {
      setVf(''); ui.authErr = e.message;
      var er3 = $('.lp-err'); if (er3) er3.textContent = e.message;
      var bx = $('.otp'); if (bx) { bx.classList.remove('bad'); void bx.offsetWidth; bx.classList.add('bad'); }
      otpClear(); return;
    }
    var wait = Math.max(0, 900 - (Date.now() - t0));
    await new Promise(function (ok) { setTimeout(ok, wait); });
    setVf('ok');
    await new Promise(function (ok) { setTimeout(ok, 1300); });
    me = r.me; ui.vstate = ''; ui.authErr = ''; ui.authMode = 'login'; ui.tab = 'feed'; D = {}; render(); load(); startLive(); remindExams();
  },
  post: async function () {
    var tx = $('#post-text').value.trim();
    if (!tx && !ui.pendImg) return toast(T('اكتب حاجة أو ضيف صورة'));
    await api('POST', '/api/posts', { text: tx, img_key: ui.pendImg }); ui.pendImg = null; clearVals('post-text'); load();
  },
  comment: async function (f, d) {
    var i = $('#c-' + d.id); await api('POST', '/api/posts/' + d.id + '/comments', { text: i.value.trim() }); i.value = '';
    D.cm[d.id] = (await api('GET', '/api/posts/' + d.id + '/comments')).comments; var p = findPost(d.id); if (p) p.comments = D.cm[d.id].length; render();
  },
  sum: async function () {
    var f = ui.pendFile, subj = $('#s-subj').value; if (!subj) return toast(T('اختار المادة'));
    var ey = $('#s-ey'); if (ui.lib === 'exam' && !(ey && ey.value)) return toast(T('اختار سنة الامتحان'));
    await api('POST', '/api/summaries', { kind: ui.lib === 'exam' ? 'exam' : 'sum', exam_year: ey ? ey.value : null, title: $('#s-title').value.trim(), subject: subj, year: $('#s-year').value, file_key: f ? f.key : null, file_name: f ? f.name : '' });
    ui.pendFile = null; clearVals('s-title'); toast(T('الملخص اترفع')); load();
  },
  reel: async function () {
    var v = ui.pendVid; if (!v) return toast(T('اختار فيديو الأول'));
    if (v.size > 25e6) return toast(T('الفيديو كبير، الحد الأقصى ٢٥ ميجا'));
    ui.uploading = true; render();
    try { var up = await upload('video', v); await api('POST', '/api/reels', { title: $('#reel-title').value.trim(), file_key: up.key }); ui.pendVid = null; ui.modal = null; toast(T('الريل اترفع')); }
    finally { ui.uploading = false; }
    load();
  },
  gcode: async function () { var r = await api('POST', '/api/groups/join', { code: $('#g-code').value.trim() }); clearVals('g-code'); ui.group = r.id; delete D.gmsgs; toast(T('انضمّيت للخلية')); render(); load(); },
  group: async function () { await api('POST', '/api/groups', { name: $('#g-name').value.trim() }); clearVals('g-name'); load(); },
  gmsg: async function () { var i = $('#gm'); await api('POST', '/api/groups/' + ui.group + '/messages', { text: i.value.trim() }); i.value = ''; load(); },
  project: async function () { await api('POST', '/api/projects', { name: $('#pr-name').value.trim() }); clearVals('pr-name'); load(); },
  task: async function (f, d) { await api('POST', '/api/projects/' + d.id + '/tasks', { text: $('#k-new').value.trim() }); clearVals('k-new'); load(); },
  dm: async function (f, d) { var i = $('#dm'); await api('POST', '/api/dm/' + d.id, { text: i.value.trim() }); i.value = ''; load(); },
  chal: async function () { await api('POST', '/api/challenge', { text: $('#chal').value.trim() }); clearVals('chal'); toast(T('اتنشرت إجابتك')); load(); },
  ask: async function () { await api('POST', '/api/questions', { text: $('#q-text').value.trim() }); clearVals('q-text'); load(); },
  answer: async function (f, d) { await api('POST', '/api/questions/' + d.id + '/answers', { text: $('#ans').value.trim() }); clearVals('ans'); load(); },
  exam: async function () { await api('POST', '/api/exams', { name: $('#ex-name').value.trim(), date: $('#ex-date').value }); clearVals('ex-name', 'ex-date'); load(); },
  bio: async function () { me = (await api('PATCH', '/api/me', { bio: $('#bio').value.trim() })).me; ui.editBio = false; render(); }
};

/* ------------------------------------------------------------------ events */
async function guarded(fn) {
  try { await fn(); }
  catch (e) { if (e.status !== 401) toast((e && e.message) || T('حصلت مشكلة، جرّب تاني')); }
}
document.addEventListener('keydown', function (e) {
  if (!me || ui.tab !== 'study' || ui.study !== 'calc' || ui.modal || e.ctrlKey || e.metaKey || e.altKey) return;
  var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  var k = e.key, m = { '*': '×', '/': '÷', '-': '−', 'Enter': '=', '=': '=', 'Backspace': 'bs', 'Escape': 'ac', 'Delete': 'ac', 'p': 'π', '!': '!', '%': '%', '^': '^', '(': '(', ')': ')', '.': '.', '+': '+' }[k];
  if (/^[0-9]$/.test(k)) m = k;
  if (m === undefined) return;
  e.preventDefault(); calcPress(m);
});
document.addEventListener('click', function (e) {
  if (ui.rp && !e.target.closest('.react-wrap')) { ui.rp = null; render(); }   // a tap anywhere else closes the reaction picker
  var el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
  if (el.tagName === 'LABEL') return;
  var fn = A[el.dataset.act]; if (!fn) return;
  if (el.dataset.act === 'closeov' && e.target !== el) return; // only a click on the dim backdrop itself closes the modal
  guarded(function () { return fn(el.dataset, e); });
});
document.addEventListener('change', function (e) {
  var el = e.target;
  if (el.dataset.act === 'ktoggle') { guarded(function () { return A.ktoggle(el.dataset); }); return; }
  if (el.dataset.act === 'pldone') { A.pldone(el.dataset); return; }
  if (el.dataset.chg === 'aifile') {
    guarded(async function () {
      var picked = Array.prototype.slice.call(el.files || []); el.value = ''; aiSaveDrafts();
      for (var i = 0; i < picked.length; i++) {
        var F = ui.ai.files; if (F.length >= AI_MAX_FILES) { toast(T('لحد ٣ ملفات بس.')); break; }
        if (picked[i].type === 'application/pdf' && F.some(function (f) { return f.mime === 'application/pdf'; })) { toast(T('ملف PDF واحد بس.')); continue; }
        F.push(await aiReadFile(picked[i]));
      }
      render();
    });
    return;
  }
  if (el.dataset.file) { guarded(function () { return onFile(el); }); return; }
  var s = el.dataset.set; if (!s) return;
  if (s === 'lang') { setLang(el.value); return; }
  if (s === 'tmin') { if (timer.running) return; var tv = Math.min(120, Math.max(5, parseInt(el.value, 10) || timer.focus)); timer.focus = tv; if (timer.mode === 'focus') timer.left = tTotal(); timerPrefSave(); render(); return; }
  if (s === 'plmins') { var pp = planGet(); pp.mins = parseInt(el.value) || 90; planSave(pp); render(); return; }
  if (s === 'bgroup') { ui.bgroup = el.value; delete D.board; render(); load(); return; }
  if (s === 'grade') { if (stageOf(el.value)) guarded(function () { return setGrade(el.value); }); return; }
  if (s === 'subj' || s === 'year' || s === 'sort') { ui[s] = el.value; if (s === 'sort' && el.value === 'rand') ui.sseed = Math.random().toString(36).slice(2, 10); if (s === 'year') { ui.yearSet = true; ui.subj = ''; } load(); return; }
  if (s === 'privacy') { guarded(async function () { me = (await api('PATCH', '/api/me', { privacy: el.value })).me; toast(T('اتحفظت الخصوصية')); }); return; }
  if (s.indexOf('n_') === 0) { var n = {}; n[s.slice(2)] = el.checked; guarded(async function () { me = (await api('PATCH', '/api/me', { settings: { notif: n } })).me; }); }
});
async function onFile(el) {
  var f = el.files && el.files[0], k = el.dataset.file; if (!f) return;
  try {
    if (k === 'post') {
      ui.uploading = true; render();
      var up = await upload('image', await resizeImage(f, 1000)); ui.pendImg = up.key;
    } else if (k === 'story') {
      ui.uploading = true; render(); ui.stImg = (await upload('image', await resizeImage(f, 1280))).key;
    } else if (k === 'banner') {
      var bn = await upload('image', await resizeImage(f, 1280)); me = (await api('PATCH', '/api/me', { banner_key: bn.key })).me; toast(T('الغلاف اتغير'));
    } else if (k === 'avatar') {
      var a = await upload('image', await resizeImage(f, 256)); me = (await api('PATCH', '/api/me', { avatar_key: a.key })).me; toast(T('الصورة اتغيرت'));
    } else if (k === 'sum') {
      ui.uploading = true; render();
      var isImg = f.type.indexOf('image/') === 0;
      if (!isImg && f.type !== 'application/pdf') throw new ApiError(T('اختار PDF أو صورة'), 0);
      if (!isImg && f.size > 10e6) throw new ApiError(T('الملف كبير، الحد الأقصى ١٠ ميجا'), 0);
      var blob = isImg ? await resizeImage(f, 1600) : f, sf = await upload('file', blob); ui.pendFile = { key: sf.key, name: f.name };
    } else if (k === 'reel') {
      if (f.size > 25e6) throw new ApiError(T('الفيديو كبير، الحد الأقصى ٢٥ ميجا'), 0);
      var secs = await videoSecs(f);
      if (secs > 90) throw new ApiError(T('الفيديو طويل، الحد الأقصى ٩٠ ثانية'), 0);
      ui.pendVid = f;
    }
  } finally { ui.uploading = false; render(); }
}
function videoSecs(f) {
  return new Promise(function (res) {
    var v = document.createElement('video'), u = URL.createObjectURL(f), done = function (n) { URL.revokeObjectURL(u); res(n); };
    v.preload = 'metadata'; v.onloadedmetadata = function () { done(v.duration || 0); }; v.onerror = function () { done(0); };
    setTimeout(function () { done(0); }, 4000); v.src = u;
  });
}
function otpBoxes() { return Array.prototype.slice.call(document.querySelectorAll('.otp-d')); }
function otpCode() { return otpBoxes().map(function (b) { return b.value; }).join(''); }
function otpClear() { var bs = otpBoxes(); bs.forEach(function (b) { b.value = ''; b.classList.remove('filled'); }); if (bs[0]) bs[0].focus(); }
function setVf(st) {
  ui.vstate = st; var c = $('.vf'); if (!c) return;
  c.classList.remove('vf-chk', 'vf-ok'); if (st) c.classList.add('vf-' + st);
  otpBoxes().forEach(function (b) { b.disabled = !!st; });
}
function otpFill(start, digits) {
  var bs = otpBoxes(), i = start;
  digits.split('').forEach(function (d) { if (bs[i]) { bs[i].value = d; bs[i].classList.add('filled'); bs[i].classList.remove('pop'); void bs[i].offsetWidth; bs[i].classList.add('pop'); i++; } });
  var next = bs[Math.min(i, otpLen() - 1)]; if (next) next.focus();
  if (ui.authMode === 'verify' && otpCode().length === otpLen() && !ui.busy) { ui.busy = true; guarded(F.verify).then(function () { ui.busy = false; }); }
}
document.addEventListener('input', function (e) {
  var el = e.target; if (!el.classList || !el.classList.contains('otp-d')) return;
  var idx = otpBoxes().indexOf(el), d = el.value.replace(/\D/g, '');
  el.value = ''; el.classList.remove('filled');
  if (d) otpFill(idx, d);
});
document.addEventListener('paste', function (e) {
  var el = e.target; if (!el.classList || !el.classList.contains('otp-d')) return;
  e.preventDefault();
  var d = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, otpLen());
  if (d) { otpBoxes().forEach(function (b) { b.value = ''; b.classList.remove('filled'); }); otpFill(0, d); }
});
document.addEventListener('keydown', function (e) {
  var el = e.target; if (!el.classList || !el.classList.contains('otp-d')) return;
  var bs = otpBoxes(), i = bs.indexOf(el);
  if (e.key === 'Backspace') { e.preventDefault(); if (el.value) { el.value = ''; el.classList.remove('filled'); } else if (bs[i - 1]) { bs[i - 1].value = ''; bs[i - 1].classList.remove('filled'); bs[i - 1].focus(); } }
  else if (e.key === 'ArrowLeft' && bs[i + 1]) { e.preventDefault(); bs[i + 1].focus(); }
  else if (e.key === 'ArrowRight' && bs[i - 1]) { e.preventDefault(); bs[i - 1].focus(); }
});
document.addEventListener('submit', function (e) {
  var f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  var fn = F[f.dataset.form]; if (!fn || ui.busy) return;
  ui.busy = true;
  guarded(function () { return fn(f, f.dataset); }).then(function () { ui.busy = false; });
});
document.addEventListener('input', function (e) {
  var el = e.target;
  if (el.dataset && el.dataset.q != null) {
    ui.q = el.value; clearTimeout(searchT);
    searchT = setTimeout(function () { guarded(load); }, 300);
  } else if (el.id === 't-label') timer.label = el.value;
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Tab' && ui.modal) {
    var md = $('.modal') || $('.page'); if (md) {
      var f = Array.prototype.slice.call(md.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (f.length) { var first = f[0], last = f[f.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === md)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
  }
  if (e.key === 'Escape' && ui.modal) A.close();
  if (e.key === 'Escape' && ui.rp) { ui.rp = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('lp-cord')) { e.preventDefault(); A.lamp(); }
});

/* ------------------------------------------------------------------ fireflies (login background) */
function startFlies() {
  var cv = $('#flies'); if (!cv) return;
  var cx = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), fl = [];
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function seed() {
    fl = []; var n = Math.round(Math.min(36, Math.max(14, W / 38)));
    for (var i = 0; i < n; i++) fl.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 1.8, a: Math.random() * 6.28, s: 0.12 + Math.random() * 0.3, p: Math.random() * 6.28, f: 0.6 + Math.random() * 1.2 });
  }
  function draw(t) {
    if (cv.hidden) { if (!still) requestAnimationFrame(draw); return; }
    cx.clearRect(0, 0, W, H);
    for (var i = 0; i < fl.length; i++) {
      var f = fl[i];
      if (!still) { f.a += (Math.random() - 0.5) * 0.12; f.x += Math.cos(f.a) * f.s; f.y += Math.sin(f.a) * f.s; }
      if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10; if (f.y < -10) f.y = H + 10; if (f.y > H + 10) f.y = -10;
      var al = still ? 0.6 : 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * f.f + f.p));
      var g = cx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 5);
      g.addColorStop(0, 'rgba(255,214,10,' + al + ')'); g.addColorStop(1, 'rgba(255,214,10,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(f.x, f.y, f.r * 5, 0, 6.28); cx.fill();
    }
    if (!still) requestAnimationFrame(draw);
  }
  size(); seed(); requestAnimationFrame(draw);
  addEventListener('resize', function () { size(); seed(); if (still) draw(0); });
}

function remindExams() { api('POST', '/api/exams/remind').then(function () { return refreshMe(); }).then(render).catch(function () { /* optional */ }); }

/* ------------------------------------------------------------------ boot */
function cookieNotice() {
  try { if (localStorage.getItem('nuvvo_cookie') === '1') return; } catch (e) { /* storage may be blocked: show it every time */ }
  var d = document.createElement('div'); d.className = 'cookie-note'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Cookies');
  d.innerHTML = '<p>' + esc(T('الموقع ده مابيحطش كوكيز تتبّع. بنخزّن جلسة دخولك وإعداداتك على جهازك بس. وبعض الخدمات الخارجية (حماية الكابتشا والخطوط) ممكن تحط كوكيز أو تشوف عنوان الـ IP بتاعك.')) + '</p><div class="row"><a class="btn ghost sm" href="' + (window.LANG !== 'ar' ? 'privacy-en.html' : 'privacy.html') + '#cookies" target="_blank" rel="noopener">' + esc(T('التفاصيل')) + '</a><button class="btn sm" type="button">' + esc(T('تمام')) + '</button></div>';
  d.querySelector('button').onclick = function () { try { localStorage.setItem('nuvvo_cookie', '1'); } catch (e) { /* ignore */ } d.remove(); };
  document.body.appendChild(d);
}
(async function boot() {
  startFlies(); cookieNotice();
  try { ui.theme = localStorage.getItem('nuvvo_theme') || null; } catch (e) { /* storage may be blocked */ }
  var hp = /^#post=([0-9a-f-]{36})$/i.exec(location.hash);
  if (hp) { try { sessionStorage.setItem('nuvvo_post', hp[1]); } catch (e) { /* storage may be blocked */ } try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
  var ht = /^#(study|library|feed|groups|questions)$/.exec(location.hash); if (ht) { ui.tab = ht[1]; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
  try { me = (await api('GET', '/api/me')).me; } catch (e) { me = null; }
  render();
  if (me) { load(); startLive(); remindExams(); }
  startPolling();
})();

document.addEventListener('keydown', function (e) {
  if (ui.modal === 'story' && ui.sv) { if (e.key === 'Escape') A.stclose(); else if (e.key === 'ArrowRight') (document.dir === 'rtl' ? A.stprev : A.stnext)(); else if (e.key === 'ArrowLeft') (document.dir === 'rtl' ? A.stnext : A.stprev)(); return; }
  if (ui.tab === 'study' && ui.study === 'cards' && ui.rev && (e.key === ' ' || e.key === 'Enter') && !/INPUT|TEXTAREA|BUTTON/.test((e.target || {}).tagName || '')) { e.preventDefault(); A.cflip(); }
  if (ui.tab === 'study' && ui.study === 'cards' && ui.rev && ui.rev.i < ui.rev.queue.length && /^[1-4]$/.test(e.key) && document.querySelector('.flip.on') && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) { e.preventDefault(); A.cgrade({ k: ['again', 'hard', 'good', 'easy'][+e.key - 1] }); }
});
document.addEventListener('pointerdown', function (e) { if (ui.modal === 'story' && ui.sv && e.target.closest && e.target.closest('.st-zone')) { stDown = Date.now(); stLeft = Math.max(300, 5000 - (Date.now() - stStart)); clearTimeout(stT); var v = $('.st-view'); if (v) v.classList.add('hold'); } });
function stRelease() {
  if (!stDown) return; var held = Date.now() - stDown > 250; stDown = 0;
  var v = $('.st-view'); if (v) v.classList.remove('hold');
  if (ui.modal === 'story' && ui.sv && !ui.sv.paused) { if (held) { stHeld = true; setTimeout(function () { stHeld = false; }, 400); } stSchedule(stLeft); }
}
document.addEventListener('pointerup', stRelease); document.addEventListener('pointercancel', stRelease);
})();

