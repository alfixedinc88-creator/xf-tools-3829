// ═══════════════════════════════════════════════════════════════════════════
// xfitting-profit — "Do we make or lose money on each listing, after fees?"
//
// A separate Cloudflare Worker (own wrangler.toml in this folder) so the
// main worker (worker/src/index.js, xfitting-lookup) doesn't grow. It uses
// the same D1 database:
//   • READS existing tables: cred_sessions / cred_users / cred_levels /
//     cred_user_roles (sign-in check), cogs, cost_layer, reorder_alias,
//     ship_manifest_log (label costs).
//   • WRITES only its own tables, all named profit_*. It never writes to
//     inventory tables (master_list, inventory_log, cost_layer …) and never
//     changes a live price anywhere.
//
// Amazon first (phase 1):
//   • Daily cron: Amazon Finances API listFinancialEvents → one row per
//     order line (sold or refunded) in profit_amazon_order_fees, with the
//     item price, referral fee, FBA fee, other fees, promotions, tax.
//     Everything else Amazon charges or pays (storage, subscription,
//     reimbursements …) goes to profit_amazon_other_events.
//   • Orders API getOrders → profit_amazon_orders (FBA or FBM, and which
//     orders have no fees posted yet — shown as "fees pending").
//   • profit.html reads /profit/summary, /profit/orders, /profit/try-price.
// ═══════════════════════════════════════════════════════════════════════════

import { parseFinancialEvents, buildProfit, partForSku, baseOf, packOf, costPerPiece, tryPrice } from './calc.js';

const SP = 'https://sellingpartnerapi-na.amazon.com';
const CRED_SESSION_ROLLING_MINUTES = 60; // same as the main worker
const CRED_PERMS = ['mobile', 'ops', 'mgmt', 'price', 'admin'];
const CRED_LEVEL_DEFAULTS = {
  worker: ['mobile', 'ops'], pro: ['mobile', 'ops', 'mgmt'],
  admin: ['mobile', 'ops', 'mgmt', 'price', 'admin'], owner: ['mobile', 'ops', 'mgmt', 'price', 'admin'],
};
const MARKETPLACE_IDS = { 'Amazon.com': 'ATVPDKIKX0DER', 'Amazon.ca': 'A2EUQ1WTGCTBG2', 'Amazon.com.mx': 'A1AM78C64UM0Y8' };
const DEFAULT_SETTINGS = { thinPct: 15, costBasis: 'landed' };

// ── HTTP helpers ─────────────────────────────────────────────────────────
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Cred-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (body, status, origin) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const all = async (env, sql, binds) => ((await env.DB.prepare(sql).bind(...(binds || [])).all()).results) || [];

// ── Sign-in: the same server-checked X-Cred-Token as every other page ────
// Copy of verifyCredSession() in worker/src/index.js, READ-ONLY: it doesn't
// extend or delete the session (the main worker still owns cred_sessions).
// Profit numbers are management data, so the 'mgmt' permission is needed.
async function verifyCredSession(token, env) {
  if (!token) return null;
  const session = await env.DB.prepare('SELECT * FROM cred_sessions WHERE token = ?').bind(token).first().catch(() => null);
  if (!session) return null;
  if ((Date.now() - new Date(session.last_active).getTime()) / 60000 > CRED_SESSION_ROLLING_MINUTES) return null;
  const user = await env.DB.prepare('SELECT * FROM cred_users WHERE id = ? AND active = 1').bind(session.user_id).first().catch(() => null);
  if (!user) return null;
  const levels = { ...CRED_LEVEL_DEFAULTS };
  for (const r of await all(env, 'SELECT key, roles FROM cred_levels').catch(() => [])) {
    try { levels[r.key] = JSON.parse(r.roles || '[]').filter(x => CRED_PERMS.includes(x)); } catch (_) {}
  }
  const own = (await all(env, 'SELECT role FROM cred_user_roles WHERE user_id = ?', [user.id]).catch(() => [])).map(r => r.role);
  const roles = new Set([...((user.level && levels[user.level]) || []), ...own]);
  if (user.level === 'owner') { roles.add('admin'); roles.add('owner'); }
  return { userId: user.id, username: user.username, displayName: user.display_name, roles: [...roles], level: user.level || null };
}
const who = s => String((s && (s.displayName || s.username || s.userId)) || 'cron').slice(0, 40);

// ── Own tables (profit_*) ────────────────────────────────────────────────
let _ready = false;
async function ensureTables(env) {
  if (_ready) return;
  const q = s => env.DB.prepare(s).run();
  // One row per Amazon order line: kind 'S' = sold/shipped, 'R' = refund.
  await q(`CREATE TABLE IF NOT EXISTS profit_amazon_order_fees (
    line_key TEXT PRIMARY KEY, kind TEXT NOT NULL, order_id TEXT, order_item_id TEXT, sku TEXT, marketplace TEXT,
    posted_date TEXT, qty REAL, item_price REAL, shipping_charged REAL, other_charges REAL, promotions REAL,
    tax_collected REAL, tax_withheld REAL, referral_fee REAL, fba_fee REAL, other_fees REAL, fee_detail TEXT,
    currency TEXT, fetched_at TEXT)`);
  await q('CREATE INDEX IF NOT EXISTS idx_profit_fees_posted ON profit_amazon_order_fees(posted_date)');
  await q('CREATE INDEX IF NOT EXISTS idx_profit_fees_order ON profit_amazon_order_fees(order_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_profit_fees_sku ON profit_amazon_order_fees(sku)');
  // Money not tied to one order line (storage, subscription, reimbursements, coupons …).
  await q(`CREATE TABLE IF NOT EXISTS profit_amazon_other_events (
    event_key TEXT PRIMARY KEY, list TEXT, type TEXT, posted_date TEXT, sku TEXT, amount REAL, currency TEXT, fetched_at TEXT)`);
  await q('CREATE INDEX IF NOT EXISTS idx_profit_other_posted ON profit_amazon_other_events(posted_date)');
  // Orders (Orders API): FBA/FBM and "fees not posted yet".
  await q(`CREATE TABLE IF NOT EXISTS profit_amazon_orders (
    order_id TEXT PRIMARY KEY, purchase_date TEXT, last_update TEXT, status TEXT, channel TEXT,
    order_total REAL, currency TEXT, marketplace_id TEXT, fetched_at TEXT)`);
  await q('CREATE INDEX IF NOT EXISTS idx_profit_orders_date ON profit_amazon_orders(purchase_date)');
  // Settings (thin margin %, cost basis) + where each sync got to.
  await q('CREATE TABLE IF NOT EXISTS profit_settings (key TEXT PRIMARY KEY, value TEXT, by_user TEXT, updated_at TEXT)');
  // Record of every sync and every settings change (who / when / what).
  await q(`CREATE TABLE IF NOT EXISTS profit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, by_user TEXT,
    action TEXT, detail TEXT)`);
  _ready = true;
}
async function getSetting(env, key) {
  const r = await env.DB.prepare('SELECT value FROM profit_settings WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}
async function setSetting(env, key, value, by) {
  await env.DB.prepare('INSERT INTO profit_settings (key, value, by_user, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, by_user=excluded.by_user, updated_at=excluded.updated_at')
    .bind(key, value == null ? null : String(value), by || null, new Date().toISOString()).run();
}
async function log(env, by, action, detail) {
  await env.DB.prepare('INSERT INTO profit_log (ts, by_user, action, detail) VALUES (?,?,?,?)')
    .bind(new Date().toISOString(), by || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail)).run().catch(() => {});
}
async function loadSettings(env) {
  const s = { ...DEFAULT_SETTINGS };
  const t = await getSetting(env, 'thin_pct'); if (t != null && !isNaN(+t)) s.thinPct = +t;
  const b = await getSetting(env, 'cost_basis'); if (['unit', 'landed', 'batch'].includes(b)) s.costBasis = b;
  s.costBasisChosen = b != null; s.thinPctChosen = t != null;
  return s;
}

// ── Amazon SP-API (copied from the main worker's getAmazonToken / spApiRetry) ──
let _amzToken = null;
async function amazonToken(env) {
  const now = Date.now();
  if (_amzToken && _amzToken.exp > now + 60000) return _amzToken.token;
  if (!env.AMAZON_REFRESH_TOKEN || !env.AMAZON_CLIENT_ID || !env.AMAZON_CLIENT_SECRET) throw new Error('Amazon secrets not set on xfitting-profit (AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET / AMAZON_REFRESH_TOKEN)');
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.AMAZON_REFRESH_TOKEN, client_id: env.AMAZON_CLIENT_ID, client_secret: env.AMAZON_CLIENT_SECRET }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Amazon token error: ' + JSON.stringify(data));
  _amzToken = { token: data.access_token, exp: now + data.expires_in * 1000 };
  return data.access_token;
}
// GET/POST to SP-API, waiting and retrying when Amazon says "too fast".
async function sp(env, method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(SP + path, {
      method, headers: { 'x-amz-access-token': await amazonToken(env), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Amazon ${path.split('?')[0]} ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 400)}`);
    return data;
  }
}

// ── Sync: Finances API → profit_amazon_order_fees ──────────────────────────
// Works in chunks (Amazon allows ~1 page every 2 s) and remembers where it
// got to in profit_settings, so a long catch-up (90 days) carries on in the
// next call / next cron run. Lines are saved by a fixed key, so pulling the
// same days twice replaces rows instead of counting them twice.
async function saveFinancePage(env, fe) {
  const { lines, other } = parseFinancialEvents(fe);
  const now = new Date().toISOString();
  const stmts = lines.map(l => env.DB.prepare(`INSERT OR REPLACE INTO profit_amazon_order_fees (line_key, kind, order_id, order_item_id, sku, marketplace, posted_date, qty,
      item_price, shipping_charged, other_charges, promotions, tax_collected, tax_withheld, referral_fee, fba_fee, other_fees, fee_detail, currency, fetched_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(l.line_key, l.kind, l.order_id, l.order_item_id, l.sku, l.marketplace, l.posted_date, l.qty,
    l.item_price, l.shipping_charged, l.other_charges, l.promotions, l.tax_collected, l.tax_withheld, l.referral_fee, l.fba_fee, l.other_fees,
    JSON.stringify(l.fee_detail), l.currency, now));
  for (const o of other) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO profit_amazon_other_events (event_key, list, type, posted_date, sku, amount, currency, fetched_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(o.key, o.list, o.type, o.posted_date, o.sku, o.amount, o.currency, now));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { lines: lines.length, other: other.length };
}

async function syncFinances(env, { days, maxPages, by } = {}) {
  await ensureTables(env);
  maxPages = maxPages || 25;
  let state = null;
  try { state = JSON.parse((await getSetting(env, 'fin_sync')) || 'null'); } catch (_) {}
  const before = new Date(Date.now() - 5 * 60000).toISOString(); // Amazon wants PostedBefore ≥ 2 min ago
  if (days) state = { after: new Date(Date.now() - days * 86400000).toISOString(), before, next: null };
  if (!state || (!state.next && state.done)) {
    // Normal daily run: from 3 days before the last finished window (fees can post late) up to now.
    const lastTo = await getSetting(env, 'fin_synced_to');
    const after = lastTo ? new Date(Date.parse(lastTo) - 3 * 86400000).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
    state = { after, before, next: null };
  }
  let pages = 0, lines = 0, other = 0;
  while (pages < maxPages) {
    const qs = state.next
      ? `NextToken=${encodeURIComponent(state.next)}`
      : `PostedAfter=${encodeURIComponent(state.after)}&PostedBefore=${encodeURIComponent(state.before)}&MaxResultsPerPage=100`;
    let data;
    try { data = await sp(env, 'GET', '/finances/v0/financialEvents?' + qs); }
    catch (e) {
      // An old NextToken can expire: start the same window again (rows are
      // replaced by key, so nothing is counted twice).
      if (state.next && / 400:/.test(e.message)) { state.next = null; await log(env, by, 'sync finances: page token expired, restarting window', state); continue; }
      throw e;
    }
    const p = (data && data.payload) || {};
    const n = await saveFinancePage(env, p.FinancialEvents || {});
    lines += n.lines; other += n.other; pages++;
    state.next = p.NextToken || null;
    await setSetting(env, 'fin_sync', JSON.stringify(state), by);
    if (!state.next) break;
    await sleep(2100);
  }
  const more = !!state.next;
  if (!more) {
    state.done = true;
    await setSetting(env, 'fin_sync', JSON.stringify(state), by);
    const prev = await getSetting(env, 'fin_synced_to');
    if (!prev || prev < state.before) await setSetting(env, 'fin_synced_to', state.before, by);
    const oldest = await getSetting(env, 'fin_synced_from');
    if (!oldest || state.after < oldest) await setSetting(env, 'fin_synced_from', state.after, by);
  }
  const res = { pages, lines, other, more, window: { after: state.after, before: state.before } };
  await log(env, by, 'sync finances', res);
  return res;
}

// ── Sync: Orders API → profit_amazon_orders (FBA/FBM + fees-pending list) ──
// getOrders is slow on Amazon's side (burst 20, then 1 a minute), so a run
// takes at most `maxPages` pages and carries on next time.
async function syncOrders(env, { days, maxPages, by } = {}) {
  await ensureTables(env);
  maxPages = maxPages || 10;
  const mkt = env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
  let state = null;
  try { state = JSON.parse((await getSetting(env, 'ord_sync')) || 'null'); } catch (_) {}
  if (days || !state || (!state.next && state.done)) {
    const lastTo = await getSetting(env, 'ord_synced_to');
    const since = days ? new Date(Date.now() - days * 86400000).toISOString()
      : lastTo ? new Date(Date.parse(lastTo) - 86400000).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
    state = { since, started: new Date(Date.now() - 5 * 60000).toISOString(), next: null };
  }
  let pages = 0, orders = 0;
  while (pages < maxPages) {
    const qs = `MarketplaceIds=${mkt}&` + (state.next ? `NextToken=${encodeURIComponent(state.next)}` : `LastUpdatedAfter=${encodeURIComponent(state.since)}&MaxResultsPerPage=100`);
    const data = await sp(env, 'GET', '/orders/v0/orders?' + qs);
    const p = (data && data.payload) || {};
    const now = new Date().toISOString();
    const stmts = (p.Orders || []).map(o => env.DB.prepare(`INSERT OR REPLACE INTO profit_amazon_orders (order_id, purchase_date, last_update, status, channel, order_total, currency, marketplace_id, fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(o.AmazonOrderId, o.PurchaseDate || null, o.LastUpdateDate || null, o.OrderStatus || null, o.FulfillmentChannel || null,
      o.OrderTotal ? +o.OrderTotal.Amount || 0 : null, o.OrderTotal ? o.OrderTotal.CurrencyCode : null, o.MarketplaceId || null, now));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    orders += stmts.length; pages++;
    state.next = p.NextToken || null;
    await setSetting(env, 'ord_sync', JSON.stringify(state), by);
    if (!state.next) break;
    await sleep(pages < 18 ? 1100 : 61000);
  }
  const more = !!state.next;
  if (!more) { state.done = true; await setSetting(env, 'ord_sync', JSON.stringify(state), by); await setSetting(env, 'ord_synced_to', state.started, by); }
  const res = { pages, orders, more, since: state.since };
  await log(env, by, 'sync orders', res);
  return res;
}

// ── Reading existing tables (read-only) ─────────────────────────────────
async function loadCostTables(env) {
  const cogs = {};
  for (const r of await all(env, 'SELECT base_sku, unit_price, landed_cogs FROM cogs').catch(() =>
    all(env, 'SELECT base_sku, unit_price, NULL AS landed_cogs FROM cogs').catch(() => []))) {
    cogs[String(r.base_sku || '').trim().toUpperCase()] = { unit_price: r.unit_price, landed_cogs: r.landed_cogs };
  }
  const layers = {};
  for (const r of await all(env, 'SELECT part, cases, price FROM cost_layer WHERE price > 0 AND cases > 0').catch(() => [])) {
    const b = baseOf(String(r.part || '').trim().toUpperCase());
    const l = layers[b] = layers[b] || { cases: 0, value: 0 };
    l.cases += +r.cases; l.value += +r.cases * +r.price;
  }
  const alias = {};
  for (const r of await all(env, 'SELECT raw, part FROM reorder_alias').catch(() => [])) alias[String(r.raw || '').trim().toUpperCase()] = r.part;
  return { cogs, layers, alias };
}
// Label cost per order (FBM), from ship_manifest_log — each tracking # once.
async function loadLabels(env, orderIds) {
  const out = {};
  const ids = [...new Set(orderIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const rows = await all(env, `SELECT UPPER(TRIM(order_num)) AS o, UPPER(TRIM(tracking)) AS t, MAX(label_cost) AS c FROM ship_manifest_log
      WHERE UPPER(TRIM(order_num)) IN (${chunk.map(() => '?').join(',')}) AND label_cost IS NOT NULL GROUP BY 1, 2`, chunk.map(x => x.toUpperCase())).catch(() => []);
    for (const r of rows) out[r.o] = (out[r.o] || 0) + (+r.c || 0);
  }
  // Keys back to Amazon's own spelling.
  const res = {};
  for (const id of ids) if (out[id.toUpperCase()] != null) res[id] = out[id.toUpperCase()];
  return res;
}
const rowToLine = r => ({ ...r, fee_detail: (() => { try { return JSON.parse(r.fee_detail || '{}'); } catch (_) { return {}; } })() });

async function profitData(env, days) {
  await ensureTables(env);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const lines = (await all(env, 'SELECT * FROM profit_amazon_order_fees WHERE posted_date >= ?', [since])).map(rowToLine);
  const orderIds = [...new Set(lines.map(l => l.order_id).filter(Boolean))];
  // Every 'S' line of these orders (also ones posted before the window) — to split a label fairly.
  let orderLines = [];
  for (let i = 0; i < orderIds.length; i += 80) {
    const c = orderIds.slice(i, i + 80);
    orderLines = orderLines.concat((await all(env, `SELECT * FROM profit_amazon_order_fees WHERE kind = 'S' AND order_id IN (${c.map(() => '?').join(',')})`, c)).map(rowToLine));
  }
  const orders = {};
  for (let i = 0; i < orderIds.length; i += 80) {
    const c = orderIds.slice(i, i + 80);
    for (const o of await all(env, `SELECT order_id, channel FROM profit_amazon_orders WHERE order_id IN (${c.map(() => '?').join(',')})`, c)) orders[o.order_id] = { channel: o.channel };
  }
  const labels = await loadLabels(env, orderIds);
  const { cogs, layers, alias } = await loadCostTables(env);
  const settings = await loadSettings(env);
  const result = buildProfit({ lines, orderLines, orders, labels, cogs, layers, alias, settings });
  return { result, since, settings };
}

// ── Routes ──────────────────────────────────────────────────────────────
async function routeSummary(url, env, origin) {
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days')) || 30));
  const { result, since, settings } = await profitData(env, days);
  // Orders with no fees posted yet (Amazon posts fees when the order ships).
  const pending = await all(env, `SELECT o.order_id, o.purchase_date, o.status, o.channel, o.order_total, o.currency FROM profit_amazon_orders o
    WHERE o.purchase_date >= ? AND o.status NOT IN ('Canceled') AND NOT EXISTS (SELECT 1 FROM profit_amazon_order_fees f WHERE f.order_id = o.order_id AND f.kind = 'S')
    ORDER BY o.purchase_date DESC`, [since]);
  const cancelled = await env.DB.prepare(`SELECT COUNT(*) AS n FROM profit_amazon_orders WHERE purchase_date >= ? AND status = 'Canceled'`).bind(since).first();
  const other = await all(env, `SELECT list, type, currency, COUNT(*) AS n, SUM(amount) AS amount FROM profit_amazon_other_events WHERE posted_date >= ?
    GROUP BY list, type, currency ORDER BY SUM(amount)`, [since]);
  const sync = {};
  for (const k of ['fin_synced_to', 'fin_synced_from', 'ord_synced_to']) sync[k] = await getSetting(env, k);
  try { const s = JSON.parse((await getSetting(env, 'fin_sync')) || 'null'); sync.finMore = !!(s && s.next); } catch (_) {}
  try { const s = JSON.parse((await getSetting(env, 'ord_sync')) || 'null'); sync.ordMore = !!(s && s.next); } catch (_) {}
  const lastLog = await all(env, 'SELECT ts, by_user, action, detail FROM profit_log ORDER BY id DESC LIMIT 15');
  return json({
    ok: true, days, since, rows: result.rows, totals: result.totals, settings,
    pending: { count: pending.length, total: Math.round(pending.reduce((a, o) => a + (+o.order_total || 0), 0) * 100) / 100, orders: pending.slice(0, 300) },
    cancelled: (cancelled && cancelled.n) || 0,
    other: other.map(o => ({ ...o, amount: Math.round((+o.amount || 0) * 100) / 100 })),
    sync, log: lastLog, secrets: secretsStatus(env),
  }, 200, origin);
}
async function routeOrders(url, env, origin) {
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days')) || 30));
  const key = url.searchParams.get('key') || '';
  const { result } = await profitData(env, days);
  const row = result.rows.find(r => r.key === key);
  const lines = (result.detail[key] || []).sort((a, b) => String(b.posted_date).localeCompare(String(a.posted_date)));
  return json({ ok: true, row: row || null, lines }, 200, origin);
}
async function routeTryPrice(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const sku = String(b.sku || '').trim();
  const price = +b.price;
  if (!sku || !(price > 0)) return json({ ok: false, error: 'SKU and a price above 0 are needed' }, 400, origin);
  const shipping = +b.shipping > 0 ? +b.shipping : 0;
  const fba = b.channel === 'AFN';
  const marketplaceId = MARKETPLACE_IDS[b.marketplace] || env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
  const currency = b.currency || 'USD';
  // Read-only fee estimate. It does NOT change the live price.
  const est = await sp(env, 'POST', `/products/fees/v0/listings/${encodeURIComponent(sku)}/feesEstimate`, {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId, IsAmazonFulfilled: fba, Identifier: 'profit-' + Date.now(),
      PriceToEstimateFees: { ListingPrice: { CurrencyCode: currency, Amount: price }, Shipping: { CurrencyCode: currency, Amount: shipping } },
    },
  });
  const r = (est && est.payload && est.payload.FeesEstimateResult) || {};
  if (r.Status && r.Status !== 'Success') return json({ ok: false, error: 'Amazon could not estimate fees: ' + JSON.stringify(r.Error || r.Status).slice(0, 300) }, 200, origin);
  const fe = r.FeesEstimate || {};
  const fees = +(fe.TotalFeesEstimate && fe.TotalFeesEstimate.Amount) || 0;
  const detail = (fe.FeeDetailList || []).map(d => ({ type: d.FeeType, amount: +(d.FinalFee && d.FinalFee.Amount) || 0 }));
  // Cost per piece + pieces, same as the table.
  const { cogs, layers, alias } = await loadCostTables(env);
  const settings = await loadSettings(env);
  const pm = partForSku(sku, alias);
  const cp = pm.isPart ? costPerPiece(baseOf(pm.part), settings.costBasis, cogs, layers) : null;
  const pieces = packOf(pm.part);
  // FBM: average label of this SKU's own recent orders (single-SKU orders only), else what the page sent.
  let label = 0, labelSrc = fba ? 'FBA fee covers shipping' : 'none';
  if (!fba) {
    if (b.label != null && b.label !== '') { label = +b.label || 0; labelSrc = 'typed in'; }
    else {
      const recent = await all(env, `SELECT order_id, SUM(qty) AS q FROM profit_amazon_order_fees WHERE kind='S' AND sku = ? GROUP BY order_id
        HAVING (SELECT COUNT(DISTINCT sku) FROM profit_amazon_order_fees x WHERE x.order_id = profit_amazon_order_fees.order_id AND x.kind='S') = 1
        ORDER BY MAX(posted_date) DESC LIMIT 40`, [sku]);
      const labels = await loadLabels(env, recent.map(r => r.order_id));
      const per = recent.filter(r => labels[r.order_id] != null && r.q > 0).map(r => labels[r.order_id] / r.q);
      if (per.length) { label = per.reduce((a, v) => a + v, 0) / per.length; labelSrc = `average of ${per.length} recent FBM order(s)`; }
      else labelSrc = '⚠ no label cost on file for this SKU — type one in';
    }
  }
  const t = tryPrice({ price, shipping, fees, label, pieces, cpp: cp ? cp.cpp : null });
  return json({
    ok: true, sku, marketplaceId, channel: fba ? 'FBA' : 'FBM', price, shipping, fees, feeDetail: detail, label: Math.round(label * 100) / 100, labelSrc,
    part: pm.isPart ? pm.part : null, pieces, costPerPiece: cp ? cp.cpp : null, costSrc: cp ? cp.src : '⚠ no cost on file', ...t,
  }, 200, origin);
}
async function routeSettings(request, env, origin, s) {
  await ensureTables(env);
  if (request.method === 'GET') return json({ ok: true, settings: await loadSettings(env) }, 200, origin);
  const b = await request.json().catch(() => ({}));
  const before = await loadSettings(env);
  const changes = [];
  if (b.thinPct != null) {
    const t = +b.thinPct;
    if (!(t >= 0 && t <= 90)) return json({ ok: false, error: 'Thin margin must be 0–90 %' }, 400, origin);
    if (t !== before.thinPct || !before.thinPctChosen) { await setSetting(env, 'thin_pct', t, who(s)); changes.push(`thin margin ${before.thinPct}% → ${t}%`); }
  }
  if (b.costBasis != null) {
    if (!['unit', 'landed', 'batch'].includes(b.costBasis)) return json({ ok: false, error: 'Cost basis must be unit, landed or batch' }, 400, origin);
    if (b.costBasis !== before.costBasis || !before.costBasisChosen) { await setSetting(env, 'cost_basis', b.costBasis, who(s)); changes.push(`cost basis ${before.costBasis} → ${b.costBasis}`); }
  }
  if (changes.length) await log(env, who(s), 'settings', changes.join('; '));
  return json({ ok: true, settings: await loadSettings(env), changes }, 200, origin);
}
async function routeSync(request, env, origin, s) {
  const b = await request.json().catch(() => ({}));
  const days = b.days ? Math.min(180, Math.max(1, parseInt(b.days))) : null;
  const out = {};
  // Finances first (the numbers), then orders (FBA/FBM + pending).
  if (b.finances !== false) out.finances = await syncFinances(env, { days: b.restart ? days : null, maxPages: 12, by: who(s) }).catch(e => ({ error: e.message }));
  if (b.orders !== false) out.orders = await syncOrders(env, { days: b.restart ? days : null, maxPages: 5, by: who(s) }).catch(e => ({ error: e.message }));
  out.more = !!((out.finances && out.finances.more) || (out.orders && out.orders.more));
  return json({ ok: !(out.finances && out.finances.error), ...out }, 200, origin);
}
function secretsStatus(env) {
  const names = ['AMAZON_CLIENT_ID', 'AMAZON_CLIENT_SECRET', 'AMAZON_REFRESH_TOKEN', 'AMAZON_SELLER_ID', 'AMAZON_MARKETPLACE_ID'];
  const out = {}; for (const n of names) out[n] = !!env[n];
  return out;
}

// ── Daily cron ──────────────────────────────────────────────────────────
async function dailyCron(env) {
  // Finish any catch-up first, then the normal "last few days" window.
  for (let i = 0; i < 6; i++) {
    const r = await syncFinances(env, { maxPages: 25, by: 'cron' }).catch(e => { log(env, 'cron', 'sync finances failed', e.message); return null; });
    if (!r || !r.more) break;
  }
  await syncOrders(env, { maxPages: 18, by: 'cron' }).catch(e => log(env, 'cron', 'sync orders failed', e.message));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      // Every request needs a real sign-in with the Management permission.
      const s = await verifyCredSession(request.headers.get('X-Cred-Token'), env);
      if (!s) return json({ ok: false, error: 'Not signed in' }, 401, origin);
      if (!s.roles.includes('mgmt')) return json({ ok: false, error: 'Management access required' }, 403, origin);
      await ensureTables(env);
      const p = url.pathname.replace(/\/+$/, '');
      if (p === '/profit/summary' && request.method === 'GET') return await routeSummary(url, env, origin);
      if (p === '/profit/orders' && request.method === 'GET') return await routeOrders(url, env, origin);
      if (p === '/profit/try-price' && request.method === 'POST') return await routeTryPrice(request, env, origin);
      if (p === '/profit/settings') return await routeSettings(request, env, origin, s);
      if (p === '/profit/sync' && request.method === 'POST') return await routeSync(request, env, origin, s);
      return json({ ok: false, error: 'Not found' }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: e.message || String(e) }, 500, origin);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureTables(env);
    ctx.waitUntil(dailyCron(env));
  },
};
