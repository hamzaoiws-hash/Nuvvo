/* Nuvvo i18n. Arabic is the source language; T() swaps Arabic runs for the chosen language.
   English lives in en.js; every other language is one file (lang-xx.js) loaded on demand and layered over English. */
(function () {
  var NAMES = { ar: 'العربية', en: 'English', id: 'Bahasa Indonesia', tr: 'Türkçe', fr: 'Français', es: 'Español', de: 'Deutsch' };
  var LOC = { ar: 'ar-EG', en: 'en-GB', id: 'id-ID', tr: 'tr-TR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' };
  var L = '';
  try { L = localStorage.getItem('nuvvo_lang') || ''; } catch (e) { /* storage may be blocked */ }
  if (!NAMES[L]) { L = (navigator.language || '').slice(0, 2).toLowerCase(); if (!NAMES[L]) L = 'en'; }
  window.LANG = L; window.LANGS = NAMES; window.LOCALE = LOC[L];
  try { if (localStorage.getItem('nuvvo_rail') === 'off') document.documentElement.classList.add('rail-off'); } catch (e) { /* storage may be blocked */ }
  var de = document.documentElement;
  de.lang = L; de.dir = L === 'ar' ? 'rtl' : 'ltr';
  if (L !== 'ar' && L !== 'en') document.write('<script src="lang-' + L + '.js"><\/script>');
  var re = null, cache = {}, D = null;
  window.T = function (s) {
    if (L === 'ar' || !s) return s;
    if (!D) {
      D = window.NUVVO_EN; if (!D) return s;
      var X = window.NUVVO_L && window.NUVVO_L[L];
      if (X) { var m = {}, k; for (k in D) m[k] = D[k]; for (k in X) m[k] = X[k]; D = m; }
    }
    if (!re) re = new RegExp('(?<![\\u0621-\\u064A])(?:' + Object.keys(D).sort(function (a, b) { return b.length - a.length; }).map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![\\u0621-\\u064A])', 'g');
    if (cache[s] != null) return cache[s];
    var o = s.replace(re, function (m) { return D[m]; }).replace(/؟/g, '?').replace(/،/g, ',').replace(/ {2,}/g, ' ').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
    return (cache[s] = o);
  };
  window.setLang = function (l) { try { localStorage.setItem('nuvvo_lang', l); } catch (e) { /* ignore */ } location.reload(); };
})();
