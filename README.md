# Nuvvo (Supabase)

1. Supabase > SQL Editor > New query: paste all of `supabase.sql` and press Run (once).
2. Supabase > Authentication > Sign In / Providers > Email: turn OFF "Confirm email".
3. Put the `public/` folder on any static host (Cloudflare Pages, Netlify, GitHub Pages),
   or try it locally:  cd public && python3 -m http.server 8080   then open http://localhost:8080
4. Project URL and publishable key are in `public/config.js`.

Never put an `sb_secret_` / service_role key in these files.
If the page stays on "loading", open the browser console. The Supabase library version is set in `public/index.html`.

## English / العربية
The app ships in Arabic and English. Arabic is the source language; `en.js` holds the English dictionary and `i18n.js` swaps it in (`T()`). The first visit follows the browser language; the switch is on the login card and in Settings. To fix a wording, edit the matching Arabic key in `en.js`. English privacy/terms pages are `privacy-en.html` / `terms-en.html`.

## Moderation panel
1. Run `hardening.sql` (section 8 adds the `mods` table).
2. Make yourself a moderator once, in the Supabase SQL editor:
   `insert into mods(user_id) select id from auth.users where email = 'you@example.com';`
3. Sign in again. Settings now shows "Moderation" with the open reports: remove the reported post/comment, or dismiss. Reports about a user can only be dismissed; act on those from the Supabase dashboard.

## Self-host supabase-js (recommended)
`index.html` loads `supabase-js@2.58.0` from jsdelivr, so if that CDN or that exact version ever fails the whole site stops. To remove the dependency:
1. Download `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js` and save it as `public/supabase.js`.
2. In `index.html` change the script `src` to `supabase.js`, add `'supabase.js'` to `SHELL` in `sw.js`, and bump `CACHE`.
3. In `_headers` you can then drop `https://cdn.jsdelivr.net` from `script-src`.

## Backups
Supabase dashboard > Database > Backups (daily backups are on paid plans). On the free plan export regularly: `pg_dump` with the connection string from Project Settings > Database, or Table Editor > Export CSV for each table. Storage files are not part of the database dump, so download the `files` bucket separately if it matters.

## Push notifications (not built in)
Web push needs a server that holds a private VAPID key, so it cannot be done by the static site alone. Outline: generate VAPID keys; store each browser `PushSubscription` in a table; a Supabase Edge Function triggered by a database webhook on `notifications` and `dms` sends the push (keep the VAPID private key in the function secrets only); add a `push` handler to `sw.js`. iOS requires the app to be installed to the home screen.

## Personal number, banner, stale reels (hardening.sql section 9)
- **Personal number:** each user can pick an 11-digit number in Settings. Others find them from Profile > "Find a student by number". Numbers are stored in `user_numbers`, which no client can read; lookups go through `find_by_number()` (30 per 10 minutes per user, hides blocked and disabled users). Tell users not to use their phone number.
- **Profile banner:** upload from the top of the Profile page (own profile only; there is no public profile page yet).
- **Reels with no likes for 30 days** are deleted every day at 03:41 by `purge_stale_reels()` (pg_cron). "Interaction" here means likes. The video **file** stays in Storage: the paths are listed in the `orphan_files` table; delete them from Storage > files (or with the Storage API) and then `delete from orphan_files;`. If pg_cron is unavailable run `select purge_stale_reels();` by hand now and then.

## Shared post links
"Share" builds `https://your-site/#post=<id>`. Whoever opens it sees that post pinned at the top of their feed (marked "Shared with you"). Not signed in yet: the id is kept for the tab (`sessionStorage`) and the post opens right after sign-in. Needs `post_by_id()` from `hardening.sql` section 10. If the post was deleted, is blocked for that viewer, or the link is opened in a different browser tab after e-mail confirmation, the viewer just sees the normal feed.

## Admin panel, subscriptions, business accounts (hardening.sql section 11)
1. Run `hardening.sql`, then make yourself admin once in the SQL editor:
   `insert into admins(user_id) select id from auth.users where email = 'you@example.com';` and sign in again. Settings shows **Admin panel**: overview numbers, user search (grant / cancel a plan, suspend), subscription requests, business reviews, and the reports list (moderators still see only the reports panel). Every admin action is written to `admin_log`.
2. **Plans** live in the `plans` table (`plus` 29 EGP and `business` 199 EGP per 30 days as placeholders): edit prices, days and `quota_mb` there. The real, database-enforced perk is the **storage quota** (500 MB free, 2 GB Plus, 5 GB Business). Add more perks by checking `my_plan()`.
3. **Payment is manual.** The user pays you outside the app (bank transfer, wallet, InstaPay...), enters the transaction reference in Settings > Subscription, you approve it in the panel and it activates for the plan's days. Tell users how to pay (for example by adding a line to the plan text in the app). Automatic card payments need a payment provider webhook that calls `admin_grant()`; that is not included.
4. **Business accounts:** anyone can apply in Settings (name, category, description, website). You verify in the panel; the user sees a Verified tick. Changing the name or website sends it back to review. The tick is currently shown on the owner's own settings only.
5. **Suspend** (`profiles.banned`): the user can still sign in and read, but every write (posts, comments, messages, reels...) is refused and they disappear from people lists. Admins cannot be suspended.

## Forgot password (code by e-mail)
In the app: login screen > "Forgot your password?" > e-mail > enter the code + new password. It uses the same 8-digit code length as sign-up. The app answers the same whether or not the e-mail has an account.
Supabase dashboard > Authentication > Emails:
1. **Templates > Reset Password**: subject `كود تغيير الباسورد - Nuvvo`, body = `confirm-signup.html`'s sibling file **`reset-password.html`** (it prints `{{ .Token }}` and must NOT contain `{{ .ConfirmationURL }}`).
2. Optional, if your project shows it under **Notifications**: **Password changed**, body = `password-changed.html` (uses `{{ .Email }}`). This is the "your password was changed" confirmation e-mail.
3. Authentication > Sign In / Providers > Email: OTP expiry 600 s (the template says 10 minutes) and OTP length 8.
4. Attack Protection (captcha) covers password reset too; the app sends the Turnstile token with the request.

## Chat customization
Settings > "Customize chat": wallpaper (none, dots, lines, aurora, dusk, paper), the colour of your own messages, bubble shape, and chat font size. Saved per user in `profiles.settings.chat` and applied to direct and group chats on that user's screen only.

## Business account costs 200 EGP
The `business` plan is 200 EGP / 30 days (section 12 updates the old 199 placeholder). The admin can only verify a business whose owner has an active business plan (the panel shows Paid / Not paid yet); when the plan expires the tick stops showing.

## Vodafone Cash, group settings, calculator

- **Vodafone Cash**: put your wallet number in `public/config.js` → `vodafoneCash: '01XXXXXXXXX'`. It appears (with a copy button) in Settings → Subscription together with the steps. Payment is manual: the user sends the transfer number, you approve it in the admin panel → Requests. Leave it empty to hide the box.
- **Group settings**: gear icon in the group header. Owner: rename, description, change invite code, remove members, delete group. Members: see info and leave. Needs `hardening.sql` section 13.
- **Scientific calculator**: Study tab → Calculator (`public/calc.js`, no `eval`). Supports sin/cos/tan and inverses, ln/log, √, ∛, powers, factorial, %, π, e, Ans, DEG/RAD, and the keyboard.

## Egyptian curriculum (school year)

- Sign-up has a "Which school year are you in?" question (Primary 1–6, Prep 1–3, Secondary 1–3, University). It can be changed any time in Settings. Users without a year see a prompt at the top of the app.
- The Library opens filtered to the user's year, and the subject lists follow the Ministry stage (primary / prep / secondary / university). The lists live in `GRADES` and `STAGE_SUBJ` at the top of `public/app.js` — edit them there if the curriculum changes (e.g. add شعب for Secondary 2/3).
- This is a classification built into the site, not a live link to the Ministry's systems: the Ministry has no public API used here, and the content is what students upload.
- Run `hardening.sql` section 14 once (renames the old maths subject "رياضة" to "رياضيات").

## GitHub login

Enable it in Supabase → Authentication → Providers → GitHub: paste the Client ID and the Client Secret there (never in site files), and copy the "Callback URL" shown there into your GitHub OAuth app.

## New in this round

- **Study plan** (Study → Plan): a 7-day plan from the user's grade subjects and the exams they added; checkmarks are kept on the device. If an exam's name contains a subject name (e.g. "امتحان فيزياء"), that subject is moved up before the exam.
- **Weekly challenge** (Study → Challenge): who studied the most minutes in the last 7 days, for everyone or for one of your groups.
- **Past exams** (Library → past exams): upload papers with the exam year; filtered by the user's school year like summaries.
- **Best answer**: the person who asked can mark one answer; it is shown first with a badge. Votes already existed.
- **Verified tick** ✔ next to businesses with an approved business account and an active business plan (posts, answers, board).
- **Admin trends**: 14-day charts of new users, posts and study minutes, top subjects and users per school year.
- **Focus mode** (Study → Timer): starts the timer and hides everything except it.
- **PWA**: offline page, home-screen shortcuts, cache `nuvvo-v12`.
- **Mobile push** (optional): needs `vapidPublicKey` in `config.js` and the Edge Function in `functions/push/index.ts` (setup steps are at the top of that file). Until you do that, the switch is hidden. Not tested against real push services.
- **Android APK**: the site is an installable PWA. For a Play-Store style APK wrap it as a Trusted Web Activity with PWABuilder (pwabuilder.com) or Bubblewrap; that needs a signing key and a `/.well-known/assetlinks.json` file that only you can create.
- Run `hardening.sql` section 15 (safe to run again).

## City builder (focus → buildings)

- Study → **My city**. Every finished focus session builds a building: house (< 25 min), flat (< 45), shop (< 60), tower (60). Buildings fill 3×3 lots; every 9 buildings open a new district separated by streets. The city level follows total focus minutes (village → town → city → capital).
- The user names their city and can visit other people's cities (top 20 list, or by tapping a name on the challenge board). Blocked, banned and disabled users are hidden.
- In focus mode the building rises with the timer. Leaving a running session after 30 s or more (Exit focus, Restart or Skip) asks for confirmation and leaves a **ruin**. A web page cannot reliably know the user switched apps, so only those buttons count.
- Limits (in `hardening.sql` section 16): at most 12 buildings and 10 ruins per user per day; city names are 2–30 characters. City names are user-generated text: use the existing report/ban tools if one is abusive.
- Run `hardening.sql` section 16 (safe to run again). `vapidPublicKey` in `config.js` is now filled in; the Edge Function still needs the private key as a secret.

## UI refresh (from your reference clips)

- **Phones:** the side rail becomes a floating bottom bar; the open tab rises as a coloured bubble with a notch (CSS only, per-tab colours in `style.css`, section "phones"). Wide screens keep the hover side rail.
- **Glass clock** on Study → Timer (live time and date, language-aware).
- **Password strength meter** with the 5 requirements on sign-up, reset password and Settings → new password. It is advice only; the hard rule stays "8 characters or more".

## Random feed, profiles, preview

- **Feed → "Random"**: a stable random order per tap (tap again to reshuffle); "load more" never repeats posts. Needs `hardening.sql` section 17. Reels were already shuffled on every load.
- **Profiles**: tapping a name opens the full profile page (posts, summaries, follow). Reels, answers and question authors are now tappable too.
- **Summaries**: in-site Preview (PDF via the bundled pdf.js, images inline) and Download buttons already exist on every summary card; uploads accept only PDF and images, so every uploaded file can be previewed.

## Discord login (replaces Microsoft)

1. Discord Developer Portal (discord.com/developers/applications) → New Application → OAuth2.
2. Copy the **Client ID** and generate the **Client Secret**.
3. In **Redirects** add the Callback URL shown in Supabase → Authentication → Providers → Discord (it ends with `/auth/v1/callback`), then save.
4. In Supabase → Authentication → Providers → Discord: paste Client ID and Client Secret, enable, save. The secret goes only there, never in site files.
5. The site asks Discord for the `identify email` scopes. Users whose Discord email is unverified cannot sign in.
The Microsoft button and route were removed; if you enabled the Azure provider in Supabase you can switch it off.

## Flip cards and stories

- **Cards** (Study → Cards): decks of question/answer cards with a 3D flip. "Start review" shows the least-known cards first (Leitner boxes via the existing `review_card` function); tap the card or press Space to flip, then "Got it" / "Don't know it". Needs nothing new in the database.
- **Stories** (top of the feed): photo or coloured-text stories that disappear after 24 hours. You see stories from people you follow; tap the left/right half to move (mirrored in Arabic), hold to pause, and the owner sees who viewed each story and can delete it. Limits: 15 stories per user per 24 hours; the photo must be in the user's own upload folder. Needs `hardening.sql` section 18; until it is run the stories bar is simply hidden. Photos of expired stories stay in Storage (they show up in the orphan-files list).

## تغيير الباسورد بكود على الإيميل (الإعدادات)
من الإعدادات → "ابعت كود التغيير" بيوصل كود على إيميل الحساب (نفس قالب "Reset password")، وبعدها تكتب الكود + الباسورد الجديد مرتين. بعد النجاح باقي الأجهزة بتتفصل.
- تأكد إن قالب Reset Password في Supabase بيعرض `{{ .Token }}` وطول الكود = `otpLen` في `config.js`.
- للتشديد من ناحية السيرفر: Supabase → Authentication → Providers → Email → فعّل **Secure password change** عشان `updateUser` المباشر ما يتخطاش الكود.

## قواعد اسم المستخدم والرقم الخاص
- اسم المستخدم: ٣ تغييرات بس في أي ٣ شهور (بيتفرض في قاعدة البيانات بـ trigger، والإعدادات بتعرض الباقي وتاريخ التجديد).
- الرقم الخاص (١١ رقم): بيتحفظ مرة واحدة وبعدها ثابت — مفيش تغيير ولا مسح. لازم تشغّل `hardening.sql` (القسم 19) أو `supabase.sql` الجديد.
- ملاحظة: الأرقام اللي اتحفظت قبل التحديث بتفضل زي ما هي وبقت ثابتة كمان.

## اللغات والترتيب العشوائي
- اللغات: العربية، English، Bahasa Indonesia، Türkçe، Français، Español، Deutsch. الاختيار من الإعدادات أو من صفحة الدخول، والتطبيق بيختار لغة المتصفح أول مرة.
- كل لغة ملف واحد `lang-xx.js` بنفس مفاتيح `en.js` (٧١٤ نص)، وأي نص ناقص بيرجع للإنجليزي. لإضافة لغة: انسخ `lang-fr.js`، ترجم القيم، وضيف الكود في `NAMES` و`LOC` جوه `i18n.js` وفي `SHELL` جوه `sw.js`.
- الترجمات متعملة بالآلة ومحتاجة مراجعة من ناطق أصلي قبل النشر. صفحات الشروط والخصوصية موجودة بالعربي والإنجليزي بس، وباقي اللغات بتفتح النسخة الإنجليزية.
- الفيد والملخصات بقوا بترتيب عشوائي افتراضيًا (زر "عشوائي" في الفيد وخيار "عشوائي" في ترتيب الملخصات)، والريلز عشوائية دايمًا. تقدر ترجع للأحدث أو الأكثر إعجابًا في أي وقت.

## الكوكيز والأطراف الثالثة
- الموقع نفسه ما بيستخدمش كوكيز تتبّع. فيه إشعار صغير بيظهر مرة واحدة (`nuvvo_cookie` في localStorage)، وقسم "الكوكيز والتخزين" في سياسة الخصوصية (`#cookies`).
- الأطراف الخارجية الحالية: Google Fonts (الخطوط) وjsDelivr (مكتبة supabase-js) وCloudflare Turnstile (الكابتشا، لازم تفضل).
- عشان تشيل Google Fonts وjsDelivr وتخلي المتصفح يكلّم دومينك بس: على جهازك (Node 18+ ونت) شغّل من فولدر المشروع `node tools/selfhost.mjs`. بينزّل الخطوط والمكتبة جوه `public/vendor`، ويغيّر `index.html` و`_headers` و`sw.js`. السكريبت ماتجرّبش هنا (البيئة بتحجب تنزيل الحزم)، فافتح الموقع بعده وتأكد إن الخطوط ظاهرة. بعدها حدّث قسم الخدمات في سياسة الخصوصية وغيّر اسم الكاش في `sw.js`.

## اقتراحات في نص الفيد
- بعد المنشور الـ٣: "ناس ممكن تعرفهم" (بيترتبوا بعدد المتابعين المشتركين ثم عشوائي، من غير اللي بتتابعهم أو المحظورين أو اللي خصوصيتهم "حد").
- بعد المنشور الـ٧: "بيشاركوا ملخصات وامتحانات سابقة" (أكتر الناس رفعًا للملخصات والامتحانات، وعليه عدد كل نوع).
- من القسم ٢٠ في `hardening.sql` (دالتين `suggest_people` و`top_sharers`، بصلاحيات المستخدم فالحظر والخصوصية بيتطبقوا). من غيره الفيد بيشتغل عادي ومفيش اقتراحات.
- بتختفي وقت البحث، وبعد المتابعة الشخص بيتشال من القايمة.

## الذكاء الاصطناعي (Google Gemini)
الميزات: مساعد مذاكرة (شات)، اختبار من نص، تلخيص وتبسيط (وزرار ✨ لخّص على المنشورات الطويلة)، توليد بطاقات فلاش جوه المجموعة، وزرار "فحص بالذكاء الاصطناعي" للمشرفين على البلاغات (اقتراح بس).
**التفعيل (كله من لوحة Supabase، ومفيش مفتاح بيتحط في ملفات الموقع):**
1. شغّل `hardening.sql` (القسم ٢١: حد يومي ٤٠ وحدة لكل مستخدم، الشات والتلخيص بوحدة والاختبار والبطاقات بوحدتين، والمشرفين مش بيتحسب عليهم).
2. اعمل مفتاح من https://aistudio.google.com. **شروط Google بتطلب إن صاحب المفتاح عمره ١٨+**، يعني ولي أمرك هو اللي يعمله ويكون مسؤول عنه.
3. Edge Functions ← Secrets: `GEMINI_API_KEY` (إجباري). اختياري `GEMINI_MODEL` (الافتراضي `gemini-3.5-flash-lite`؛ راجع الاسم الحالي في AI Studio).
4. `supabase functions deploy ai` (سيب التحقق من JWT شغّال).
- لحد ما `GEMINI_API_KEY` يتحط، الميزة بتظهر "لسه مش متفعّلة" ومفيش حاجة بتتبعت لأي حد.
- **الخصوصية:** النسخة المجانية من Gemini API ممكن Google تستخدم النصوص فيها لتحسين منتجاتها وتراجعها بشريًا. وبما إن مستخدمين Nuvvo طلاب صغار، الأفضل تستخدم النسخة المدفوعة (Paid) اللي مفيهاش استخدام للبيانات، خصوصًا لو في مستخدمين من أوروبا أو بريطانيا (الشروط بتمنع المجانية هناك). أول استخدام بيعرض للمستخدم تنبيه بيوضح ده ويطلب موافقته.
- فحص المشرفين بيتعمل بضغطة مشرف على بلاغ واحد، مش فحص تلقائي لكل المنشورات، عشان محتوى الطلاب ما يتبعتش لـ Google من غير سبب.

### أكتر من مفتاح Gemini (عشان الحد المجاني ما يخلصش)
- في Secrets حط `GEMINI_API_KEYS` = المفاتيح مفصولة بفاصلة، مثلاً `AIza...1,AIza...2,AIza...3` (لحد ١٠). ممكن تسيب `GEMINI_API_KEY` كمان، بيتدمجوا.
- كل طلب بيبدأ بمفتاح عشوائي (توزيع الحمل)، ولو Google رد بـ "الحد خلص" أو "مفتاح غلط/ممنوع" أو خطأ سيرفر، الدالة بتجرّب المفتاح اللي بعده لوحدها. الطالب مابيحسّش بحاجة.
- بينطبق على `ai` و`ai-moderate`. بعد التعديل اعمل `supabase functions deploy ai` (و`ai-moderate` لو بتستخدمه).
- مهم: كل مفتاح لازم يتعمل من **حساب/مشروع Google مختلف** عشان الحدود تتجمع؛ مفاتيح من نفس المشروع بتشترك في نفس الحد. المفاتيح تتحط في Secrets بس، عمرها ما تتكتب في الكود أو الشات. وإنشاء المفاتيح لازم يعمله شخص بالغ (شروط Google).
- حد الطالب اليومي (٤٠ طلب) لسه شغال، ده بيحمي المفاتيح من إنها تخلص بسرعة.

## مراجعة البطاقات بالتكرار المتباعد (SRS)
مستوحاة من تطبيق Kimi اللي بعتّه، ومكتوبة من الصفر في Nuvvo (JS + SQL)، **من غير أي اعتماد على Kimi ولا API**.
1. شغّل `hardening.sql` (القسم ٢٤): بيضيف لكل بطاقة ميعاد مراجعة وصعوبة وفترة، ودالتين `card_grade` و`cards_due`.
2. في تبويب البطاقات: لو في بطاقات مستحقة بيظهر كارت **"راجع دلوقتي"** بيجمع المستحق من كل المجموعات.
3. بعد قلب البطاقة تختار: **مش عارفها** (ترجع بعد ١٠ دقايق وتتكرر في نفس الجلسة)، **صعبة**، **كويسة**، **سهلة**. كل زرار بيكتب ميعاد رجوع البطاقة. اختصارات الكيبورد: ١ و٢ و٣ و٤ بعد القلب.
4. الفترة بتكبر كل ما تجاوب صح (حد أقصى سنة)، والصعوبة بتتراوح بين ١٫٣ و٣٫٠.
5. زرار "ابدأ المراجعة" جوه المجموعة بيراجع المستحق منها أولاً، ولو مفيش بيراجع كل البطاقات للتمرين.
- البطاقات القديمة بتتحسب مستحقة فورًا أول مرة.

### تشغيل الذكاء الاصطناعي على سيرفر خاص بيك (JavaScript أو Python) بدل Edge Function
بنفس السلوك بالظبط (الأوضاع، حد الـ٤٠ طلب يوميًا، قواعد الأمان، وتدوير المفاتيح). مفيش مكتبات تتنزّل. اختار واحدة:

**JavaScript (Node 22.6+):**
```
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_... GEMINI_API_KEYS=key1,key2,key3 PORT=8787 \
node --experimental-strip-types server/ai-server.mjs
```
**Python (3.9+):**
```
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_... GEMINI_API_KEYS=key1,key2,key3 PORT=8787 \
python3 server/ai_server.py
```
- `SUPABASE_ANON_KEY` هو المفتاح العام (publishable) نفسه اللي في `config.js`. مفاتيح Gemini تتحط كمتغيرات بيئة على السيرفر بس.
- السيرفر لازم يكون عليه HTTPS (Render أو Railway أو VPS ورا Caddy/Nginx، إلخ)، وفحص الصحة `/health`.
- في `public/config.js` اكتب `aiUrl: 'https://عنوان-سيرفرك/ai'`، وضيف نفس العنوان في `connect-src` جوه `public/_headers`، وارفع الموقع. لو `aiUrl` فاضي بيستخدم Edge Function زي الأول.
- السيرفر بيتأكد إن الطالب مسجّل دخول (بيراجع التوكن عند Supabase) والحد اليومي لسه بيتحسب هناك، فلازم `hardening.sql` القسم ٢١ يكون شغّال.
- النسختين متطابقتين: اتجرّب نفس ١٧ حالة على الاتنين (`tools/ai-parity.*`) والنتيجة واحدة.
- مفيش نسخة Java لسه.

## تفاعلات متعددة، صور وPDF للذكاء الاصطناعي، وجدول ذكي
شغّل `hardening.sql` (الأقسام ٢٤ و٢٥) وارفع `public`، وأعد نشر دالة `ai` (انسخ `functions/ai/index.ts` من جديد في المحرر).
- **التفاعلات:** على المنشورات والملخصات: 👍 ❤️ 😂 😮 😢 😠. الضغطة على الزرار الرئيسي بتعمل لايك (أو بتشيل تفاعلك)، وزرار ☺ بيفتح الباقي. الضغط على نفس التفاعل بيشيله، وعلى تفاعل تاني بيبدّله. العدّاد الكلي والنقاط والترتيب شغالين زي ما هم. الريلز لسه بقلب واحد، وتصويت الإجابات لسه واحد.
- **صور وكاميرا وPDF للذكاء الاصطناعي:** في الشات والاختبار والتلخيص وتوليد البطاقات والجدول الذكي: أزرار **📷 صوّر** و**🖼️ صورة أو PDF** (لحد ٣ ملفات، PDF واحد فقط، الـPDF لحد ٣ ميجا). الصور بتتصغّر على الجهاز (حتى ١٦٠٠ بكسل) قبل الإرسال. الطلب اللي فيه ملفات بيخصم نقطة زيادة من الحد اليومي (٤٠). السيرفر بيتأكد من نوع الملف الحقيقي وحجمه قبل ما يخصم أو يكلّم Gemini.
- **جدول ذكي:** تبويب المساعد ثم "جدول ذكي". الذكاء الاصطناعي بيسألك عن المواد وميعاد الامتحانات وأصعب مادة والساعات الفاضية، وتقدر ترفع صورة أو PDF لجدول الامتحانات. لما يجمع المعلومات (أو لما تقوله "اعمل الجدول") بيطلّع جدول أيام وساعات ومهام، وتقدر تنسخه أو تطبعه/تحفظه PDF، وتقوله يعدّل حاجة. كل دور بيخصم ٢ من الحد اليومي. ده منفصل عن تبويب "الجدول" القديم اللي بيتبني أوتوماتيك من الامتحانات.
- نسخة Python/Node للسيرفر (`server/`) اتحدّثت بنفس الميزات والنتيجة متطابقة (`tools/ai-parity.*`).

## المدينة بمباني ثلاثية الأبعاد (أيزومترية)
شكل "مدينتي" اتغيّر لجزيرة عشب وتربة بمباني 3D زي الصورة اللي بعتّها: بيوت بأسقف، عمارات طوب بشبابيك، محلات بواجهات زجاج وتندة، ناطحات سحاب زجاجية بهوائيات، وأنقاض للجلسات اللي اتقطعت، مع أشجار. كلها SVG مرسوم بالكود، من غير صور ولا مكتبات، وبتشتغل بالوضع الفاتح والغامق.
- كل **حي = ٢٥ مبنى** (٥×٥). المباني بتتبني من وسط الحي ناحية الأطراف، والحي الأحدث بيظهر فوق. المبنى الأخير بيظهر بحركة صغيرة.
- نوع المبنى لسه بيتحدد بمدة جلسة التركيز (أقل من ٢٥ دقيقة بيت، ٤٥ عمارة، ٦٠ محل، أكتر من كده ناطحة). المبنى اللي بيطلع جنب المؤقت أثناء الجلسة بقى 3D برضو.
- مفيش تغيير في قاعدة البيانات.

## اختيار المبنى ومدة التركيز، وتوسيع المساحة
**المدينة والمؤقت** (شغّل `hardening.sql` القسم ٢٦ وارفع `public`):
- **مدة التركيز من ٥ لـ ١٢٠ دقيقة** (مثلاً ٦٣): شريط تمرير ورقم تكتبه، وفيه اختصارات ١٥/٢٥/٤٥/٦٠. مقفولة أثناء الجلسة، والاختيار بيتفكّر على الجهاز.
- **اختيار المبنى بإيدك:** بيت، فيلا، عمارة، محل، مدرسة، برج. أو "حسب المدة" (اللي كان بيحصل قبل كده). فيلا ومدرسة جداد (مدرسة بساعة وعلم).
- المبنى بيتبني لما الجلسة تخلص (٥ دقايق فأكتر)، وحد أقصى ١٢ مبنى في اليوم. السيرفر بيتأكد من النوع والمدة.

**المساحة المجانية (أرقام اتراجعت من صفحات الأسعار الرسمية):**
- Supabase المجاني: تخزين ١ جيجا، الملف الواحد ٥٠ ميجا، نقل ٥ جيجا (+٥ كاش)، قاعدة بيانات ٥٠٠ ميجا. الخطة Pro بـ٢٥$ في الشهر فيها ١٠٠ جيجا.
- **Cloudflare R2:** ١٠ جيجا مجانًا، **ومفيش رسوم تحميل (egress)**، ومليون عملية كتابة و١٠ مليون قراءة في الشهر. بعد كده ٠٫٠١٥$ للجيجا. الأنسب لأنك أصلاً على Cloudflare.
- **Backblaze B2:** أول ١٠ جيجا مجانًا، والتحميل مجاني لحد ٣ أضعاف اللي مخزّنه، وبعدها ٠٫٠١$ للجيجا.
- الصور بتتضغط WebP قبل الرفع بالفعل. اللي بياخد مساحة هو الفيديو (حد ٢٥ ميجا) وملفات الملخصات (حد ١٠ ميجا).
- تقليل الاستهلاك بدون أي خدمة: تخفيض حد الفيديو لـ١٥ ميجا، وحد الملف لـ٥، وتنظيف الريلز والملخصات اللي مفيش حد بيفتحها.

## المراقبة الآلية بدون API (الافتراضية)
شغالة لوحدها جوه قاعدة البيانات أول ما تشغّل `hardening.sql` (القسم ٢٣). **مفيش مفتاح ولا Edge Function ولا حاجة بتطلع برّه.**
- بتفحص **النص بس** لكل منشور وريل وملخص جديد (نص المنشور، عنوان الريل، عنوان وموضوع الملخص) أول ما يتحفظ.
- بتعلّم: كلمات مخالفة (شتيمة/كراهية/جنسي/تهديد)، كلام عن إيذاء النفس، رقم تليفون أو إيميل، روابط تواصل أو دعاية، وتكرار نفس المنشور ٣ مرات في ساعة.
- بتفهم التحايل البسيط: حروف مطوّلة (كلللب)، نقط بين الحروف (f.u.c.k)، تشكيل، همزات، وأرقام عربي.
- اللي يتعلّم بيظهر للمشرفين في لوحة **تنبيهات المراقبة** ومعاه سبب؛ المشرف يقرر يتجاهل أو يحذف. **مفيش حاجة بتتحذف أوتوماتيك**، ولو الفحص فشل النشر بيكمّل عادي.
- **مش بتشوف** الصور ولا الفيديوهات ولا ملفات الملخصات، ولا بتفهم المعنى زي الذكاء الاصطناعي؛ هي قواعد.
- إضافة كلمة: `insert into banned_words(word,category) values ('الكلمة','harassment');` (التصنيفات: harassment, hate, sexual, violence, self_harm, spam, other). حذف: `delete from banned_words where word='الكلمة';`
- الدالتان `ai` و`ai-moderate` (Gemini) **اختياريتين** ومش لازمين للمراقبة دي.

## مراقبة الذكاء الاصطناعي (اختياري، Gemini) للمنشورات والريلز والملخصات
بيفحص **النص بس** (نص المنشور، عنوان الريل، عنوان وموضوع الملخص) لكل حاجة جديدة، ويعلّم المشبوه للمشرفين في لوحة الإشراف تحت "✨ تنبيهات الذكاء الاصطناعي" (حذف أو تجاهل). **مابيحذفش حاجة لوحده.**
- **مش بيشوف** الصور ولا الفيديوهات ولا ملفات الملخصات، يعني ريل عنوانه عادي وفيديو مخالف مش هيتعلّم. والبلاغات اليدوية وزرار "فحص بالذكاء الاصطناعي" لسه شغالين.
- **التفعيل:** (١) شغّل `hardening.sql` (القسم ٢٢). (٢) Secrets: `GEMINI_API_KEY` و`WEBHOOK_SECRET` (أي نص طويل عشوائي، نفس اللي في push لو موجود) و`AI_MODERATION=on`. من غير `on` الدالة مابتعمل حاجة ومفيش حاجة بتتبعت. (٣) انشر `ai-moderate` بدون JWT: `supabase functions deploy ai-moderate --no-verify-jwt` (أو من المحرر في الداشبورد وقفّل Verify JWT). (٤) Database ← Webhooks: تلات webhooks (جداول `posts` و`reels` و`summaries`، حدث INSERT، النوع Supabase Edge Functions ← `ai-moderate`) وكل واحد بـ header اسمه `x-webhook-secret` وقيمته نفس `WEBHOOK_SECRET`.
- **خصوصية:** ده بيبعت محتوى كل الطلاب لـ Google. فعّله بس لو انت (وولي أمرك) موافقين، والأفضل بقوة النسخة المدفوعة من Gemini API (من غير استخدام البيانات للتحسين). سياسة الخصوصية اتحدّثت بالموضوع.
- المفتاح اللي بتفعّل بيه الدالتين (`ai` و`ai-moderate`) هو نفسه، وحدّ الاستخدام المجاني من Google ممكن يخلص لو الموقع كبر (الدالة بتتخطى الفحص وقتها من غير ما تتعطل).
