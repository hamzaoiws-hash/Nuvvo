/* Fills the contact e-mail from config.js and shows today's date as "last update". */
(function () {
  var c = (window.CH_CONFIG && CH_CONFIG.contactEmail) || '';
  var m = document.getElementById('mail'), p = document.getElementById('contact');
  if (c && m) { m.textContent = c; m.href = 'mailto:' + c; } else if (p) { p.hidden = true; }
  var d = document.getElementById('d');
  if (d) d.textContent = document.lastModified ? new Date(document.lastModified).toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'ar-EG') : '';
})();
