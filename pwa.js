/* Registers the service worker and shows an "install the app" button (Android/desktop) or a hint (iPhone). */
(function () {
  if ('serviceWorker' in navigator) addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* unsupported context */ }); });

  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  var dismissed = false; try { dismissed = localStorage.getItem('nuvvo_install_x') === '1'; } catch (e) { /* storage blocked */ }
  if (dismissed) return;

  function pill(text, onGo) {
    var b = document.createElement('div'); b.className = 'install';
    b.innerHTML = '<span></span><button type="button" class="go"></button><button type="button" class="x" aria-label="إغلاق">×</button>';
    b.firstChild.textContent = text;
    var go = b.querySelector('.go'); go.textContent = onGo ? 'تثبيت' : 'تمام';
    go.onclick = function () { if (onGo) onGo(); b.remove(); };
    b.querySelector('.x').onclick = function () { try { localStorage.setItem('nuvvo_install_x', '1'); } catch (e) { /* ignore */ } b.remove(); };
    document.body.appendChild(b);
  }

  var deferred = null;
  addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    pill('ثبّت Nuvvo كتطبيق على جهازك', function () { deferred.prompt(); deferred = null; });
  });
  addEventListener('appinstalled', function () { var p = document.querySelector('.install'); if (p) p.remove(); });

  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (ios) setTimeout(function () { pill('عشان تثبّته: اضغط زرار المشاركة ثم "إضافة إلى الشاشة الرئيسية"', null); }, 2500);
})();
