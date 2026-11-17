/* Scientific calculator engine. No eval: a small recursive-descent parser over the text the keypad builds. */
(function () {
  var FUNCS = ['asin(', 'acos(', 'atan(', 'sinh(', 'cosh(', 'tanh(', 'sin(', 'cos(', 'tan(', 'ln(', 'log(', '√(', '∛(', 'abs(', 'exp('];

  function tokenize(s) {
    var t = [], i = 0, m;
    while (i < s.length) {
      var c = s[i];
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) { m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw 0; t.push({ k: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      var f = FUNCS.filter(function (x) { return s.indexOf(x, i) === i; })[0];
      if (f) { t.push({ k: 'f', v: f.slice(0, -1) }); t.push({ k: '(' }); i += f.length; continue; }
      if (s.indexOf('Ans', i) === i) { t.push({ k: 'c', v: 'Ans' }); i += 3; continue; }
      if (c === 'π') { t.push({ k: 'n', v: Math.PI }); i++; continue; }
      if (c === 'e') { t.push({ k: 'n', v: Math.E }); i++; continue; }
      if (c === '(' || c === ')') { t.push({ k: c }); i++; continue; }
      if ('+−-×÷*/^!%²³'.indexOf(c) >= 0) { t.push({ k: 'o', v: c === '-' ? '−' : c === '*' ? '×' : c === '/' ? '÷' : c }); i++; continue; }
      throw 0;
    }
    return t;
  }

  function evaluate(src, opt) {
    opt = opt || {};
    var toks = tokenize(String(src)), p = 0, deg = !!opt.deg;
    function peek() { return toks[p]; }
    function isOp(v) { var t = toks[p]; return t && t.k === 'o' && (v === undefined || t.v === v); }
    function startsPrimary() { var t = toks[p]; return t && (t.k === 'n' || t.k === 'c' || t.k === 'f' || t.k === '('); }
    function fact(n) { if (n < 0 || n !== Math.floor(n) || n > 170) throw 0; var r = 1; for (var i = 2; i <= n; i++) r *= i; return r; }
    function toRad(x) { return deg ? x * Math.PI / 180 : x; }
    function fromRad(x) { return deg ? x * 180 / Math.PI : x; }
    var F = {
      sin: function (x) { return Math.sin(toRad(x)); }, cos: function (x) { return Math.cos(toRad(x)); }, tan: function (x) { return Math.tan(toRad(x)); },
      asin: function (x) { return fromRad(Math.asin(x)); }, acos: function (x) { return fromRad(Math.acos(x)); }, atan: function (x) { return fromRad(Math.atan(x)); },
      sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, ln: Math.log, log: Math.log10, '√': Math.sqrt, '∛': Math.cbrt, abs: Math.abs, exp: Math.exp
    };
    function expr() {
      var v = term();
      while (isOp('+') || isOp('−')) { var o = toks[p++].v; var r = term(); v = o === '+' ? v + r : v - r; }
      return v;
    }
    function term() {
      var v = unary();
      for (;;) {
        if (isOp('×') || isOp('÷')) { var o = toks[p++].v, r = unary(); if (o === '÷' && r === 0) throw 0; v = o === '×' ? v * r : v / r; }
        else if (startsPrimary()) v = v * unary();                       // 2π, 3(4+1), 2sin(30)
        else return v;
      }
    }
    function unary() {
      if (isOp('−')) { p++; return -unary(); }
      if (isOp('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      var b = postfix();
      if (isOp('^')) { p++; var e = unary(); return Math.pow(b, e); }
      return b;
    }
    function postfix() {
      var v = primary();
      while (isOp('!') || isOp('%') || isOp('²') || isOp('³')) {
        var o = toks[p++].v;
        v = o === '!' ? fact(v) : o === '%' ? v / 100 : o === '²' ? v * v : v * v * v;
      }
      return v;
    }
    function primary() {
      var t = toks[p++];
      if (!t) throw 0;
      if (t.k === 'n') return t.v;
      if (t.k === 'c') { if (typeof opt.ans !== 'number' || !isFinite(opt.ans)) throw 0; return opt.ans; }
      if (t.k === 'f') { p++; var a = expr(); if (peek() && peek().k === ')') p++; return F[t.v](a); }   // p++ skips the "(" the tokenizer added
      if (t.k === '(') { var v = expr(); if (peek() && peek().k === ')') p++; return v; }              // an unclosed ( at the end is closed for you
      throw 0;
    }
    var out = expr();
    if (p < toks.length) throw 0;
    if (typeof out !== 'number' || !isFinite(out)) throw 0;
    return out;
  }

  function fmt(x) {
    if (Math.abs(x) < 1e-12) return '0';
    var s = Math.abs(x) >= 1e15 || Math.abs(x) < 1e-6 ? x.toExponential(9) : String(Number(x.toPrecision(12)));
    return s.replace(/\.?0+e/, 'e').replace('e+', 'e').replace('-', '−');
  }

  window.NuvvoCalc = { evaluate: evaluate, fmt: fmt };
})();
