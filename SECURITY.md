# أمان Nuvvo: اللي اتعمل واللي لازم تعمله بإيدك

## اتعمل في الكود (اتجرّب على Postgres حقيقي)
- كل جدول عليه RLS، وكل مستخدم يقدر يقرا ويعدّل بياناته بس (ده اللي بيمنع IDOR).
- مسارات الملفات لازم تبقى بالشكل `<id بتاعك>/<uuid>` بالظبط (ممنوع `../` أو مسار حد تاني).
- الدوال الداخلية (زي `notify` و`xp_of`) اتقفلت: المستخدم ماقدرش يندهها مباشرة ويبعت إشعارات مزيفة.
- حد للسرعة: بوستات، تعليقات، رسايل، متابعات... إلخ في الدقيقة (يمنع السبام).
- حد تخزين 500 ميجا لكل مستخدم.
- كود التأكيد 8 أرقام (غيّره من `config.js` -> `otpLen` بين 6 و10).
- ملف `_headers` فيه CSP وحماية من الـ iframe والـ MIME sniffing (Cloudflare بيطبقه لوحده).

## لازم تعمله من لوحة Supabase
1. **Authentication -> Sign In / Providers -> Email**
   - Email OTP Length = **8** (لازم يساوي `otpLen` في config.js)
   - Email OTP Expiration = **600** (10 دقايق)
   - Minimum password length = 8 أو أكتر، وفعّل Require letters and digits
2. **CAPTCHA (Cloudflare Turnstile)**: اعمل Widget من لوحة Cloudflare -> Turnstile، وحط الـ Secret في Supabase -> Authentication -> Attack Protection (Provider = Turnstile)، وحط الـ Site key في `config.js` -> `captchaSiteKey`. لازم الاتنين يتعملوا مع بعض.
3. **Authentication -> Rate Limits**: سيب القيم الافتراضية أو قلّلها.
4. **Authentication -> URL Configuration**: Site URL = رابط موقعك فقط، وفي Redirect URLs رابطك بس.
5. **Authentication -> Sign In / Providers**: اقفل **Allow anonymous sign-ins** وأي provider مش بتستخدمه.
6. ماتحطش `sb_secret_` ولا `service_role` في أي ملف في الموقع أبداً.
7. شغّل `supabase.sql` مرة واحدة. لو الداتابيز شغّالة بالفعل شغّل `hardening.sql` بس (آمن لو اتشغل أكتر من مرة).

## حاجات متعمدة (مش ثغرات)
- المشاريع مفتوحة: أي حد يقدر ينضم. أما **الخلايا (المجموعات) فبقت خاصة**: مفيش حد يشوفها غير الأعضاء، والانضمام بكود دعوة بيبعته صاحب الخلية.
- الملفات في bucket عام: اللي معاه رابط الملف يفتحه، والرابط ماظاهرش إلا لمن يسمح له RLS برؤية البوست.

## تثبيت الموقع كتطبيق (PWA)
- Android/Chrome وكمبيوتر: بيظهر زرار "تثبيت" تلقائياً (أو من قايمة المتصفح -> Install app).
- iPhone: من Safari اضغط زرار المشاركة ثم "إضافة إلى الشاشة الرئيسية". الدخول بجوجل/ديسكورد جوه التطبيق على iPhone ممكن مايكملش، فاستخدم الإيميل والباسورد.

## البلاغات والخصوصية والنسخ الاحتياطي
- **البلاغات:** المستخدم بيضغط "بلّغ" على منشور أو مستخدم. تقراها من Supabase -> Table Editor -> `reports`. لو عايز تحذف منشور: Table Editor -> `posts` -> امسح الصف. ولو عايز توقف حساب: `profiles` -> خلّي `disabled` = true.
- **سياسة الخصوصية والشروط:** `privacy.html` و`terms.html`. حط إيميل التواصل في `config.js` -> `contactEmail`. راجعهم وعدّل عليهم حسب بلدك، وهم نموذج مش استشارة قانونية.
- **إحصائيات زيارات (مجانية):** Cloudflare -> Workers & Pages -> مشروعك -> Metrics -> Enable Web Analytics. مفيش كود تضيفه، وملف `_headers` جاهز ليها.
- **النسخ الاحتياطي:** Supabase -> Database -> Backups. الخطة المجانية مابتعملش نسخ تلقائية، فصدّر بيانات من حين لآخر: Table Editor -> Export to CSV، أو من SQL Editor شغّل `select * from posts` وصدّر النتيجة.
