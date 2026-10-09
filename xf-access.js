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
      { key: 'search', label: '🔍 Item Search', sel: '.tabitem[onclick="switchTab(\'search\')"]', parts: [
        { key: 'newproduct', label: '➕ New product', sel: '#pane-search .wp-can[onclick="wpOpen()"]' },
        { key: 'veeqobox', label: '📦 Veeqo full box (19.99 lb) pieces', sel: '#pane-search [data-vb], #pane-search .wp-can[onclick="vbAll()"]' } ] },
      { key: 'awd', label: '🚛 AWD Lookup', sel: '.tabitem[onclick="switchTab(\'awd\')"]' },
      { key: 'oos', label: '📊 Stock Levels', sel: '.tabitem[onclick="switchTab(\'oos\')"]', parts: [
        { key: 'logpo', label: '📋 Log PO Placed', sel: '#pane-oos .oos-header > div > button[onclick*="po-log-form"], #po-log-form' } ] } ] },
    { key: 'awd', file: 'awd.html', name: '🚛 AWD Planner', needs: 'Ops / Mgmt', card: card('awd.html'), tabs: [
      { key: 'upload', label: 'Import Reports', sel: '#tab-upload', parts: [
        { key: 'amzsync', label: '⚡ Sync from Amazon', sel: '#page-upload div:has(> #awd-amazon-sync-btn)' },
        { key: 'csvupload', label: 'Manual CSV Upload', sel: '#page-upload .upload-grid' },
        { key: 'casepack', label: '📐 Case Pack Templates', sel: '#cpack-card' },
        { key: 'demo', label: 'Load Demo Data', sel: '#page-upload button[onclick="loadDemo()"]' },
        { key: 'clear', label: 'Clear Saved Data', sel: '#page-upload button[onclick="clearReportData()"]' } ] },
      { key: 'dashboard', label: 'Dashboard', sel: '#tab-dashboard', parts: [
        { key: 'stats', label: 'Stats', sel: '#stats-grid' },
        { key: 'critical', label: '🚨 Critical SKUs', sel: '#dash-body .card:has(#crit-tbody)' },
        { key: 'toprecs', label: '📋 Top Recommendations', sel: '#dash-body .card:has(#rec-top-tbody)' } ] },
      { key: 'inventory', label: 'Inventory', sel: '#tab-inventory', parts: [
        { key: 'export', label: 'Export CSV', sel: '#page-inventory button[onclick="exportInvCSV()"]' } ] },
      { key: 'recommendations', label: 'Recommendations', sel: '#tab-recommendations', parts: [
        { key: 'addall', label: 'Add All Visible', sel: '#page-recommendations button[onclick="addAllVisible()"]' } ] },
      { key: 'builder', label: 'Shipment Builder', sel: '#tab-builder', parts: [
        { key: 'addsku', label: '＋ Add SKU (manual)', sel: '#page-builder button[onclick="bldShowManualAdd()"], #bld-manual-panel' },
        { key: 'clearall', label: 'Clear All', sel: '#page-builder button[onclick="clearBuilder()"]' },
        { key: 'summary', label: 'Shipment Summary', sel: '.sum-card > .card:has(#sum-items)' },
        { key: 'export', label: 'Export (.txt / .xlsx)', sel: '.sum-card > .card:has(#ship-name)' } ] },
      { key: 'settings', label: 'Settings', sel: '#tab-settings', parts: [
        { key: 'planner', label: 'Planner Settings', sel: '#page-settings > div > .card > :not(.card)' },
        { key: 'discontinued', label: 'Discontinued SKUs', sel: '#page-settings .card .card:has(#disc-panel)' } ] }] },
    { key: 'upc', file: 'upc.html', name: '🏷️ UPC Barcodes', needs: 'Ops / Mobile / Mgmt', card: card('upc.html'), tabs: [], parts: [
      { key: 'dns', label: '🚫 Do Not Separate', sel: '#upc-app button[onclick="upcShowDNS()"]' },
      { key: 'typeprint', label: '⌨️ Type & Print a UPC', sel: '#upc-app div:has(> #upc-manual-error)' },
      { key: 'search', label: '🔍 Search by SKU or UPC', sel: '#upc-app div:has(> div > #upc-search-inp)' },
      { key: 'upload', label: '📂 Upload Exported Shipment', sel: '#upc-app div:has(> #upc-drop-zone)' },
      { key: 'saved', label: 'Saved shipment banner', sel: '#upc-saved-banner' },
      { key: 'live', label: 'Live shipment banner', sel: '#upc-shipment-banner' },
      { key: 'verify', label: '📷 Scan & Verify', sel: '#upc-scan-bar' },
      { key: 'awdmatch', label: '🔁 AWD Label ↔ Box UPC Check', sel: '#upc-app div:has(> #awd-match-status)' } ] },
    { key: 'inventory', file: 'inventory.html', name: '📋 Inventory', needs: 'Ops / Mobile / Mgmt', card: card('inventory.html'), tabs: [
      { key: 'stockout', label: '🏬 Stock Out Shelving', sel: '#inv-tab-stockout', parts: [
        { key: 'reports', label: '⚠️ Stock Out Reports', sel: '#inv-stockout-card' },
        { key: 'resolveall', label: 'Resolve All', sel: '#inv-stockout-resolveall-wrap' },
        { key: 'reportshist', label: '📜 Reports History', sel: '#inv-stockout-card span[onclick*="invShowStockoutHistory"]' },
        { key: 'solabels', label: '🏷 Sold Out labels to print', sel: '#inv-solabel-card' },
        { key: 'scansearch', label: 'Scan or Search', sel: '#inv-scansearch-card' },
        { key: 'camera', label: '📷 Start Camera', sel: '#inv-cam-btn' },
        { key: 'allpulls', label: '👥 Everyone\'s Un-grabbed Items', sel: '#inv-allpull-card' },
        { key: 'pulllist', label: 'Pull List', sel: '#inv-pulllist-card' } ] },
      { key: 'stockoutco', label: '🏢 Stock Out Big Company', sel: '#inv-tab-stockoutco' },
      { key: 'check', label: '✅ Checking', sel: '#inv-tab-check' },
      { key: 'scan', label: '📦 Stock In / Found on Shelf', sel: '#inv-tab-scan', parts: [
        { key: 'quickadd', label: 'Quick Add', sel: '#inv-quickadd-card' },
        { key: 'stockinhist', label: '📜 Stock In History', sel: '#inv-quickadd-card span[onclick="invShowStockInHistory()"]' } ] },
      { key: 'transfer', label: 'Transfer', sel: '#inv-tab-transfer', parts: [
        { key: 'modecode', label: 'SKU / Part# / UPC / Name', sel: '#xfr-mode-code' },
        { key: 'container', label: '🚢 Container here', sel: '#xfr-mode-cont, #xfr-cont-wrap' },
        { key: 'camera', label: '📷 Scan Barcode', sel: '#xfr-cam-btn' },
        { key: 'fromloc', label: 'From Location', sel: '#xfr-from-card' },
        { key: 'cart', label: '🛒 Transfer Cart', sel: '#xfr-cart-card' } ] },
      { key: 'audit', label: '🔍 Audit', sel: '#inv-tab-audit', parts: [
        { key: 'recount', label: '📋 Full recount', sel: '#rc-card' },
        { key: 'barcode', label: '🏷 Barcode designer', sel: '#bd-open-btn' },
        { key: 'bdqueue', label: '🏷 Barcode labels to print', sel: '#bd-queue-card' } ] },
      { key: 'review', label: 'Review', sel: '#inv-tab-review', needs: 'Mgmt', parts: [
        { key: 'approvalmode', label: 'Approval Mode', sel: '#inv-review-content > .icard:has(#inv-review-mode-desc)' },
        { key: 'bulk', label: 'Bulk approve bar', sel: '#inv-bulk-bar' },
        { key: 'pendingin', label: '📦 Pending Stock In', sel: '#inv-review-content > div:has(> #inv-pending-in)' },
        { key: 'pendingout', label: '📤 Pending Stock Out', sel: '#inv-review-content > div:has(> #inv-pending-out)' },
        { key: 'pendingxfr', label: '🔁 Pending Transfers', sel: '#inv-review-content > div:has(> #inv-pending-xfr)' } ] },
      { key: 'skumgr', label: '📋 SKU Mgr', sel: '#inv-tab-skumgr', needs: 'Mgmt', parts: [
        { key: 'value', label: '💰 Inventory value', sel: '#skumgr-value' },
        { key: 'bylocation', label: 'By Location', sel: '#skumgr-mode-loc' },
        { key: 'export', label: '⬇ Export Master List CSV', sel: '#skumgr-export-btn, #skumgr-export-status' },
        { key: 'merge', label: '🔀 Merge Duplicate Rows', sel: '#skumgr-merge-btn, #skumgr-merge-panel' },
        { key: 'backfill', label: '🧩 Fill Missing Ea/Case, Price, Vendor', sel: '#skumgr-backfill-btn, #skumgr-backfill-panel' },
        { key: 'history', label: '📜 History', sel: '#skumgr-history-btn' },
        { key: 'fixeq', label: '= Fix Double "="', sel: '#skumgr-fixeq-btn, #skumgr-fixeq-panel' },
        { key: 'parent', label: '🧬 Parent ≠ Part #', sel: '#skumgr-parent-btn, #skumgr-parent-panel' },
        { key: 'pncheck', label: '🧹 Check part #s', sel: '#skumgr-pncheck-btn, #skumgr-pncheck-panel' },
        { key: 'pricehist', label: '💲 Price history', sel: '#skumgr-pricehist-btn, #skumgr-pricehist' },
        { key: 'addrow', label: '+ Add New Row', sel: '#inv-panel-skumgr button[onclick="skumgrShowAddRow()"]' },
        { key: 'incoming', label: 'Ordered / on the way', sel: '#skumgr-incoming' } ] },
      { key: 'location', label: '📍 Location Plan', sel: '#inv-tab-location', needs: 'Mgmt', parts: [
        { key: 'plan', label: '📍 Plan', sel: '#lp-tab-plan, #lp-plan-view' },
        { key: 'photos', label: '🖼 Photos', sel: '#lp-tab-photos, #lp-photo-view' } ] },
      { key: 'history', label: '📜 History', sel: '#inv-tab-history', needs: 'Mgmt', parts: [
        { key: 'report', label: 'Activity Report', sel: '#inv-panel-history > .icard:has(#hist-report-people)' },
        { key: 'value', label: 'Inventory value', sel: '#hist-value' },
        { key: 'pallets', label: '🚢 Pallet times', sel: '#hist-report-pallets' },
        { key: 'log', label: 'Inventory Log History', sel: '#inv-panel-history > .icard:has(#hist-recover)' },
        { key: 'recover', label: '🔎 Missed entries', sel: '#inv-panel-history button[onclick="histRecoverCheck()"], #hist-recover' } ] },
      { key: 'soldout', label: '🚫 Sold Out', sel: '#inv-tab-soldout', needs: 'Mgmt', parts: [
        { key: 'watch', label: '⚠️ Listing Watch', sel: '#lw-card' },
        { key: 'qty', label: '🚫 Change listing quantities', sel: '#inv-panel-soldout > .icard:has(#so-results)' },
        { key: 'addlisting', label: '+ Add a missing listing', sel: '#inv-panel-soldout button[onclick="soToggleAdd()"], #so-add' },
        { key: 'log', label: '📜 Quantity changes', sel: '#inv-panel-soldout > .icard:has(#so-log)' } ] }] },
    { key: 'packship', file: 'packship.html', name: '📦 Pack & Ship', needs: 'any sign-in', card: card('packship.html'), tabs: [
      { key: 'picking', label: '🧺 Picking', sel: '#ps-tab-picking', parts: [
        { key: 'voice', label: '🔊 Alert voice', sel: '#ps-panel-picking div:has(> #ps-pick-voice-select)' },
        { key: 'nostockbtn', label: '⚠ Report out of stock', sel: '#ps-pick-nostock-submit-wrap' },
        { key: 'printed', label: 'Printed Today tile', sel: '#ps-pick-summary-printed' },
        { key: 'notprinted', label: 'Not Printed tile', sel: '#ps-pick-summary-notprinted' },
        { key: 'summary', label: 'Picked Today / by person', sel: '#ps-pick-summary' },
        { key: 'itemcount', label: 'Package-size breakdown', sel: '#ps-pick-itemcount-breakdown' },
        { key: 'nostock', label: '🚫 No Stock Found', sel: '#ps-nostock-card' },
        { key: 'list', label: 'Today\'s Picks', sel: '#ps-panel-picking > .ps-section-header:has(#ps-pick-cnt-label), #ps-panel-picking > .ps-filter-row, #ps-pick-list' },
        { key: 'debug', label: 'debug link', sel: '#ps-panel-picking span[onclick*="psShowDebug"]' } ] },
      { key: 'scan', label: '📦 Packing', sel: '#ps-tab-scan', parts: [
        { key: 'voice', label: '🔊 Alert voice', sel: '#ps-panel-scan div:has(> #ps-scan-voice-select)' },
        { key: 'printed', label: 'Printed Today tile', sel: '#ps-scan-summary-printed' },
        { key: 'notprinted', label: 'Not Printed tile', sel: '#ps-scan-summary-notprinted' },
        { key: 'summary', label: 'Scanned Today / by person', sel: '#ps-scan-summary' },
        { key: 'itemcount', label: 'Package-size breakdown', sel: '#ps-scan-itemcount-breakdown' },
        { key: 'list', label: 'Today\'s Scans', sel: '#ps-panel-scan > .ps-section-header:has(#ps-scan-cnt-label), #ps-panel-scan > .ps-filter-row, #ps-scan-list' },
        { key: 'debug', label: 'debug link', sel: '#ps-panel-scan span[onclick*="psShowDebug"]' } ] },
      { key: 'labelcheck', label: '🏷️ Label Check', sel: '#ps-tab-labelcheck' },
      { key: 'closebatch', label: '🚐 Close Batch', sel: '#ps-tab-closebatch', parts: [
        { key: 'uspsrun', label: '🚚 USPS Drop-off', sel: '#ps-panel-closebatch > .ps-batch-close-bar' },
        { key: 'banners', label: 'Closed batch banners', sel: '#ps-closed-banners' },
        { key: 'runreport', label: '🔒 USPS Run Report', sel: '#ps-panel-closebatch > .ps-card:has(#ps-usps-report-section)' } ] },
      { key: 'cancellation', label: '🗑️ Cancellation', sel: '#ps-tab-cancellation', parts: [
        { key: 'add', label: '🗑️ Mark an Order for Cancellation', sel: '#ps-panel-cancellation > .ps-card:has(#ps-cancelorder-tracking)' },
        { key: 'history', label: 'History', sel: '#ps-panel-cancellation span[onclick="psShowCancelOrderHistory()"]' } ] },
      { key: 'progress', label: '📊 Progress', sel: '#ps-tab-progress', parts: [
        { key: 'stats', label: 'Stat cards', sel: '#ps-panel-progress > .ps-stat-bar' },
        { key: 'bars', label: 'UPS / USPS progress bars', sel: '#ps-panel-progress > .ps-progress-wrap' },
        { key: 'recent', label: 'Recent Scans', sel: '#ps-panel-progress > .ps-section-header, #ps-progress-scan-list' } ] },
      { key: 'lookup', label: '🔍 Lookup', sel: '#ps-tab-lookup', parts: [
        { key: 'tracking', label: '🔍 Tracking Number Lookup', sel: '#ps-panel-lookup > .ps-lookup-wrap, #ps-lookup-result' },
        { key: 'log', label: '📋 Today\'s Full Scan Log', sel: '#ps-panel-lookup > .ps-section-header, #ps-panel-lookup > .ps-search-row, #ps-log-list' } ] },
      { key: 'orderlookup', label: '📋 Order Lookup', sel: '#ps-tab-orderlookup', parts: [
        { key: 'splitdebug', label: '🔧 Check Split-Order Items', sel: '#ps-ol-debug-tool' },
        { key: 'nostockdebug', label: '🔧 Check "No Stock Found"', sel: '#ps-ol-nostock-debug-tool' } ] },
      { key: 'status', label: '📡 Status Check', sel: '#ps-tab-status', needs: 'Mgmt', parts: [
        { key: 'upload', label: '📡 Upload 45-day CSV', sel: '#ps-status-content > .ps-upload-area' },
        { key: 'stats', label: 'Stat cards', sel: '#ps-status-stat-bar' },
        { key: 'export', label: '⬇ Export CSV', sel: '#ps-status-content button[onclick="psExportStatusFlags()"]' },
        { key: 'delivered', label: '✅ Delivered list', sel: '#ps-status-results > div:has(#ps-status-delivered-list)' } ] },
      { key: 'gaps', label: '⚠️ Gap Report', sel: '#ps-tab-gaps', needs: 'Mgmt', parts: [
        { key: 'export', label: '⬇ Export CSV', sel: '#ps-gaps-content button[onclick="psExportGaps()"]' },
        { key: 'summary', label: 'Summary counts', sel: '#ps-gap-summary' } ] },
      { key: 'undelivered', label: '📦 Undelivered Report', sel: '#ps-tab-undelivered', needs: 'Mgmt', parts: [
        { key: 'generate', label: 'Generate Report', sel: '#ps-undelivered-content > .ps-card:has(#ps-und-run-btn)' },
        { key: 'summary', label: 'Summary', sel: '#ps-und-summary' },
        { key: 'download', label: '⬇ Download Spreadsheet', sel: '#ps-und-download-btn' } ] },
      { key: 'vsync', label: '🔄 Veeqo Sync', sel: '#ps-tab-vsync', needs: 'Mgmt', parts: [
        { key: 'status', label: 'Veeqo status', sel: '#ps-vsync-content > .ps-card:has(#ps-veeqo-status-text)' },
        { key: 'labels', label: 'Label counts', sel: '#ps-vlabels-bar' },
        { key: 'stock', label: '📦 Keep Veeqo stock up', sel: '#ps-vstock-card' },
        { key: 'manifest', label: 'Today\'s Manifest', sel: '#ps-vsync-content > .ps-card:has(#ps-vsync-manifest-btn)' },
        { key: 'tracking', label: 'Tracking Monitor', sel: '#ps-vsync-content > .ps-card:has(#ps-vsync-tracking-btn)' },
        { key: 'weight', label: 'Backfill Real Weight', sel: '#ps-vsync-content > .ps-card:has(#ps-vsync-weight-btn)' },
        { key: 'archive', label: '🗄️ Archive Old Rows', sel: '#ps-vsync-content > .ps-card:has(#ps-archive-btn)' } ] },
      { key: 'autolabel', label: '🤖 Auto Label', sel: '#ps-tab-autolabel', needs: 'Mgmt', parts: [
        { key: 'onoff', label: '🤖 Auto Label on/off', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-mode-btns)' },
        { key: 'rules', label: '📐 Rules', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-rules)' },
        { key: 'test', label: '🧪 Test', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-run-btn)' },
        { key: 'lastrun', label: '📋 Last run', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-orders)' },
        { key: 'printwatch', label: '🛑 Print watch', sel: '#ps-al-watch-card' },
        { key: 'labels', label: '🏷️ Shipping labels', sel: '#ps-al-label-card' },
        { key: 'slips', label: '🧾 Packing slips', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-slip-list)' },
        { key: 'costs', label: '💵 Label costs', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-cost-totals)' },
        { key: 'scanform', label: '📄 USPS scan form', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-sf-list)' },
        { key: 'byday', label: '📜 Labels by day', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-day)' },
        { key: 'ebaytrack', label: '📮 eBay tracking', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-et-list)' },
        { key: 'lowvalue', label: '💸 Low value list', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-lowvalue)' },
        { key: 'reweigh', label: '⚖️ Re-weigh list', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-reweigh)' },
        { key: 'history', label: '🕘 Labels bought & cancellations', sel: '#ps-autolabel-content > .ps-card:has(#ps-al-log)' } ] },
      { key: 'valerts', label: '🚨 Alerts', sel: '#ps-tab-valerts', needs: 'Mgmt', parts: [
        { key: 'stats', label: 'Alert counts', sel: '#ps-va-stat-bar' },
        { key: 'export', label: '⬇ Export CSV', sel: '#ps-valerts-content button[onclick="psVaExport()"]' } ] },
      { key: 'printlog', label: '🖨️ Print Log', sel: '#ps-tab-printlog', parts: [
        { key: 'operator', label: 'Printing-as name', sel: '#ps-panel-printlog > .ps-card:has(#ps-pl-operator-display)' },
        { key: 'stats', label: 'Printed Today / UPS / USPS', sel: '#ps-panel-printlog > div:has(#ps-pl-count)' },
        { key: 'shipday', label: '📦 Ship-day count', sel: '#ps-pl-shipday' },
        { key: 'dupes', label: '⚠️ Double Print Warning', sel: '#ps-print-dupe-card' },
        { key: 'summary', label: 'Printed by person', sel: '#ps-pl-summary' } ] }] },
    { key: 'messenger', file: 'index.html', name: '💬 Messenger', needs: 'any sign-in', card: card("launchApp('messenger')"), tabs: [] },
    { key: 'training', file: 'training.html', name: '🎓 Training', needs: 'any sign-in', card: card('training.html'), tabs: [], parts: [
      { key: 'picker', label: '🧺 Picker Guide', sel: '#modules a.mod[href="#picker"]' },
      { key: 'appguide', label: '🧭 How to Use the App', sel: '#modules a.mod[href="#app"]' },
      { key: 'apppackship', label: '📦 Pack & Ship lessons', sel: '#rl-sections a.rl-card[href="#app-packship"]' },
      { key: 'appinventory', label: '📋 Inventory lessons', sel: '#rl-sections a.rl-card[href="#app-inventory"]' },
      { key: 'managerview', label: 'Manager view — who finished', sel: '#home-admin' } ] },
    { key: 'repricer', file: 'repricer.html', name: '💰 eBay Repricer', needs: 'Ops / Mgmt', card: card('repricer.html'), tabs: [
      { key: 'listings', label: '📦 Active Listings', sel: '#tab-listings', needs: 'Mgmt', parts: [
        { key: 'stats', label: 'Stats', sel: '#listings-stats' },
        { key: 'sync', label: '↻ Sync Listings', sel: '#panel-listings button[onclick="rprLoad()"]' },
        { key: 'autofix', label: '⚡ Auto-Fix Below Floor', sel: '#auto-reprice-btn, #auto-reprice-result' } ] },
      { key: 'research', label: '🔍 Price Research', sel: '#tab-research', needs: 'Mgmt', parts: [
        { key: 'past', label: '📋 Past Research', sel: '#subtog-view, #research-view-past' },
        { key: 'new', label: '➕ New Research', sel: '#subtog-new, #research-view-new' } ] },
      { key: 'decision', label: '💰 Price Decision', sel: '#tab-decision', needs: 'Mgmt', parts: [
        { key: 'loadall', label: 'Load All Decisions', sel: '#panel-decision button[onclick="loadAllDecisions()"]' } ] },
      { key: 'velocity', label: '📈 Velocity', sel: '#tab-velocity', needs: 'Mgmt', parts: [
        { key: 'charts', label: '📈 Charts', sel: '#vel-tog-charts, #vel-view-charts' },
        { key: 'history', label: '📋 Sales History', sel: '#vel-tog-history, #vel-view-history' },
        { key: 'sync', label: '⟳ Sync buttons', sel: '#cron-btns' },
        { key: 'rebuild', label: '⟳ Rebuild from eBay', sel: '#build-history-btn' } ] },
      { key: 'approval', label: '⚠️ Approval Queue', sel: '#tab-approval', needs: 'Mgmt' },
      { key: 'pricealerts', label: '🏷️ Price Alerts', sel: '#tab-pricealerts', needs: 'Mgmt' },
      { key: 'skulookup', label: '🔎 SKU Lookup', sel: '#tab-skulookup' },
      { key: 'returns', label: '📦 Returns', sel: '#tab-returns', needs: 'Mgmt' },
      { key: 'calculator', label: '🧮 Price Calculator', sel: '#tab-calculator', needs: 'Mgmt', parts: [
        { key: 'tiers', label: '⚙ Edit Tiers', sel: '#panel-calculator button[onclick="rprOpenTierEditor()"]' } ] },
      { key: 'listingsmenu', label: '🚀 Listings ▾', sel: '#tab-listings-dropdown-trigger' },
      { key: 'bulktitles', label: '✏️ Bulk Titles', sel: '#tab-bulktitles', parts: [
        { key: 'scan', label: '🔍 Scan Synced Catalog', sel: '#panel-bulktitles button[onclick="btScanCatalog()"]' },
        { key: 'checksku', label: 'Check SKUs (Dry Run)', sel: '#bt-checksku-btn' } ] },
      { key: 'shopify', label: '🛍️ Shopify Listings', sel: '#tab-shopify', parts: [
        { key: 'import', label: '📥 Import from Sheet', sel: '#sy-import-btn' } ] },
      { key: 'ebaylist', label: '🏷️ eBay Listings', sel: '#tab-ebaylist', parts: [
        { key: 'import', label: '📥 Import from Sheet', sel: '#eb-import-btn' },
        { key: 'variation', label: '🔀 Stage as Variation', sel: '#eb-variation-btn' } ] },
      { key: 'walmartlist', label: '🏬 Walmart Listings', sel: '#tab-walmartlist', parts: [
        { key: 'import', label: '📥 Import from Sheet', sel: '#wm-import-btn' } ] },
      { key: 'amazonlist', label: '🛒 Amazon Listings', sel: '#tab-amazonlist', parts: [
        { key: 'import', label: '📥 Import from Sheet', sel: '#az-import-btn' },
        { key: 'variation', label: '🔀 Create as Variation Family', sel: '#az-variation-btn' } ] }] },
    { key: 'labelprint', file: 'labelprint.html', name: '🏷️ Label Printer', needs: 'any sign-in', card: card('labelprint.html'), tabs: [], parts: [
      { key: 'printer', label: 'Printer Connection', sel: '#labelprint-app .lp-card:has(#lp-connect-btn)' },
      { key: 'locations', label: 'Locations', sel: '#labelprint-app .lp-card:has(#lp-load-btn)' },
      { key: 'preview', label: 'Label Preview', sel: '#lp-preview-card' },
      { key: 'single', label: 'Print Single Label', sel: '#labelprint-app .lp-card:has(#lp-single-input)' },
      { key: 'settings', label: 'Label Settings', sel: '#lp-settings-card' },
      { key: 'print', label: 'Print', sel: '#lp-print-card' } ] },
    { key: 'lights', file: 'lights.html', name: '💡 Lights', needs: 'Ops / Mobile / Mgmt', card: card('lights.html'), tabs: [], parts: [
      { key: 'all', label: 'All lights ON/OFF', sel: '#lt-app .lt-wrap > .lt-card:has(> .lt-row)' },
      { key: 'list', label: 'Each light', sel: '#lt-list' },
      { key: 'setup', label: 'Add / change lights', sel: '#lt-setup' },
      { key: 'log', label: 'Who turned what on / off', sel: '#lt-app .lt-wrap > .lt-card:has(#lt-log)' } ] },
    { key: 'reorder', file: 'reorder.html', name: '📦 Reorder Planner', needs: 'Mgmt', card: card('reorder.html'), tabs: [
      { key: 'reorder', label: '🧾 Reorder', sel: '#ro-tab-reorder', parts: [
        { key: 'editinline', label: '✏️ Edit in table', sel: '#ro-panel-reorder label:has(#rvo-inline)' },
        { key: 'notours', label: '🔗 All listings NOT under our SKU', sel: '#ro-panel-reorder button[onclick*="roTab(\'listings\')"]' },
        { key: 'weird', label: '📋 Weird list (copy / CSV)', sel: '#ro-panel-reorder button[onclick="rvoWeirdCopy()"], #ro-panel-reorder button[onclick="rvoWeirdCsv()"]' },
        { key: 'csv', label: '⬇ Download CSV for vendor', sel: '#ro-panel-reorder button[onclick="rvoCsv()"]' },
        { key: 'barcode', label: '🏷 Barcode / vendor for a part #', sel: '#ro-panel-reorder button[onclick="rvoPartOpen()"]' },
        { key: 'import', label: 'Vendor sheets import', sel: '#ro-panel-reorder > div:has(> #rvo-imp-file)' },
        { key: 'onway', label: 'On the way', sel: '#rvo-inc' },
        { key: 'ordered', label: 'Ordered', sel: '#rvo-ord' },
        { key: 'history', label: '🕘 History', sel: '#rvo-hist-box' },
        { key: 'fixes', label: '📝 Saved fixes', sel: '#rvo-fixes-box' } ] },
      { key: 'po', label: '📦 PO Cases', sel: '#ro-tab-po', parts: [
        { key: 'export', label: '⬇ Export CSV', sel: '#ro-panel-po button[onclick="exportPOCases()"]' } ] },
      { key: 'ai', label: '✦ AI Insights', sel: '#ro-tab-ai', parts: [
        { key: 'analysis', label: '✦ AI Analysis', sel: '#ro-ai-auto' },
        { key: 'chat', label: 'AI chat', sel: '#ro-ai-chat-wrap' } ] },
      { key: 'skumap', label: '🔗 SKU Map', sel: '#ro-tab-skumap', parts: [
        { key: 'save', label: '💾 Save Map', sel: '#ro-panel-skumap button[onclick="saveSkuMap()"]' },
        { key: 'export', label: '⬇ Export CSV', sel: '#ro-panel-skumap button[onclick="exportSkuMap()"]' } ] },
      { key: 'podash', label: '🎯 PO Recommendations', sel: '#ro-tab-podash', parts: [
        { key: 'export', label: '⬇ Export CSV', sel: '#ro-panel-podash button[onclick="exportPORecommendations()"]' } ] },
      { key: 'listings', label: '🔗 Listings → our SKU', sel: '#ro-tab-listings', parts: [
        { key: 'csv', label: '⬇ CSV', sel: '#ro-panel-listings button[onclick="rlsCsv()"]' },
        { key: 'sameasin', label: '⚡ Same ASIN as FBA', sel: '#rls-asin' },
        { key: 'save', label: '💾 Save all', sel: '#rls-save' } ] }] },
    { key: 'sales', file: 'sales.html', name: '📊 Sales Dashboard', needs: 'Mgmt', card: card('sales.html'), tabs: [
      { key: 'overview', label: 'Overview', sel: '#db-tab-overview', parts: [
        { key: 'fresh', label: 'Data freshness', sel: '#db-fresh' },
        { key: 'kpis', label: 'KPIs', sel: '#db-kpis' },
        { key: 'leaderboards', label: 'Leaderboards', sel: '#db-lb' } ] },
      { key: 'parts', label: 'Part# Detail', sel: '#db-tab-parts' },
      { key: 'skus', label: 'SKU Detail', sel: '#db-tab-skus' },
      { key: 'ai', label: '✦ AI Insights', sel: '#db-tab-ai', parts: [
        { key: 'analysis', label: '✦ AI Analysis', sel: '#db-ai-auto' },
        { key: 'chat', label: 'AI chat', sel: '#db-ai-chat-wrap' } ] }] },
    { key: 'receivepo', file: 'receivepo.html', name: '🚚 Receive PO', needs: 'Mgmt', card: card('receivepo.html'), tabs: [], parts: [
      { key: 'template', label: '⬇ Download blank template', sel: '#rpo-step-upload button[onclick="rpoDownloadTemplate()"]' },
      { key: 'notincatalog', label: 'Not in catalog', sel: '#rpo-notincatalog-card' },
      { key: 'warnings', label: 'Warnings', sel: '#rpo-warnings-card' },
      { key: 'unmatched', label: 'Show Unmatched Only', sel: '#rpo-step-preview button[onclick="rpoToggleUnmatched()"]' },
      { key: 'confirm', label: '✓ Confirm & Receive PO', sel: '#rpo-confirm-btn' } ] },
    { key: 'msginbox', file: 'index.html', name: '📥 Message Inbox', needs: 'Mgmt', card: card("salesLaunchApp('msginbox')"), tabs: [] },
    { key: 'ebaymsgs', file: 'index.html', name: '🤖 AI Customer Support', needs: 'Mgmt', card: card("salesLaunchApp('ebaymsgs')"), tabs: [] },
    { key: 'ldash', file: 'ldash.html', name: '🏢 Leadership Dashboard', needs: 'Mgmt', card: card('ldash.html'), tabs: [
      { key: 'critical', label: '🔴 Critical Stock', sel: '#ldash-ih-btn-critical' },
      { key: 'discrepancy', label: '⚠️ Discrepancies', sel: '#ldash-ih-btn-discrepancy' },
      { key: 'pending', label: '🕐 Pending Reviews', sel: '#ldash-ih-btn-pending' }], parts: [
      { key: 'actions', label: '⚡ Action Queue', sel: '#ldash-app div:has(> #ldash-action-queue)' },
      { key: 'shipping', label: '📦 Shipping Today', sel: '#ldash-mid-row > div:has(> #ldash-ship-content)' },
      { key: 'sales', label: '💰 Sales Snapshot', sel: '#ldash-mid-row > div:has(> #ldash-sales-content)' },
      { key: 'invhealth', label: '📋 Inventory Health', sel: '#ldash-app div:has(> #ldash-ih-content)' } ] },
    { key: 'profit', file: 'profit.html', name: '💵 Profit Check', needs: 'Mgmt', card: card('profit.html'), tabs: [], parts: [
      { key: 'cards', label: 'Summary cards', sel: '#pf-cards' },
      { key: 'notes', label: 'Notes', sel: '#pf-notes' },
      { key: 'table', label: 'Listings table', sel: '#pf-app .tablewrap' },
      { key: 'settings', label: '⚙ Settings', sel: '#pf-app .panel:has(#pf-set-basis)' },
      { key: 'amazondata', label: '🔄 Amazon data', sel: '#pf-app .panel:has(#pf-sync-btn)' },
      { key: 'pull90', label: 'Pull the last 90 days again', sel: '#pf-sync90-btn' },
      { key: 'history', label: 'History', sel: '#pf-app .panel details:has(#pf-log)' } ] },
    { key: 'imagemaker', file: 'imagemaker.html', name: '🖼️ Image Maker', needs: 'any sign-in', card: card('imagemaker.html'), tabs: [], parts: [
      { key: 'photo', label: 'Product Photo', sel: '.imx-controls > .imx-panel:has(#imx-drop)' },
      { key: 'bgremove', label: 'Background removal', sel: '#imx-bgremove-wrap' },
      { key: 'touchup', label: '✏️ Touch up', sel: '#imx-touch-btn' },
      { key: 'quantity', label: 'Quantity', sel: '.imx-controls > .imx-panel:has(#imx-qty-custom)' },
      { key: 'arrangement', label: 'Arrangement', sel: '.imx-controls > .imx-panel:has(#imx-swatch-grid)' },
      { key: 'adjust', label: 'Adjustments', sel: '.imx-controls > .imx-panel:has(#imx-size-val)' },
      { key: 'design', label: 'Design: selected piece', sel: '.imx-controls > .imx-panel:has(#imx-sel-none)' },
      { key: 'output', label: 'Output / ⬇ Download', sel: '.imx-controls > .imx-panel:has(#imx-download-btn)' },
      { key: 'save', label: 'Save design', sel: '.imx-controls > .imx-panel:has(#imx-save-btn)' },
      { key: 'saved', label: '📁 Saved designs', sel: '#imx-tab-saved, #imx-pane-saved' },
      { key: 'record', label: '📜 Record', sel: '#imx-tab-log, #imx-pane-log' } ] },
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
    // Parts inside a page or a tab (a box, a button, a list): hidden by a
    // style rule, so anything the page draws later is hidden straight away.
    var css = '';
    (here.parts || []).forEach(function (x) { if (x.sel && set[here.key + ':' + x.key]) css += x.sel + '{display:none!important}\n'; });
    here.tabs.forEach(function (t) {
      (t.parts || []).forEach(function (x) { if (x.sel && set[here.key + ':' + t.key + ':' + x.key]) css += x.sel + '{display:none!important}\n'; });
    });
    var st = document.getElementById('xf-access-parts');
    if (css) {
      if (!st && document.head) { st = document.createElement('style'); st.id = 'xf-access-parts'; document.head.appendChild(st); }
      if (st && st.textContent !== css) st.textContent = css;
    } else if (st) st.remove();
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
        if (d.level === 'owner') designSetup(); // 🔒 Save this design
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
  // 🔒 Save this design (owner, 2026-10-07): on every app page, Owner only. Saves
  // the tab that is open (or the whole page) on the server with the date, who,
  // the exact commit the site + Worker run (version.json) and the page code as
  // served. Saved designs can't be changed or deleted; any one can be
  // downloaded, or named to Claude ("bring back <tab> from <date>").
  var designOn = false, DH = null; // DH = this page, for 🔒 designs
  function designSetup() {
    if (designOn || !document.body) return;
    if (!DH) DH = here || (file && file !== 'index.html' && /\.html$/.test(file) ? { file: file, name: document.title || file, tabs: [] } : null);
    if (!DH) return; designOn = true;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'xf-design-btn'; b.textContent = '🔒';
    b.title = 'Save this design (Owner) · saved versions';
    b.style.cssText = 'position:fixed;right:10px;bottom:34px;z-index:2147482000;width:36px;height:36px;border-radius:50%;border:1px solid #d1d5db;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.18);font-size:16px;cursor:pointer;opacity:.75';
    b.addEventListener('click', function (e) { e.preventDefault(); designPanel(); });
    document.body.appendChild(b);
  }
  function dEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function dWhen(iso) { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso || ''; } }
  // Parts inside a tab that can be saved on their own (owner: "if only one goes
  // bad I only have to change that one back") — tab key → its mode buttons.
  var DSUBS = { 'inventory.html': { transfer: [
    { key: 'code', label: 'SKU / Part# / UPC / Name', sel: '#xfr-mode-code' },
    { key: 'cont', label: '🚢 Container here', sel: '#xfr-mode-cont' }] } };
  function dSubs(t) { return ((DSUBS[DH.file] || {})[t.key]) || []; }
  // Every tab button on the page, in the order shown — the access list's tabs
  // plus any tab added later that isn't in it yet (e.g. 🏷️ Label Check).
  function dTabs() {
    var cat = DH.tabs || [], first = null;
    for (var i = 0; i < cat.length && !first; i++) first = document.querySelector(cat[i].sel);
    if (!first || !first.parentNode) return cat;
    var seen = {}, out = [];
    [].forEach.call(first.parentNode.children, function (el) {
      if (el.tagName !== first.tagName || !el.getAttribute('onclick')) return;
      var c = cat.filter(function (t) { return document.querySelector(t.sel) === el; })[0];
      var key = c ? c.key : (String(el.id || '').replace(/^.*-tab-/, '') || String(el.textContent || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase());
      if (!key || seen[key]) return; seen[key] = 1;
      out.push(c || { key: key, label: String(el.textContent || key).replace(/\s+/g, ' ').trim(), sel: el.id ? '#' + el.id : null, el: el });
    });
    cat.forEach(function (t) { if (!seen[t.key]) out.push(t); });
    return out;
  }
  function dEl(t) { return t.el || (t.sel ? document.querySelector(t.sel) : null); }
  function dOn(t) { var el = dEl(t); return !!(el && isActive(el) && el.style.display !== 'none'); }
  function dOpenTab() { // the tab open right now (and the part of it that is open)
    var t = dTabs().filter(function (t) { return dOn(t); })[0];
    if (!t) return null;
    var sb = dSubs(t).filter(function (x) { return dOn(x); })[0];
    return sb ? { key: t.key + ':' + sb.key } : { key: t.key };
  }
  function dLabel(t) { // the name on the tab button, as the owner sees it
    var el = dEl(t), f = el && el.firstChild;
    var x = f && f.nodeType === 3 && f.textContent.trim() ? f.textContent : (el ? el.textContent : '');
    return String(x || t.label).replace(/\s+/g, ' ').trim() || t.label;
  }
  function dApi(path, body) {
    return fetch(WORKER + path, body ? { method: 'POST', headers: { 'X-Cred-Token': token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers: { 'X-Cred-Token': token() } })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }); });
  }
  function dGet(u) { return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 'design=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); }
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768)); return btoa(s); }
  function unb64(t) { var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function gz(text) {
    if (!window.CompressionStream) return Promise.resolve({ gz: false, data: text });
    return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(function (buf) { return { gz: true, data: b64(buf) }; });
  }
  function ungz(row, data) {
    if (!row.src_gz) return Promise.resolve(data);
    return new Response(new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  function dPage() { return DH.file; }
  function designPanel() {
    var old = document.getElementById('xf-design-pop'); if (old) { old.remove(); return; }
    var w = document.createElement('div'); w.id = 'xf-design-pop';
    w.style.cssText = 'position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111';
    var cur = dOpenTab(), tabs = dTabs();
    var opt = function (key, lab) { return '<option value="' + dEsc(key) + '"' + (cur && cur.key === key ? ' selected' : '') + '>' + dEsc(lab) + '</option>'; };
    var opts = tabs.map(function (t) {
      return opt(t.key, dLabel(t)) + dSubs(t).map(function (x) { return opt(t.key + ':' + x.key, dLabel(t) + ' → ' + (dLabel(x) || x.label)); }).join('');
    }).join('')
      + '<option value="page"' + (!cur ? ' selected' : '') + '>Whole page (every tab)</option>';
    w.innerHTML = '<div style="background:#fff;width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom))">'
      + '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:17px">🔒 Save this design — ' + dEsc(DH.name) + '</b><button type="button" data-a="x" style="border:none;background:none;font-size:22px;cursor:pointer">&times;</button></div>'
      + '<div style="font-size:12px;color:#4b5563;margin:4px 0 10px">Saved on the server with today\'s date. Nobody can change or delete a saved design. Later: ⬇ download it, or tell Claude "bring back &lt;tab&gt; from &lt;date&gt;".</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select id="xf-ds-tab" style="flex:1;min-width:160px;padding:9px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px">' + opts + '</select>'
      + '<input id="xf-ds-note" type="text" placeholder="Note (optional): what works well now" style="flex:2;min-width:180px;padding:9px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px"></div>'
      + '<button type="button" data-a="save" style="width:100%;margin-top:8px;padding:11px;border-radius:9px;border:none;background:#1a56db;color:#fff;font-size:15px;font-weight:700;cursor:pointer">🔒 Save this design now</button>'
      + '<div id="xf-ds-msg" style="font-size:13px;font-weight:600;margin-top:6px"></div>'
      + '<div style="font-weight:800;margin:12px 0 6px">Saved designs of this page (newest first)</div><div id="xf-ds-list" style="font-size:13px;color:#6b7280">Loading…</div></div>';
    document.body.appendChild(w);
    var msg = function (t, c) { var m = w.querySelector('#xf-ds-msg'); m.style.color = c || '#065f46'; m.textContent = t; };
    var rows = [];
    var list = function () {
      dApi('/designs/list?page=' + encodeURIComponent(dPage())).then(function (d) {
        rows = d.rows || [];
        w.querySelector('#xf-ds-list').innerHTML = rows.length ? rows.map(function (r) {
          return '<div style="border:1px solid #e5e7eb;border-radius:9px;padding:8px 10px;margin-bottom:6px;color:#111">'
            + '<div style="display:flex;gap:8px;align-items:center"><div style="flex:1"><b>' + dEsc(r.tab_label || r.tab) + '</b> · ' + dEsc(dWhen(r.saved_at)) + '</div>'
            + '<button type="button" data-a="dl" data-id="' + r.id + '" style="padding:6px 10px;border-radius:7px;border:1.5px solid #1a56db;background:#fff;color:#1a56db;font-weight:700;cursor:pointer">⬇ Download</button>'
            + '<button type="button" data-a="cp" data-id="' + r.id + '" style="padding:6px 10px;border-radius:7px;border:1.5px solid #d1d5db;background:#f9fafb;cursor:pointer">📋 For Claude</button></div>'
            + '<div style="font-size:12px;color:#6b7280">#' + r.id + ' · by ' + dEsc(r.saved_by) + ' · commit ' + dEsc(String(r.commit_sha || 'unknown').slice(0, 7)) + (r.note ? ' · ' + dEsc(r.note) : '') + '</div></div>';
        }).join('') : 'Nothing saved for this page yet.';
      }).catch(function (e) { w.querySelector('#xf-ds-list').textContent = '⚠ ' + e.message; });
    };
    var forClaude = function (r) { return 'Bring back ' + (r.tab_label || r.tab) + ' (' + (r.page_name || r.page) + ') to the design saved ' + dWhen(r.saved_at) + ' — saved design #' + r.id + ', commit ' + (r.commit_sha || 'unknown') + '. Leave every other tab as it is now.'; };
    w.addEventListener('click', function (e) {
      if (e.target === w) { w.remove(); return; }
      var bt = e.target.closest('button'); if (!bt) return; var a = bt.getAttribute('data-a');
      if (a === 'x') { w.remove(); return; }
      if (a === 'save') {
        var sel = w.querySelector('#xf-ds-tab'), key = sel.value, lab = sel.options[sel.selectedIndex].text;
        bt.disabled = true; msg('Saving…', '#1a56db');
        Promise.all([dGet('version.json'), dGet(dPage()), dGet('xf-access.js')]).then(function (a) {
          var v = {}; try { v = JSON.parse(a[0] || '{}'); } catch (x) {}
          var text = '==================== ' + dPage() + ' ====================\n' + a[1] + '\n==================== xf-access.js ====================\n' + a[2] + '\n';
          return gz(text).then(function (z) {
            return dApi('/designs/save', { page: dPage(), pageName: DH.name, tab: key, tabLabel: lab, commit: v.commit || '', builtAt: v.builtAt || '', note: w.querySelector('#xf-ds-note').value, src: z.data, gz: z.gz, bytes: text.length });
          });
        }).then(function (d) { msg('✅ Saved: ' + lab + ' · ' + dWhen(d.saved_at) + ' (#' + d.id + ')'); w.querySelector('#xf-ds-note').value = ''; list(); })
          .catch(function (x) { msg('⚠ Not saved: ' + x.message, '#b91c1c'); })
          .then(function () { bt.disabled = false; });
        return;
      }
      var r = rows.filter(function (x) { return String(x.id) === bt.getAttribute('data-id'); })[0]; if (!r) return;
      if (a === 'cp') {
        var t = forClaude(r);
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg('📋 Copied — paste it to Claude'); }).catch(function () { window.prompt('Copy this and send it to Claude:', t); });
        return;
      }
      if (a === 'dl') {
        msg('Getting #' + r.id + '…', '#1a56db');
        dApi('/designs/file?id=' + r.id).then(function (d) { return ungz(d.row, d.src || ''); }).then(function (src) {
          var head = 'XFitting — saved design #' + r.id + ': ' + (r.tab_label || r.tab) + ' (' + (r.page_name || r.page) + ')\n'
            + 'Saved: ' + dWhen(r.saved_at) + ' (New York) by ' + r.saved_by + '\n'
            + 'Website + Worker commit: ' + (r.commit_sha || 'unknown') + (r.built_at ? ' (deployed ' + r.built_at + ')' : '') + '\n'
            + (r.note ? 'Note: ' + r.note + '\n' : '') + 'Repo: alfixedinc88-creator/xf-tools-3829\n\n'
            + 'TO PUT IT BACK — tell Claude: ' + forClaude(r) + '\n(See docs/LOCKED-DESIGNS.md.)\n\n';
          var day = String(r.saved_at || '').slice(0, 10);
          var name = (String(r.tab_label || r.tab).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'page') + '-design-' + day + '-' + r.id + '.txt';
          var url = URL.createObjectURL(new Blob([head + src], { type: 'text/plain' })), l = document.createElement('a');
          l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
          msg('⬇ Downloaded ' + name);
        }).catch(function (x) { msg('⚠ ' + x.message, '#b91c1c'); });
      }
    });
    list();
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
