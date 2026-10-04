// English / Español for the whole app. The switch is on the front page
// (Sign In card and the launcher header); the choice is kept on this
// device in localStorage 'xf_lang' and every page follows it. Training has
// its own English/Spanish text and keeps 'picker-lang' — the two stay in
// sync (setting either one sets both).
//
// English (the default): nothing here touches the page at all.
// Español: words on the screen are swapped by looking them up in the
// dictionary (xf-lang-es.js, only downloaded when Spanish is on). A
// MutationObserver also swaps everything the pages draw later in JS, and
// alert / confirm / prompt messages are swapped too.
//
// Only the words a person reads change. Never touched: anything that is
// not in the dictionary (part #s, UPCs, locations, names, numbers), input
// and textarea values, anything inside [data-no-xl], and nothing ever sent
// to the Worker. A text that looks like a part # / UPC / location is never
// looked up at all.
//
// Adding a phrase: add one line to xf-lang-es.js (see the notes at its
// top), then bump DICT_V below.
(function () {
  var KEY = 'xf_lang', TRAINING_KEY = 'picker-lang';
  var DICT_V = '20261005a';
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var put = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

  var lang = get(KEY) === 'es' ? 'es' : 'en';
  if (get(KEY) && get(TRAINING_KEY) !== lang) put(TRAINING_KEY, lang); // Training follows the switch

  // Training has both languages built in — keep its own toggle, and make
  // that toggle set the app-wide choice too.
  var selfTranslated = function () { return /(^|\/)training\.html$/.test(location.pathname); };

  var XF = window.XFLang = {
    lang: lang,
    // Change the language: Spanish switches the page now; English reloads
    // it so every screen is exactly the original English again.
    set: function (l) {
      l = l === 'es' ? 'es' : 'en';
      put(KEY, l); put(TRAINING_KEY, l);
      if (l === XF.lang) return;
      if (l === 'en') { location.reload(); return; }
      XF.lang = 'es';
      markSwitch();
      if (selfTranslated()) { if (typeof window.setLang === 'function') window.setLang('es'); return; }
      if (dictReady) start(); else loadDict(true);
    },
    // Translate one string (returns it unchanged when there is no match).
    t: function (s) { var r = XF.lang === 'es' ? tr(s) : null; return r == null ? s : r; },
    // Called by xf-lang-es.js (and anything that adds phrases later).
    add: function (dict) { addDict(dict); }
  };

  // ── Dictionary ──────────────────────────────────────────────────────────
  // D: exact phrase → Spanish. DL: same, lower-case keys (for "STOCK OUT").
  // P: phrases with {n} (a number) or {} (any text, kept exactly as is).
  var D = Object.create(null), DL = Object.create(null), P = [], cache = new Map();
  var esc = function (s) { return s.replace(/[.*+?^$()|[\]\\]/g, '\\$&'); };
  function addDict(dict) {
    Object.keys(dict || {}).forEach(function (k) {
      var v = dict[k], key = String(k).trim().replace(/\s+/g, ' ');
      if (typeof v !== 'string' || !key) return;
      if (/\{(n|)\}/.test(key)) {
        var re = '^' + key.split(/(\{n\}|\{\})/).map(function (p) {
          return p === '{n}' ? '([-+]?[\\d.,]+)' : p === '{}' ? '(.+?)' : esc(p).replace(/ /g, '\\s+');
        }).join('') + '$';
        var need = key.split(/\{n?\}/).sort(function (a, b) { return b.length - a.length; })[0]; // quick pre-check
        P.push({ re: new RegExp(re), to: v, lit: key.replace(/\{n?\}/g, '').length, need: need });
      } else { D[key] = v; DL[key.toLowerCase()] = v; }
    });
    P.sort(function (a, b) { return b.lit - a.lit; }); // most specific first
    cache.clear();
  }
  function fill(to, m) {
    var i = 1;
    return to.replace(/\{(n|\d|)\}/g, function (_, w) { return /\d/.test(w) ? (m[+w] || '') : (m[i++] || ''); });
  }

  // Things that are data, never words: part #s (30-3-4=10X, 27-3-4C),
  // UPCs, location codes (C1=11-2-10, BARN=…), plain numbers.
  var DATA = /^(?:[\d\s.,:$%#+\/×x-]+|[A-Z0-9]{1,6}=\S*|\d+(?:-\d+){1,3}[A-Za-z]*(?:=\S*)?|\d{8,14}|[A-Z]{1,4}\d[\w-]*)$/;
  var LETTER = /[A-Za-z]/;
  var DECOR = /^([^A-Za-z0-9À-ÖØ-öø-ɏ]*)([\s\S]*?)([^A-Za-z0-9À-ÖØ-öø-ɏ)]*)$/; // letters incl. á é ñ — not × ÷

  function caseLike(src, out) {
    if (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase()) return out.toUpperCase();
    return out;
  }
  function one(t) { // one phrase, already trimmed
    if (!t || !LETTER.test(t) || DATA.test(t)) return null;
    if (D[t] != null) return D[t];
    var m = DECOR.exec(t), pre = m[1], core = m[2], suf = m[3];
    if (core && core !== t) { if (D[core] != null) return pre + D[core] + suf; }
    if (!core || DATA.test(core)) return null;
    var lo = core.toLowerCase();
    if (DL[lo] != null) return pre + caseLike(core, DL[lo]) + suf;
    for (var i = 0; i < P.length; i++) {
      if (t.indexOf(P[i].need) === -1) continue;
      var x = P[i].re.exec(t);
      if (x) return fill(P[i].to, x);
      if (core !== t && (x = P[i].re.exec(core))) return pre + fill(P[i].to, x) + suf;
    }
    // "box(es)" when only "box" is listed → "caja(s)"
    var pl = /^(.+?)\(e?s\)$/.exec(core), b = pl && (D[pl[1]] != null ? D[pl[1]] : DL[pl[1].toLowerCase()]);
    if (b != null) return pre + b + (/[aeiouáéó]$/i.test(b) ? '(s)' : '(es)') + suf;
    return null;
  }
  // Two known halves ("box(es)" + "left") when the whole isn't listed.
  function halves(t) {
    var w = t.split(' ');
    for (var i = w.length - 1; i > 0; i--) {
      var a = one(w.slice(0, i).join(' ')), c = a != null && one(w.slice(i).join(' '));
      if (a != null && c) return a + ' ' + c;
    }
    return null;
  }
  // A line made of several pieces ("3 item(s) · Stock Out · C1=11-2-10"):
  // keep numbers / codes / separators, translate the words between them.
  // "box(es)" / "item(s)" stay one word (not split at the brackets).
  var SPLIT = /(\s+[·•|—–→]\s+|\s*\S*\d\S*\s*|\s*[()[\]:;]\s*)/;
  var PL = /\((e?s)\)/g, unPL = function (x) { return x.replace(/\uE000/g, '(s)').replace(/\uE001/g, '(es)'); };
  function pieces(t) {
    var parts = t.replace(PL, function (_, w) { return w === 's' ? '\uE000' : '\uE001'; }).split(SPLIT), hit = false;
    if (parts.length < 2) return null;
    for (var i = 0; i < parts.length; i++) {
      var p = unPL(parts[i] || ''); parts[i] = p;
      if (!p || !LETTER.test(p) || i % 2) continue;
      var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p), r = one(m[2]);
      if (r == null && m[2].indexOf(' ') > 0 && m[2].length < 60) r = halves(m[2]);
      if (r != null) { parts[i] = m[1] + r + m[3]; hit = true; }
    }
    return hit ? parts.join('') : null;
  }
  function tr(s) {
    if (!s || s.length > 600 || !LETTER.test(s)) return null;
    if (cache.has(s)) return cache.get(s);
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), r = one(m[2].replace(/\s+/g, ' '));
    if (r == null) r = pieces(m[2]);
    if (r == null && m[2].indexOf('\n') !== -1) { // multi-line message (alerts)
      var lines = m[2].split('\n'), any = false;
      lines = lines.map(function (l) { var x = tr(l); if (x != null) any = true; return x == null ? l : x; });
      r = any ? lines.join('\n') : null;
    }
    r = r == null ? null : m[1] + r + m[3];
    if (cache.size > 20000) cache.clear();
    cache.set(s, r);
    return r;
  }

  // ── The page ────────────────────────────────────────────────────────────
  // Never translated: code, typing boxes, things marked data-no-xl, and
  // people's own writing (chat messages, customer message drafts), and
  // labels printed from the page (they stay English).
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, svg: 1, SVG: 1, TEMPLATE: 1, KBD: 1 };
  var SKIP_SEL = '[data-no-xl],#upc-print-container,[contenteditable=""],[contenteditable="true"],.cs-draft-box,.em-question-box,.em-thread-bubble,.em-listing-title';
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var done = new WeakMap(); // text node → the Spanish we put there

  function skipEl(el) { return SKIP_TAGS[el.nodeName] || (el.matches && el.matches(SKIP_SEL)); }
  function inSkipped(n) {
    var el = n.nodeType === 1 ? n : n.parentNode;
    return !el || (el.closest && !!el.closest(SKIP_SEL + ',script,style,textarea,code,pre,noscript,svg,template,kbd'));
  }
  function doText(n) {
    var v = n.data; if (done.get(n) === v) return;
    var r = tr(v);
    if (r != null && r !== v) { done.set(n, r); n.data = r; }
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v) continue;
      var r = tr(v); if (r != null && r !== v) el.setAttribute(a, r);
    }
    // An <option> with no value="" reads its text as its value — keep that
    // value in English so the page's code still sees the same thing.
    if (el.nodeName === 'OPTION' && !el.hasAttribute('value') && tr(el.textContent) != null) el.setAttribute('value', el.textContent);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!inSkipped(root)) doText(root); return; }
    if (root.nodeType !== 1) return;
    if (inSkipped(root)) { if (/^(INPUT|TEXTAREA)$/.test(root.nodeName) && !inSkipped(root.parentNode)) doAttrs(root); return; }
    doAttrs(root);
    var w = document.createTreeWalker(root, 5 /* elements + text */, {
      acceptNode: function (n) {
        if (n.nodeType !== 1 || !skipEl(n)) return 1;
        if ((n.nodeName === 'INPUT' || n.nodeName === 'TEXTAREA') && !n.matches(SKIP_SEL)) doAttrs(n); // its placeholder / title only
        return 2; // reject subtree
      }
    });
    var n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  var obs = null;
  function start() {
    if (obs || XF.lang !== 'es' || selfTranslated()) return;
    obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
        else if (m.type === 'characterData') { if (!inSkipped(m.target)) doText(m.target); }
        else if (m.target.nodeType === 1 && (!inSkipped(m.target) || (/^(INPUT|TEXTAREA)$/.test(m.target.nodeName) && !inSkipped(m.target.parentNode)))) doAttrs(m.target);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    walk(document.documentElement);
    document.documentElement.lang = 'es';
    // Pop-up messages from the pages: same dictionary.
    ['alert', 'confirm', 'prompt'].forEach(function (f) {
      var orig = window[f]; if (!orig || orig._xl) return;
      var w = function (msg) { var a = [].slice.call(arguments); if (a.length) a[0] = XF.t(String(msg == null ? '' : msg)); return orig.apply(window, a); };
      w._xl = 1; window[f] = w;
    });
  }

  var dictReady = false;
  XF._ready = function () { dictReady = true; start(); };
  function loadDict(now) {
    var src = 'xf-lang-es.js?v=' + DICT_V;
    if (!now && document.readyState === 'loading') { document.write('<script src="' + src + '"><\/script>'); return; }
    var s = document.createElement('script'); s.src = src; (document.head || document.documentElement).appendChild(s);
  }

  // The English / Español buttons ([data-xf-lang="en"|"es"]) on the front page.
  function markSwitch() {
    [].forEach.call(document.querySelectorAll('[data-xf-lang]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-xf-lang') === XF.lang ? 'true' : 'false');
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    markSwitch();
    if (selfTranslated()) {
      var orig = window.setLang;
      if (typeof orig === 'function') window.setLang = function (l) { orig(l); put(KEY, l === 'es' ? 'es' : 'en'); XF.lang = l === 'es' ? 'es' : 'en'; };
    }
  });

  if (lang === 'es' && !selfTranslated()) loadDict(false);
})();
