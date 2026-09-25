// Pages & tabs a signed-in person may NOT see — set per level or per person
// in Admin → 🧩 Pages & Tabs, stored by the worker (access_rules), and
// applied here on every page: blocked app cards disappear from the front
// page, blocked tabs disappear from their page, and a blocked page shows a
// "no access" screen. Owners always see everything.
//
// XF_ACCESS_CATALOG is the single list of pages and tabs (the Admin page
// reads it too). `needs` = the permission box that page/tab already
// requires. `card` = the launcher card on the front page; `sel` = the tab
// button on the page. Keys must match what's saved (page / page:tab).
// ← Apps on every page calls xfGoHome(): always a fresh load of the front
// page (already on it, e.g. inside Messenger → reload it). And when the
// browser brings a page back from its back/forward memory, reload it so
// nobody works on a stale screen.
window.xfGoHome = function () {
  var home = /(^|\/)(index\.html)?$/.test(location.pathname);
  if (home) location.reload(); else location.href = 'index.html';
};
window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });

(function () {
  var WORKER = 'https://xfitting-lookup.alfixedinc88.workers.dev';
  var card = function (s) { return '.launcher-card[onclick*="' + s + '"]'; };
  var CATALOG = [
    { key: 'warehouse', file: 'warehouse.html', name: '📍 Warehouse Lookup', needs: 'Ops / Mobile / Mgmt', card: card('warehouse.html'), tabs: [
      { key: 'locator', label: '📍 Item Locator', sel: '.tabitem[onclick="switchTab(\'locator\')"]' },
      { key: 'search', label: '🔍 Item Search', sel: '.tabitem[onclick="switchTab(\'search\')"]' },
      { key: 'awd', label: '🚛 AWD Lookup', sel: '.tabitem[onclick="switchTab(\'awd\')"]' },
      { key: 'oos', label: '📊 Stock Levels', sel: '.tabitem[onclick="switchTab(\'oos\')"]' }] },
    { key: 'awd', file: 'awd.html', name: '🚛 AWD Planner', needs: 'Ops / Mgmt', card: card('awd.html'), tabs: [
      { key: 'upload', label: 'Import Reports', sel: '#tab-upload' },
      { key: 'dashboard', label: 'Dashboard', sel: '#tab-dashboard' },
      { key: 'inventory', label: 'Inventory', sel: '#tab-inventory' },
      { key: 'recommendations', label: 'Recommendations', sel: '#tab-recommendations' },
      { key: 'builder', label: 'Shipment Builder', sel: '#tab-builder' },
      { key: 'settings', label: 'Settings', sel: '#tab-settings' }] },
    { key: 'upc', file: 'upc.html', name: '🏷️ UPC Barcodes', needs: 'Ops / Mobile / Mgmt', card: card('upc.html'), tabs: [] },
    { key: 'inventory', file: 'inventory.html', name: '📋 Inventory', needs: 'Ops / Mobile / Mgmt', card: card('inventory.html'), tabs: [
      { key: 'stockout', label: '📤 Stock Out', sel: '#inv-tab-stockout' },
      { key: 'scan', label: '📦 Stock In / Found on Shelf', sel: '#inv-tab-scan' },
      { key: 'transfer', label: 'Transfer', sel: '#inv-tab-transfer' },
      { key: 'audit', label: '🔍 Audit', sel: '#inv-tab-audit' },
      { key: 'review', label: 'Review', sel: '#inv-tab-review', needs: 'Mgmt' },
      { key: 'skumgr', label: '📋 SKU Mgr', sel: '#inv-tab-skumgr', needs: 'Mgmt' },
      { key: 'history', label: '📜 History', sel: '#inv-tab-history', needs: 'Mgmt' },
      { key: 'soldout', label: '🚫 Sold Out', sel: '#inv-tab-soldout', needs: 'Mgmt' }] },
    { key: 'packship', file: 'packship.html', name: '📦 Pack & Ship', needs: 'any sign-in', card: card('packship.html'), tabs: [
      { key: 'picking', label: '🧺 Picking', sel: '#ps-tab-picking' },
      { key: 'scan', label: '📦 Packing', sel: '#ps-tab-scan' },
      { key: 'closebatch', label: '🚐 Close Batch', sel: '#ps-tab-closebatch' },
      { key: 'cancellation', label: '🗑️ Cancellation', sel: '#ps-tab-cancellation' },
      { key: 'progress', label: '📊 Progress', sel: '#ps-tab-progress' },
      { key: 'lookup', label: '🔍 Lookup', sel: '#ps-tab-lookup' },
      { key: 'orderlookup', label: '📋 Order Lookup', sel: '#ps-tab-orderlookup' },
      { key: 'status', label: '📡 Status Check', sel: '#ps-tab-status', needs: 'Mgmt' },
      { key: 'gaps', label: '⚠️ Gap Report', sel: '#ps-tab-gaps', needs: 'Mgmt' },
      { key: 'undelivered', label: '📦 Undelivered Report', sel: '#ps-tab-undelivered', needs: 'Mgmt' },
      { key: 'vsync', label: '🔄 Veeqo Sync', sel: '#ps-tab-vsync', needs: 'Mgmt' },
      { key: 'autolabel', label: '🤖 Auto Label', sel: '#ps-tab-autolabel', needs: 'Mgmt' },
      { key: 'valerts', label: '🚨 Alerts', sel: '#ps-tab-valerts', needs: 'Mgmt' },
      { key: 'printlog', label: '🖨️ Print Log', sel: '#ps-tab-printlog' }] },
    { key: 'messenger', file: 'index.html', name: '💬 Messenger', needs: 'any sign-in', card: card("launchApp('messenger')"), tabs: [] },
    { key: 'training', file: 'training.html', name: '🎓 Training', needs: 'any sign-in', card: card('training.html'), tabs: [] },
    { key: 'repricer', file: 'repricer.html', name: '💰 eBay Repricer', needs: 'Ops / Mgmt', card: card('repricer.html'), tabs: [
      { key: 'listings', label: '📦 Active Listings', sel: '#tab-listings', needs: 'Mgmt' },
      { key: 'research', label: '🔍 Price Research', sel: '#tab-research', needs: 'Mgmt' },
      { key: 'decision', label: '💰 Price Decision', sel: '#tab-decision', needs: 'Mgmt' },
      { key: 'velocity', label: '📈 Velocity', sel: '#tab-velocity', needs: 'Mgmt' },
      { key: 'approval', label: '⚠️ Approval Queue', sel: '#tab-approval', needs: 'Mgmt' },
      { key: 'pricealerts', label: '🏷️ Price Alerts', sel: '#tab-pricealerts', needs: 'Mgmt' },
      { key: 'skulookup', label: '🔎 SKU Lookup', sel: '#tab-skulookup' },
      { key: 'returns', label: '📦 Returns', sel: '#tab-returns', needs: 'Mgmt' },
      { key: 'calculator', label: '🧮 Price Calculator', sel: '#tab-calculator', needs: 'Mgmt' }] },
    { key: 'labelprint', file: 'labelprint.html', name: '🏷️ Label Printer', needs: 'Ops / Mobile / Mgmt', card: card('labelprint.html'), tabs: [] },
    { key: 'reorder', file: 'reorder.html', name: '📦 Reorder Planner', needs: 'Mgmt', card: card('reorder.html'), tabs: [
      { key: 'upload', label: 'Upload Reports', sel: '#ro-tab-upload' },
      { key: 'jq', label: 'JQ Vendor', sel: '#ro-tab-jq' },
      { key: 'eff', label: 'EFF Vendor', sel: '#ro-tab-eff' },
      { key: 'po', label: '📦 PO Cases', sel: '#ro-tab-po' },
      { key: 'ai', label: '✦ AI Insights', sel: '#ro-tab-ai' },
      { key: 'skumap', label: '🔗 SKU Map', sel: '#ro-tab-skumap' },
      { key: 'podash', label: '🎯 PO Recommendations', sel: '#ro-tab-podash' }] },
    { key: 'sales', file: 'sales.html', name: '📊 Sales Dashboard', needs: 'Mgmt', card: card('sales.html'), tabs: [
      { key: 'overview', label: 'Overview', sel: '#db-tab-overview' },
      { key: 'parts', label: 'Part# Detail', sel: '#db-tab-parts' },
      { key: 'skus', label: 'SKU Detail', sel: '#db-tab-skus' },
      { key: 'ai', label: '✦ AI Insights', sel: '#db-tab-ai' }] },
    { key: 'receivepo', file: 'receivepo.html', name: '🚚 Receive PO', needs: 'Mgmt', card: card('receivepo.html'), tabs: [] },
    { key: 'msginbox', file: 'index.html', name: '📥 Message Inbox', needs: 'Mgmt', card: card("salesLaunchApp('msginbox')"), tabs: [] },
    { key: 'ebaymsgs', file: 'index.html', name: '🤖 AI Customer Support', needs: 'Mgmt', card: card("salesLaunchApp('ebaymsgs')"), tabs: [] },
    { key: 'ldash', file: 'ldash.html', name: '🏢 Leadership Dashboard', needs: 'Mgmt', card: card('ldash.html'), tabs: [
      { key: 'critical', label: '🔴 Critical Stock', sel: '#ldash-ih-btn-critical' },
      { key: 'discrepancy', label: '⚠️ Discrepancies', sel: '#ldash-ih-btn-discrepancy' },
      { key: 'pending', label: '🕐 Pending Reviews', sel: '#ldash-ih-btn-pending' }] },
  ];
  window.XF_ACCESS_CATALOG = CATALOG;

  var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (file === 'xfitting-admin.html') return; // the Admin page is gated by the Admin permission itself
  var here = CATALOG.filter(function (p) { return p.file === file && file !== 'index.html'; })[0];

  function token() { try { return localStorage.getItem('xf_cred_token') || ''; } catch (e) { return ''; } }
  var blocked = null, lastToken = null, loading = false;
  try {
    var c = JSON.parse(sessionStorage.getItem('xf_access') || 'null');
    if (c && c.token === token() && Date.now() - c.at < 10 * 60000) { blocked = c.blocked; lastToken = c.token; }
  } catch (e) {}

  function hide(el) { if (el && el.style.display !== 'none') { el.dataset.xfHidden = '1'; el.style.display = 'none'; } }
  function show(el) { if (el && el.dataset.xfHidden) { delete el.dataset.xfHidden; el.style.display = ''; } }
  function isActive(el) { return /\b(active|iactive|sel)\b/.test(el.className || ''); }

  function apply() {
    var set = {}; (blocked || []).forEach(function (k) { set[k] = 1; });
    // Front page: app cards.
    if (file === 'index.html' || file === '') {
      CATALOG.forEach(function (p) {
        document.querySelectorAll(p.card).forEach(function (el) { set[p.key] ? hide(el) : show(el); });
      });
    }
    if (!here) return;
    // Whole page blocked.
    var ov = document.getElementById('xf-access-block');
    if (set[here.key]) {
      if (!ov && document.body) {
        ov = document.createElement('div'); ov.id = 'xf-access-block';
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#F4F5F7;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif';
        ov.innerHTML = '<div style="max-width:380px;text-align:center;background:#fff;border:1px solid #DFE2E7;border-radius:14px;padding:28px 24px">'
          + '<div style="font-size:34px">🔒</div><h2 style="margin:8px 0 6px;font-size:18px;color:#131A2A">No access to this page</h2>'
          + '<p style="margin:0 0 18px;font-size:13.5px;color:#4B5565">Your account isn\'t set up to use ' + here.name.replace(/^\S+\s/, '') + '. Ask the owner if you need it.</p>'
          + '<a href="index.html" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#1A56DB;color:#fff;text-decoration:none;font-weight:600;font-size:14px">← Apps</a></div>';
        document.body.appendChild(ov);
      }
      return;
    } else if (ov) ov.remove();
    // Tabs.
    var fallback = null;
    here.tabs.forEach(function (t) {
      document.querySelectorAll(t.sel).forEach(function (el) {
        if (set[here.key + ':' + t.key]) {
          if (isActive(el)) fallback = fallback || 'need';
          hide(el);
        } else { show(el); }
      });
    });
    // If the tab that's open is now hidden, open the first one still allowed.
    if (fallback) {
      for (var i = 0; i < here.tabs.length; i++) {
        var t = here.tabs[i];
        if (set[here.key + ':' + t.key]) continue;
        var el = document.querySelector(t.sel);
        if (el && el.style.display !== 'none') { el.click(); break; }
      }
    }
  }

  function load() {
    var t = token();
    if (!t) { blocked = []; lastToken = ''; apply(); return; }
    if (loading) return; loading = true;
    fetch(WORKER + '/auth/access', { headers: { 'X-Cred-Token': t } })
      .then(function (r) { return r.ok ? r.json() : { blocked: [] }; })
      .then(function (d) {
        blocked = d.blocked || []; lastToken = t;
        try { sessionStorage.setItem('xf_access', JSON.stringify({ token: t, blocked: blocked, at: Date.now() })); } catch (e) {}
        apply();
      })
      .catch(function () {})
      .then(function () { loading = false; });
  }

  function tick() {
    if (token() !== lastToken) load();
    else if (blocked) apply();
  }
  if (blocked) { if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply); }
  load();
  setInterval(tick, 1500);
})();

// ── ⌨️ On-screen keyboard for sign-in ─────────────────────────────────────────
// A phone paired with a Bluetooth barcode scanner treats the scanner as a
// keyboard, so the phone's own keyboard stops popping up — nobody can type
// their username / password. Every sign-in box (username, password, and the
// password re-check boxes) gets a "⌨️ Keyboard" link that opens this
// keyboard. Once used, it opens by itself on those boxes (remembered per
// phone) until someone closes it with ✕.
(function () {
  var SEL = 'input[autocomplete="username"], input[type="password"]';
  var PREF = 'xf_osk';
  var kb = null, target = null, shift = 0, sym = false, lastShift = 0, lifted = null;
  var ROWS = [['1','2','3','4','5','6','7','8','9','0'], ['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l'], ['⇧','z','x','c','v','b','n','m','⌫'], ['?123','@','.','space','⏎','✕']];
  var SYM = [['1','2','3','4','5','6','7','8','9','0'], ['!','@','#','$','%','^','&','*','(',')'], ['-','_','=','+','/','\\',':',';','\''], ['"',',','.','?','~','`','[',']','⌫'], ['ABC','{','}','space','⏎','✕']];
  function pref(v) { try { if (v === undefined) return localStorage.getItem(PREF) === '1'; localStorage.setItem(PREF, v ? '1' : '0'); } catch (e) {} return false; }
  function visible(el) { return !!(el && el.offsetParent !== null); }
  function css() {
    if (document.getElementById('xf-osk-css')) return;
    var s = document.createElement('style'); s.id = 'xf-osk-css';
    s.textContent = '#xf-osk{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#d1d5db;padding:6px 4px calc(6px + env(safe-area-inset-bottom));box-shadow:0 -4px 16px rgba(0,0,0,.18);user-select:none;-webkit-user-select:none;touch-action:manipulation;font-family:system-ui,-apple-system,sans-serif}'
      + '#xf-osk .r{display:flex;gap:5px;justify-content:center;margin:0 auto 6px;max-width:560px}'
      + '#xf-osk button{flex:1 1 0;min-width:0;height:44px;border:none;border-radius:7px;background:#fff;color:#111;font-size:19px;box-shadow:0 1px 0 rgba(0,0,0,.25);padding:0;cursor:pointer}'
      + '#xf-osk button:active{background:#9ca3af}'
      + '#xf-osk button.w{background:#aeb4bd;font-size:15px}#xf-osk button.on{background:#1a56db;color:#fff}'
      + '#xf-osk button.sp{flex:4 1 0}#xf-osk button.go{flex:1.6 1 0;background:#1a56db;color:#fff;font-weight:700;font-size:15px;white-space:nowrap}'
      + '#xf-osk .hd{display:flex;align-items:center;gap:8px;max-width:560px;margin:0 auto 6px;font-size:13px;color:#374151;padding:0 4px}'
      + '#xf-osk .hd b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.xf-osk-link{display:inline-block;margin:-6px 0 10px;font-size:13px;color:#1a56db;background:none;border:none;padding:4px 0;cursor:pointer;text-decoration:underline}';
    document.head.appendChild(s);
  }
  function label(el) {
    if (!el) return '';
    var what = el.type === 'password' ? 'Password' : 'Username';
    var v = el.type === 'password' ? el.value.replace(/./g, '•') : el.value;
    return what + ': ' + (v || '…');
  }
  function draw() {
    if (!kb) return;
    var rows = sym ? SYM : ROWS, up = shift > 0;
    kb.innerHTML = '<div class="hd"><b id="xf-osk-lb"></b></div>' + rows.map(function (r) {
      return '<div class="r">' + r.map(function (k) {
        var t = k, c = '';
        if (k === 'space') { t = 'space'; c = 'sp w'; }
        else if (k === '⏎') { t = target && target.type === 'password' ? 'Sign In' : 'Next'; c = 'go'; }
        else if (k === '⇧') { c = 'w' + (shift ? ' on' : ''); t = shift === 2 ? '⇪' : '⇧'; }
        else if (k === '⌫' || k === '✕' || k === '?123' || k === 'ABC') c = 'w';
        else if (up && k.length === 1) t = k.toUpperCase();
        return '<button type="button" data-k="' + k.replace(/"/g, '&quot;') + '" class="' + c + '">' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</button>';
      }).join('') + '</div>';
    }).join('');
    var lb = document.getElementById('xf-osk-lb'); if (lb) lb.textContent = label(target);
  }
  function type(ch) {
    if (!target) return;
    try {
      var a = target.selectionStart, b = target.selectionEnd;
      if (a == null) throw 0;
      target.setRangeText(ch, a, b, 'end');
    } catch (e) { target.value += ch; }
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function back() {
    if (!target) return;
    try {
      var a = target.selectionStart, b = target.selectionEnd;
      if (a == null) throw 0;
      if (a === b && a > 0) a--;
      target.setRangeText('', a, b, 'end');
    } catch (e) { target.value = target.value.slice(0, -1); }
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function box(el) { // the sign-in card around a box
    var p = el; for (var i = 0; i < 6 && p && p.parentElement; i++) { p = p.parentElement; if (p.querySelector('button:not(.xf-osk-link)')) return p; }
    return el.parentElement;
  }
  function enter() {
    if (!target) return;
    var card = box(target);
    if (target.type !== 'password') {
      var pw = card && card.querySelector('input[type="password"]');
      if (pw && visible(pw)) { focus(pw); return; }
    }
    var btns = card ? [].slice.call(card.querySelectorAll('button')).filter(function (x) { return !x.classList.contains('xf-osk-link') && visible(x) && !x.disabled; }) : [];
    var go = btns.filter(function (x) { return /sign\s*in|log\s*in|login|confirm|verify|unlock|continue|ok\b|submit/i.test(x.textContent); })[0] || btns[0];
    hide(true);
    if (go) go.click();
    else target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  function press(k) {
    if (k === '⌫') back();
    else if (k === '⇧') { var now = Date.now(); shift = shift === 0 ? (now - lastShift < 350 ? 2 : 1) : (shift === 1 && now - lastShift < 350 ? 2 : 0); lastShift = now; }
    else if (k === '?123') sym = true;
    else if (k === 'ABC') sym = false;
    else if (k === 'space') type(' ');
    else if (k === '⏎') { enter(); return; }
    else if (k === '✕') { pref(false); hide(); return; }
    else { type(shift && k.length === 1 ? k.toUpperCase() : k); if (shift === 1) shift = 0; }
    draw();
  }
  function lift(on) { // move a centred sign-in card up so the keyboard doesn't cover it
    if (lifted) { lifted.el.style.paddingBottom = lifted.pb; lifted = null; }
    if (!on || !target || !kb) return;
    var p = target;
    while (p && p !== document.body) { if (getComputedStyle(p).position === 'fixed') break; p = p.parentElement; }
    if (p && p !== document.body) { lifted = { el: p, pb: p.style.paddingBottom }; p.style.paddingBottom = kb.offsetHeight + 'px'; }
    else { try { target.scrollIntoView({ block: 'center' }); } catch (e) {} }
  }
  function show(el) {
    css();
    if (target && target !== el && target.dataset.xfOskIm != null) { target.setAttribute('inputmode', target.dataset.xfOskIm); if (!target.dataset.xfOskIm) target.removeAttribute('inputmode'); delete target.dataset.xfOskIm; }
    target = el;
    if (el.dataset.xfOskIm == null) { el.dataset.xfOskIm = el.getAttribute('inputmode') || ''; el.setAttribute('inputmode', 'none'); } // no double keyboard
    if (!kb) {
      kb = document.createElement('div'); kb.id = 'xf-osk';
      kb.addEventListener('pointerdown', function (e) { var b = e.target.closest('button'); e.preventDefault(); e.xfOsk = 1; if (b) press(b.getAttribute('data-k')); });
      kb.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the sign-in box
      document.body.appendChild(kb);
    }
    kb.style.display = ''; draw(); place(); lift(true);
  }
  // Pin to what's actually on screen (some pages are wider than the phone).
  function place() {
    if (!kb || kb.style.display === 'none') return;
    var v = window.visualViewport;
    if (!v) return;
    kb.style.right = 'auto'; kb.style.bottom = 'auto';
    kb.style.width = v.width + 'px'; kb.style.left = v.offsetLeft + 'px';
    kb.style.top = (v.offsetTop + v.height - kb.offsetHeight) + 'px';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  window.addEventListener('scroll', place, { passive: true });
  function hide(keepPref) {
    if (kb) kb.style.display = 'none';
    lift(false);
    if (target && target.dataset.xfOskIm != null) { if (target.dataset.xfOskIm) target.setAttribute('inputmode', target.dataset.xfOskIm); else target.removeAttribute('inputmode'); delete target.dataset.xfOskIm; }
    target = null;
  }
  function focus(el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } show(el); }
  function isBox(el) { return el && el.matches && el.matches(SEL) && !el.readOnly && !el.disabled; }
  // "⌨️ Keyboard" link under each password box (and under a username box with no password box after it).
  function links() {
    [].slice.call(document.querySelectorAll(SEL)).forEach(function (el) {
      if (el.dataset.xfOsk) return; el.dataset.xfOsk = '1';
      if (el.type !== 'password') { var c = box(el); if (c && c.querySelector('input[type="password"]')) return; }
      css();
      var a = document.createElement('button'); a.type = 'button'; a.className = 'xf-osk-link'; a.textContent = '⌨️ Keyboard';
      a.title = 'On-screen keyboard — use it when a scanner is connected and the phone keyboard doesn\'t come up';
      a.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      a.addEventListener('click', function (e) {
        e.preventDefault(); pref(true);
        var c = box(el), u = c && c.querySelector('input[autocomplete="username"]');
        focus(u && visible(u) && !u.value ? u : el);
      });
      el.insertAdjacentElement('afterend', a);
    });
  }
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (isBox(el)) { if (kb && kb.style.display !== 'none') show(el); else if (pref()) show(el); }
    else if (kb && kb.style.display !== 'none' && !(kb.contains(el))) hide(true);
  });
  // Hide when the sign-in box goes away (signed in) or someone taps elsewhere.
  setInterval(function () { if (target && !visible(target)) hide(true); }, 700);
  document.addEventListener('pointerdown', function (e) {
    if (e.xfOsk || !kb || kb.style.display === 'none' || kb.contains(e.target) || isBox(e.target) || (e.target.closest && e.target.closest('.xf-osk-link'))) return;
    hide(true);
  });
  function start() { links(); setInterval(links, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
