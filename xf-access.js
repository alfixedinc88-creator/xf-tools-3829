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
      { key: 'check', label: '✅ Checking', sel: '#inv-tab-check' },
      { key: 'scan', label: '📦 Stock In / Found on Shelf', sel: '#inv-tab-scan' },
      { key: 'transfer', label: 'Transfer', sel: '#inv-tab-transfer' },
      { key: 'audit', label: '🔍 Audit', sel: '#inv-tab-audit' },
      { key: 'review', label: 'Review', sel: '#inv-tab-review', needs: 'Mgmt' },
      { key: 'skumgr', label: '📋 SKU Mgr', sel: '#inv-tab-skumgr', needs: 'Mgmt' },
      { key: 'location', label: '📍 Location Plan', sel: '#inv-tab-location', needs: 'Mgmt' },
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
    { key: 'labelprint', file: 'labelprint.html', name: '🏷️ Label Printer', needs: 'any sign-in', card: card('labelprint.html'), tabs: [] },
    { key: 'lights', file: 'lights.html', name: '💡 Lights', needs: 'Ops / Mobile / Mgmt', card: card('lights.html'), tabs: [] },
    { key: 'reorder', file: 'reorder.html', name: '📦 Reorder Planner', needs: 'Mgmt', card: card('reorder.html'), tabs: [
      { key: 'reorder', label: '🧾 Reorder', sel: '#ro-tab-reorder' },
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
      .then(function (r) {
        // Pages open straight away with the saved sign-in; this is the check.
        // Signed out / expired → forget it and reload, which shows Sign In.
        if (r.status === 401 && token() === t) {
          try { localStorage.removeItem('xf_cred_token'); localStorage.removeItem('xf_cred_user'); sessionStorage.removeItem('xf_access'); } catch (e) {}
          location.reload();
          return { blocked: [] };
        }
        return r.ok ? r.json() : { blocked: [] };
      })
      .then(function (d) {
        blocked = d.blocked || []; lastToken = t;
        testBanner(d.test);
        if (d.level === 'owner') signinWatch();
        try { sessionStorage.setItem('xf_access', JSON.stringify({ token: t, blocked: blocked, at: Date.now() })); } catch (e) {}
        apply();
      })
      .catch(function () {})
      .then(function () { loading = false; });
  }

  // 🧪 Test switch (Admin → 🧪 Test): while it's on, every page shows an
  // orange frame and a note — anything done now is erased when it's turned off.
  function testBanner(tm) {
    try { sessionStorage.setItem('xf_test', tm && tm.on ? JSON.stringify(tm) : ''); } catch (e) {}
    var el = document.getElementById('xf-test-banner');
    var fr0 = document.getElementById('xf-test-frame'); if (fr0) fr0.remove(); // the orange frame is gone (owner: nothing in the way)
    if (!(tm && tm.on)) { if (el) el.remove(); if (document.body) document.body.style.paddingBottom = document.body.dataset.xfPb || ''; return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { testBanner(tm); }); return; }
    // A thin bar along the very bottom; the page gets that much room at the
    // bottom, so the bar never covers a button or the last line.
    if (!el) { el = document.createElement('div'); el.id = 'xf-test-banner'; document.body.appendChild(el); }
    if (document.body.dataset.xfPb == null) document.body.dataset.xfPb = document.body.style.paddingBottom || '';
    document.body.style.paddingBottom = '26px';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:22px;z-index:2147483647;background:#f59e0b;color:#111;font:700 11px/22px system-ui,sans-serif;padding:0 10px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none';
    var when = ''; try { when = new Date(tm.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) {}
    el.textContent = '🧪 TEST MODE — erased when turned off' + (tm.by ? ' · ' + tm.by + (when ? ' ' + when : '') : '');
  }
  // 🔔 Owner: "notice me when someone signs in to start using our app" — on
  // any app page the Owner has open: a pop-up (and a phone / computer
  // notification if turned on in Admin → 🔔 Sign-ins) for each new sign-in
  // and each sign-in refused because it was not that person's time.
  var watching = false;
  function signinWatch() {
    if (watching) return; watching = true;
    var me = null; try { me = (JSON.parse(localStorage.getItem('xf_cred_user') || 'null') || {}).userId; } catch (e) {}
    var check = function () {
      var t = token(); if (!t) return;
      var seen = 0; try { seen = parseInt(localStorage.getItem('xf_signin_seen')) || 0; } catch (e) {}
      fetch(WORKER + '/admin/signins?limit=20&after=' + seen, { headers: { 'X-Cred-Token': t } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var rows = ((d && d.rows) || []).slice().reverse(); if (!rows.length) return;
        try { localStorage.setItem('xf_signin_seen', String(rows[rows.length - 1].id)); } catch (e) {}
        if (!seen) return; // first time on this device: start from now
        rows.forEach(function (x) {
          if ((x.kind !== 'signin' && x.kind !== 'denied') || x.user_id === me) return;
          var when = new Date(x.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
          var msg = (x.kind === 'denied' ? '⛔ ' + (x.display_name || x.username) + ' tried to sign in — not their time' : '✅ ' + (x.display_name || x.username) + ' signed in') + ' · ' + when + (x.device ? ' · ' + x.device : '') + (x.place ? ' · ' + x.place : '');
          signinToast(msg, x.kind === 'denied');
          try { if (window.Notification && Notification.permission === 'granted') new Notification('XFitting — sign-in', { body: msg, tag: 'xf-signin-' + x.id }); } catch (e) {}
        });
      }).catch(function () {});
    };
    check(); setInterval(check, 60000);
  }
  function signinToast(msg, bad) {
    if (!document.body) return;
    var box = document.getElementById('xf-signin-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'xf-signin-toasts'; box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483646;display:flex;flex-direction:column;gap:6px;max-width:340px'; document.body.appendChild(box); }
    var el = document.createElement('div');
    el.style.cssText = 'background:' + (bad ? '#fee2e2' : '#ecfdf5') + ';color:#111;border:1px solid ' + (bad ? '#f87171' : '#34d399') + ';border-radius:10px;padding:9px 12px;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.15);cursor:pointer';
    el.textContent = '🔔 ' + msg; el.title = 'Admin → 🔔 Sign-ins';
    el.onclick = function () { location.href = 'xfitting-admin.html'; };
    box.appendChild(el); setTimeout(function () { el.remove(); }, 12000);
  }
  try { var tm0 = sessionStorage.getItem('xf_test'); if (tm0) testBanner(JSON.parse(tm0)); } catch (e) {}
  setInterval(function () { if (token()) load(); }, 60000);
  window.xfAccessRefresh = load;

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
  var TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // phones / scanners: never the phone keyboard (owner, 2026-10-06)
  var ROWS = [['1','2','3','4','5','6','7','8','9','0'], ['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l'], ['⇧','z','x','c','v','b','n','m','⌫'], ['?123','@','.','space','⏎','✕']];
  var SYM = [['1','2','3','4','5','6','7','8','9','0'], ['!','@','#','$','%','^','&','*','(',')'], ['-','_','=','+','/','\\',':',';','\''], ['"',',','.','?','~','`','[',']','⌫'], ['ABC','{','}','space','⏎','✕']];
  function pref(v) { if (v === undefined && TOUCH) return true; try { if (v === undefined) return localStorage.getItem(PREF) === '1'; localStorage.setItem(PREF, v ? '1' : '0'); } catch (e) {} return false; }
  function signIn(el) { return !!(el && el.matches && el.matches(SEL)); }
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
    if (!signIn(el)) return 'Typing: ' + (el.value || '…');
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
        else if (k === '⏎') { t = !signIn(target) ? 'Enter' : target.type === 'password' ? 'Sign In' : 'Next'; c = 'go'; }
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
    if (!signIn(target)) { // any other box: ⏎ = the Enter key (search / save), like a scan
      var el = target; hide(true);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return;
    }
    var card = box(target);
    if (target.type !== 'password') {
      var pw = card && card.querySelector('input[type="password"]');
      if (pw && visible(pw)) { focus(pw); return; }
    }
    var btns = card ? [].slice.call(card.querySelectorAll('button')).filter(function (x) { return !x.classList.contains('xf-osk-link') && visible(x) && !x.disabled; }) : [];
    var go = btns.filter(function (x) { return /sign\s*in|log\s*in|login|confirm|verify|unlock|continue|ok\b|submit|entrar|iniciar|confirmar|verificar|desbloquear|continuar|aceptar|enviar/i.test(x.textContent); })[0] || btns[0];
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
    else if (k === '✕') { if (!TOUCH) pref(false); hide(); return; }
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
  function isBox(el) { return el && el.matches && el.matches(SEL) && (!el.readOnly || !!el.dataset.xfKbRo) && !el.disabled; } // xfKbRo = locked for a moment by the no-keyboard tap guard
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
    else if (el === target) return;
    else if (kb && kb.style.display !== 'none' && !(kb.contains(el))) hide(true);
  });
  // Hide when the sign-in box goes away (signed in) or someone taps elsewhere.
  setInterval(function () { if (target && !visible(target)) hide(true); }, 700);
  document.addEventListener('pointerdown', function (e) {
    if (e.xfOsk || !kb || kb.style.display === 'none' || kb.contains(e.target) || isBox(e.target) || e.target === target || (e.target.closest && e.target.closest('.xf-osk-link'))) return;
    hide(true);
  });
  window.xfOskOpen = function (el) { if (!el || (el === target && kb && kb.style.display !== 'none')) return; focus(el); }; // our keyboard on any box (⌨️ button, a page's ⌨ "type it")
  function start() { links(); setInterval(links, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// ── 📷 UPC with its first digit dropped ──────────────────────────────────────
// Some scanners (Farset R20H) send a 12-digit UPC-A without its first digit:
// box 810097207059 comes in as 10097207059. 11 digits whose UPC check digit
// only works with a first digit of 1–9 put that digit back (exactly one
// digit fits). 11 digits that work with a 0 in front are a UPC whose leading
// 0 was dropped — left as they are (the lookups already ignore leading 0s).
// Fixed the moment the scan lands (bulk insert / Enter), before any page reads it.
(function () {
  function okUpc(c) { var t = 0; for (var i = 0; i < 11; i++) t += (+c[i]) * (i % 2 ? 1 : 3); return (10 - t % 10) % 10 === +c[11]; }
  function fix(v) {
    var m = /^(\s*)(\d{11})([\r\n\t]*)$/.exec(String(v == null ? '' : v)); if (!m || okUpc('0' + m[2])) return v;
    for (var d = 1; d <= 9; d++) if (okUpc(d + m[2])) return m[1] + d + m[2] + m[3];
    return v;
  }
  window.xfFixUpc = fix;
  function mend(el) { if (!el || el.tagName !== 'INPUT' || el.type === 'password') return; var f = fix(el.value); if (f !== el.value) el.value = f; }
  window.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) mend(e.target); }, true);
  window.addEventListener('input', function (e) { if (e.data && e.data.length >= 11) mend(e.target); }, true); // the scanner drops the whole number in at once
})();

// ── 🔇 Scanner phone: no pop-up keyboard ─────────────────────────────────────
// On a phone with a built-in scanner the phone keyboard covers half the screen
// every time a scan box is focused. Owner (2026-10-06): "get away of the
// keyboard forever" — on every touch screen it never opens, sign-in included.
// To type: ⌨️ (bottom left) opens OUR on-screen keyboard on the box: typing boxes stop opening the keyboard
// (inputmode="none") but scans still go in.
(function () {
  if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
  var PREF = 'xf_nokb', last = null, open = null;
  var TYPES = /^(text|search|number|tel|email|url)$/i;
  function on() { return true; } // always hidden on touch screens — no setting to turn it back on
  function isBox(el) {
    if (!el || !el.matches) return false;
    if (el.matches('#xf-nokb-pop *, #xf-scantest *')) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TYPES.test(el.getAttribute('type') || 'text');
  }
  // Number boxes (how many cases…) ignore inputmode="none" — phones always
  // open the keyboard for them. While hidden they become plain text boxes
  // (the number typed or scanned stays the same) and turn back on unhide.
  function mute(el) {
    if (el === open) return;
    if (el.dataset.xfKbIm == null) el.dataset.xfKbIm = el.getAttribute('inputmode') || '';
    if (/^number$/i.test(el.getAttribute('type') || '')) { el.dataset.xfKbType = 'number'; try { el.setAttribute('type', 'text'); } catch (e) {} }
    el.setAttribute('inputmode', 'none');
  }
  function unmute(el) {
    if (el.dataset.xfKbType) { try { el.setAttribute('type', el.dataset.xfKbType); } catch (e) {} delete el.dataset.xfKbType; }
    if (el.dataset.xfKbIm == null) return;
    if (el.dataset.xfKbIm) el.setAttribute('inputmode', el.dataset.xfKbIm); else el.removeAttribute('inputmode');
    delete el.dataset.xfKbIm;
  }
  function all(fn) { [].slice.call(document.querySelectorAll('input, textarea')).forEach(function (el) { if (isBox(el)) fn(el); }); }
  function apply() { if (on()) all(mute); else all(unmute); btn(); }
  function btn() {
    var b = document.getElementById('xf-nokb');
    if (!b) {
      b = document.createElement('button'); b.id = 'xf-nokb'; b.type = 'button';
      b.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147482000;width:42px;height:42px;border-radius:50%;border:1.5px solid #9ca3af;background:rgba(255,255,255,.92);font-size:20px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.2);padding:0;cursor:pointer;touch-action:manipulation';
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // keep focus in the scan box
      b.addEventListener('click', function (e) { e.preventDefault(); menu(); });
      document.body.appendChild(b);
    }
    b.textContent = '⌨️';
    b.title = 'Type in a box with our keyboard · test the scanner';
  }
  function close() { var p = document.getElementById('xf-nokb-pop'); if (p) p.remove(); }
  function menu() {
    if (document.getElementById('xf-nokb-pop')) { close(); return; }
    var p = document.createElement('div'); p.id = 'xf-nokb-pop';
    p.style.cssText = 'position:fixed;left:10px;bottom:60px;z-index:2147482001;background:#fff;color:#111;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:8px;width:250px;font:14px system-ui,sans-serif';
    var B = function (txt, fn, main) { var x = document.createElement('button'); x.type = 'button'; x.textContent = txt;
      x.style.cssText = 'display:block;width:100%;text-align:left;margin:3px 0;padding:11px 10px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;' + (main ? 'background:#1a56db;color:#fff' : 'background:#f3f4f6;color:#111');
      x.addEventListener('pointerdown', function (e) { e.preventDefault(); }); x.addEventListener('click', function (e) { e.preventDefault(); close(); fn(); }); p.appendChild(x); };
    B('⌨️ Type in this box (our keyboard)' + (last && document.contains(last) ? '' : ' — tap a box first'), show, true);
    B('🔍 Test the scanner', scanTest);
    if (window.xfStationSet) B(window.xfStation() ? '🔄 Station mode: ON — tap to turn off' : '🔄 Use as a station (upside down, screen stays on)', function () { window.xfStationSet(!window.xfStation()); });
    B('Cancel', function () {});
    document.body.appendChild(p);
  }
  // Type in the box you're on with OUR on-screen keyboard (never the phone's).
  function show() {
    var el = (document.activeElement && isBox(document.activeElement)) ? document.activeElement : last;
    if (!el || !document.contains(el)) { alert('Tap the box you want to type in first, then ⌨️ → Type in this box.'); return; }
    if (window.xfOskOpen) window.xfOskOpen(el);
  }
  // A scan that arrives while no box has the cursor (after a tap on a button,
  // or a scanner that types without a box) goes to the scan box you used last
  // (or the page's 📷 scan box) — never lost, and no box needs the cursor.
  // Not while a pop-up is open (it would land behind it), and not when the
  // page already took the scan (Container here has its own).
  var sBuf = '', sAt = 0, sT = null;
  function shown(el) { if (!el || !document.contains(el) || el.disabled || el.readOnly) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function scanOk(el) { return isBox(el) && el.tagName === 'INPUT' && !el.matches('input[autocomplete="username"], input[type="password"]') && shown(el); } // never into a sign-in box
  function scanBox() {
    if (last && scanOk(last)) return last;
    return [].slice.call(document.querySelectorAll('input')).filter(function (el) { return scanOk(el) && /📷|scan/i.test(el.placeholder || ''); })[0] || null;
  }
  function popupOver(el) {
    return [].slice.call(document.querySelectorAll('[id*="modal"], .modal, [role="dialog"]')).some(function (m) { return m !== el && !m.contains(el) && shown(m) && m.getBoundingClientRect().height > 60; });
  }
  function note(t) {
    var n = document.getElementById('xf-scan-note'); if (!n) { n = document.createElement('div'); n.id = 'xf-scan-note'; n.style.cssText = 'position:fixed;left:60px;right:10px;bottom:12px;z-index:2147482002;background:#111;color:#fff;border-radius:10px;padding:10px 12px;font:600 14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)'; document.body.appendChild(n); }
    n.textContent = t; clearTimeout(n._t); n._t = setTimeout(function () { n.remove(); }, 3500);
  }
  function deliver(code) {
    code = String(window.xfFixUpc ? window.xfFixUpc(code) : code).trim(); if (!code) return;
    var el = scanBox();
    if (!el) { note('📷 Scanned ' + code + ' — tap the scan box, then scan again'); return; }
    if (popupOver(el)) { note('📷 Scanned ' + code + ' — finish / close the pop-up first, then scan again'); return; }
    el.value = code;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  // The scan button itself: the Farset R20H sends F10 (keyCode 121), the
  // Svantto MC002 code F21 (key "Unidentified", keyCode 0), while the
  // trigger is held, then drops the number into the box that has the cursor —
  // with no box selected the number is lost and Chrome opens its menu (F10).
  // So the trigger puts the cursor in the scan box before the beep, and
  // Chrome's menu stays shut.
  // Svantto MC002: its scan button is key "Unidentified", code F21, keyCode 0 — same as F10 below.
  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted || !/^F(1[3-9]|2[0-4])$/.test(e.code || '')) return;
    e.preventDefault();
    if (document.getElementById('xf-scantest')) return;
    var a = document.activeElement, tag = a && a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
    var el = scanBox(); if (el && !popupOver(el)) el.focus({ preventScroll: true });
  }, true);
  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted || !(e.keyCode === 121 || /^F(9|1[0-2])$/.test(e.key || ''))) return;
    e.preventDefault();
    if (document.getElementById('xf-scantest')) return;
    var a = document.activeElement, tag = a && a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return; // a box already has it
    var el = scanBox(); if (el && !popupOver(el)) el.focus({ preventScroll: true }); // muted first by the focus() hook → no keyboard
  }, true);
  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted || e.defaultPrevented || document.getElementById('xf-scantest')) { sBuf = ''; return; } // our own Enter (deliver) is not a scan
    var a = document.activeElement, tag = a && a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) { sBuf = ''; return; } // the box takes it
    var now = Date.now();
    if (e.key === 'Enter' || e.keyCode === 13) { clearTimeout(sT); var c = sBuf; sBuf = ''; if (c.length >= 3) { e.preventDefault(); deliver(c); } return; }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (now - sAt > 120) sBuf = ''; // a scanner types fast; a person typing slowly is not a scan
      sBuf += e.key; sAt = now; clearTimeout(sT);
      sT = setTimeout(function () { var c = sBuf; sBuf = ''; if (c.length >= 6) deliver(c); }, 300); // a scanner that sends no Enter
    }
  });
  // 🔍 Scanner test: shows exactly what a scanner sends (keys, Enter, text) —
  // a photo of it tells us which setting a new scanner needs.
  function scanTest() {
    if (document.getElementById('xf-scantest')) return;
    var w = document.createElement('div'); w.id = 'xf-scantest';
    w.style.cssText = 'position:fixed;inset:0;z-index:2147483100;background:#fff;color:#111;display:flex;flex-direction:column;font:14px system-ui,sans-serif;padding:12px';
    w.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:17px">🔍 Scanner test</b><button type="button" data-a="x" style="padding:10px 16px;border-radius:8px;border:none;background:#1a56db;color:#fff;font-weight:700">Close</button></div>'
      + '<div style="margin:6px 0;color:#374151">Scan any label. Every key / text the scanner sends shows below. Then tap "Cursor in a box" and scan again. Send a photo of this screen.</div>'
      + '<div style="display:flex;gap:6px;align-items:center"><button type="button" data-a="box" style="padding:10px;border-radius:8px;border:1.5px solid #9ca3af;background:#f3f4f6;font-weight:600">Cursor in a box</button><input id="xf-st-in" type="text" inputmode="none" autocomplete="off" placeholder="(test box)" style="flex:1;min-width:0;padding:10px;border:2px solid #1a56db;border-radius:8px;font:16px monospace"></div>'
      + '<div id="xf-st-log" style="flex:1;overflow:auto;margin-top:8px;font:13px/1.45 monospace;white-space:pre-wrap;background:#f9fafb;border-radius:8px;padding:8px"></div>';
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} // start with nothing selected
    document.body.appendChild(w);
    var log = w.querySelector('#xf-st-log'), inp = w.querySelector('#xf-st-in'), t0 = 0, lines = [];
    var where = function () { var a = document.activeElement; return a === inp ? 'box' : a && a !== document.body ? (a.tagName || '').toLowerCase() : 'nothing'; };
    var add = function (t) { var now = Date.now(); lines.unshift('+' + (t0 ? now - t0 : 0) + 'ms ' + t + '  [cursor: ' + where() + ']'); t0 = now; lines = lines.slice(0, 40); log.textContent = lines.join('\n'); };
    var q = function (v) { return JSON.stringify(String(v == null ? '' : v)); };
    var H = {
      keydown: function (e) { add('keydown key=' + q(e.key) + ' code=' + (e.code || '-') + ' keyCode=' + e.keyCode + (e.altKey ? ' ALT' : '') + (e.ctrlKey ? ' CTRL' : '')); },
      beforeinput: function (e) { add('beforeinput ' + (e.inputType || '') + ' ' + q(e.data)); },
      input: function (e) { add('input ' + (e.inputType || '') + ' ' + q(e.data) + ' → box=' + q(e.target && e.target.value)); },
      compositionend: function (e) { add('compositionend ' + q(e.data)); },
      paste: function (e) { add('paste ' + q(e.clipboardData && e.clipboardData.getData('text'))); }
    };
    Object.keys(H).forEach(function (k) { window.addEventListener(k, H[k], true); });
    w.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.getAttribute('data-a') === 'x') { Object.keys(H).forEach(function (k) { window.removeEventListener(k, H[k], true); }); w.remove(); }
      else { inp.value = ''; mute(inp); inp.focus(); add('— cursor put in the test box —'); }
    });
    add('— ready, nothing selected: scan now —');
  }
  // Mute BEFORE the box gets focus — once the phone has opened its keyboard,
  // changing inputmode is too late. Three ways a box gets focus:
  // the page's own code (.focus() — scan boxes, popups), a tap, and Tab.
  var _focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    try { if (on() && this !== open && isBox(this)) mute(this); } catch (e) {}
    return _focus.apply(this, arguments);
  };
  ['touchstart', 'pointerdown', 'mousedown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var el = e.target; if (on() && el !== open && isBox(el)) { mute(el); guard(el); }
    }, true);
  });
  // Some phones still pop the keyboard for a box focused by a tap: keep it
  // read-only for a moment as it gets focus (scans arrive after that).
  function guard(el) {
    if (el.readOnly || el.dataset.xfKbRo) return;
    el.dataset.xfKbRo = '1'; el.readOnly = true;
    setTimeout(function () { el.readOnly = false; delete el.dataset.xfKbRo; }, 120);
  }
  document.addEventListener('focusin', function (e) {
    var el = e.target; if (!isBox(el)) return;
    last = el; if (on() && el !== open) mute(el);
    if (el.dataset.xfWant && window.xfOskOpen) setTimeout(function () { if (document.activeElement === el) window.xfOskOpen(el); }, 0); // the page asked to type here
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target; if (el !== open) return;
    setTimeout(function () { if (document.activeElement !== el) { open = null; if (on()) mute(el); } }, 50);
  });
  document.addEventListener('pointerdown', function (e) { var p = document.getElementById('xf-nokb-pop'); if (p && !p.contains(e.target) && e.target.id !== 'xf-nokb') close(); });
  var queued = false;
  function start() {
    apply();
    new MutationObserver(function (muts) { // new boxes drawn later (lists, popups): hide their keyboard right away
      if (!on()) return;
      muts.forEach(function (m) { [].forEach.call(m.addedNodes || [], function (n) {
        if (n.nodeType !== 1) return;
        if (isBox(n) && n !== open) mute(n);
        if (n.querySelectorAll) [].forEach.call(n.querySelectorAll('input, textarea'), function (el) { if (isBox(el) && el !== open && el.dataset.xfKbIm == null) mute(el); });
      }); });
      muts.forEach(function (m) { // page code changed a muted box's inputmode / type back: hide again
        var t = m.target; if (m.type !== 'attributes' || t === open || !isBox(t)) return;
        // A page's ⌨ "type it" (data-kb-typing / data-typing, or inputmode switched on) used to open
        // the phone keyboard: now it opens OUR keyboard on that box instead.
        if (m.attributeName === 'inputmode') {
          if (t.getAttribute('inputmode') !== 'none') t.dataset.xfWant = '1';
          else if (m.oldValue === 'none' && !t.hasAttribute('data-kb-typing') && !t.hasAttribute('data-typing')) delete t.dataset.xfWant; // the page set it back to scan-only
        }
        if (t.getAttribute('inputmode') !== 'none' || /^number$/i.test(t.getAttribute('type') || '')) mute(t);
      });
      if (queued) return; queued = true; // boxes made by innerHTML on an existing node
      setTimeout(function () { queued = false; all(function (el) { if (el.dataset.xfKbIm == null && el !== open) mute(el); }); }, 150);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inputmode', 'type'], attributeOldValue: true });
    new MutationObserver(function (muts) { // a page's ⌨ "type it" button → OUR keyboard on that box
      muts.forEach(function (m) {
        var t = m.target; if (!isBox(t)) return;
        if (t.hasAttribute(m.attributeName)) { t.dataset.xfWant = '1'; if (document.activeElement === t && window.xfOskOpen) window.xfOskOpen(t); }
        else if (!t.hasAttribute('data-kb-typing') && !t.hasAttribute('data-typing')) delete t.dataset.xfWant;
      });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-kb-typing', 'data-typing'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// ── 🔄 Station mode (owner, 2026-10-06) ──────────────────────────────────────
// A scanner standing upside down in its cradle as a packing station: every
// app turns upside down so the screen reads the right way, and the screen
// stays on (Wake Lock). Per device (this phone only), switched in the ⌨️ menu
// (bottom left). The scanner's own always-on / motion scan mode is set in
// the scanner's settings app — see docs/SCANNERS.md. Pack & Ship ignores the
// same label read again and again while it sits under the scanner.
(function () {
  var KEY = 'xf_station', lock = null;
  function get() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function css() {
    if (document.getElementById('xf-station-css')) return;
    var st = document.createElement('style'); st.id = 'xf-station-css';
    // html turned 180°; the page scrolls inside body so fixed buttons / pop-ups stay on screen.
    st.textContent = 'html.xf-station{transform:rotate(180deg);transform-origin:50% 50%;height:100%;overflow:hidden}'
      + 'html.xf-station body{height:100%;overflow:auto!important;overscroll-behavior:contain}';
    (document.head || document.documentElement).appendChild(st);
  }
  function wake() {
    if (!get() || document.visibilityState !== 'visible' || lock || !(navigator.wakeLock && navigator.wakeLock.request)) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {});
  }
  function apply() {
    var on = get(); css();
    document.documentElement.classList.toggle('xf-station', on);
    if (on) wake(); else if (lock) { try { lock.release(); } catch (e) {} lock = null; }
  }
  window.xfStation = get;
  window.xfStationSet = function (on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} apply(); };
  document.addEventListener('visibilitychange', wake); // the screen lock drops when the app is hidden: take it again
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); }); // other tabs follow
  apply();
})();
