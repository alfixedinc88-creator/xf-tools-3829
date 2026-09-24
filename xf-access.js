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
