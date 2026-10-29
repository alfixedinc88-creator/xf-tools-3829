/* XFitting Service Worker — v5
   v5 (2026-09-28): requests from the Inventory page's own outbox
   ("_outbox": true) are not queued here too; an id already on a request
   is kept. The worker has checked _requestId for duplicates since v4's
   follow-up, so a replay is never counted twice.

   Network-first for app shell. Auto-detects new build ID and forces reload.
   Queues failed Worker API calls when offline and replays on reconnect.

   v4 CHANGES (2026-07-23):
   - CACHE_VERSION bumped — was stale since 2026-05-01, meaning devices
     that fell back to cache during a connectivity gap could serve a
     JS build that was months old. Bump this on every future deploy.
   - Offline queue extended from ONLY /inventory/log to also cover
     /inventory/transfer — this was the actual gap behind "worker thought
     it was confirmed but it never went through" for transfers
     specifically. Audit/Found-on-Shelf entries already route through
     /inventory/log under the hood, so they were already covered.
   - Every queued request now carries a client-generated requestId.
     IMPORTANT: this is groundwork, not a complete fix on its own — the
     worker does not yet check this id for duplicates. Until a matching
     server-side check is added (rejecting a second request with an
     id it's already seen), a request that actually succeeds server-side
     but whose response gets lost before reaching the phone (a real,
     different failure mode from being fully offline) can still be
     replayed and create a duplicate transfer/log entry. Flagging this
     clearly rather than implying it's already solved.
*/

const CACHE_VERSION = 'v310-scan-cases-fix-20261029';
const CACHE_NAME    = 'xfitting-shell-' + CACHE_VERSION;
const WORKER_URL    = 'https://xfitting-lookup.alfixedinc88.workers.dev';

const SHELL_ASSETS = [
  '/xf-tools-3829/',
  '/xf-tools-3829/index.html',
];
// 📴 Owner (2026-10-19): "this morning we had no internet and couldn't use the app — make it work without internet".
// Every page and shared file is saved on the device when a new version installs (not only pages opened before), so
// every page opens with no internet. A file that can't be fetched is skipped (never blocks the update).
const BASE = '/xf-tools-3829/';
const OFFLINE_PAGES = ['index.html', 'inventory.html', 'packship.html', 'warehouse.html', 'upc.html', 'labelprint.html', 'lights.html',
  'reorder.html', 'awd.html', 'repricer.html', 'sales.html', 'receivepo.html', 'ldash.html', 'profit.html', 'imagemaker.html', 'training.html',
  'xfitting-admin.html', 'xf-access.js', 'xf-lang.js', 'xf-lang-es.js', 'xf-signout.js', 'manifest.json', 'icon-192x192.png', 'icon-512x512.png'];
// Fonts and libraries pages load from these sites (Excel, barcodes, charts…): saved after the first use, used offline.
const LIB_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];
const LIB_CACHE = 'xfitting-libs';
// The last answer the server gave for each data request (a part #, a spot, a list): shown ONLY when the server can't be
// reached, marked "📴 saved copy". Kept across updates; wiped on sign out; never given to a request with no sign-in.
const DATA_CACHE = 'xfitting-data';
const DATA_MAX = 600;

// Which POST paths get queued for offline retry instead of just failing.
// Add new write endpoints here as they're built — this is the ONE place
// that needs updating, rather than a single hardcoded path check.
const QUEUEABLE_PATHS = [
  '/inventory/log',
  '/inventory/transfer',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS).then(() => Promise.all(OFFLINE_PAGES.map(f =>
        fetch(BASE + f, { cache: 'no-cache' }).then(r => { if (r.ok) return cache.put(BASE + f, r); }).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          // keep the offline queue ('xfitting-meta') — it used to be deleted
          // here on every update, losing anything still waiting in it
          .filter(k => k !== CACHE_NAME && k !== 'xfitting-meta' && !k.startsWith('xfitting-meta-') && k !== LIB_CACHE && k !== DATA_CACHE)
          .map(k => {
            console.log('[XF SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
     .then(() => notifyClientsOfActivation())
  );
});

// Tells every open tab a new version just took over, so the frontend can
// show a "you're now on the latest version" toast, or prompt a reload if
// it was mid-session on the old one. Purely informational from the SW
// side — the frontend decides what to actually show, if anything.
async function notifyClientsOfActivation() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
}

// ── Fetch handler — network first, cache fallback ─────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Worker API calls — network first, queue POST on failure
  if (url.origin === new URL(WORKER_URL).origin) {
    if (e.request.method === 'POST') {
      e.respondWith(handleWorkerPost(e.request.clone()));
    } else if (e.request.method === 'GET' && dataCacheable(url, e.request)) {
      e.respondWith(handleWorkerGet(e.request));
    }
    return;
  }

  // Fonts / libraries — network first, the saved copy when offline
  if (e.request.method === 'GET' && LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(LIB_CACHE).then(x => x.put(e.request, c)); }
      return res;
    }).catch(() => caches.match(e.request, { cacheName: LIB_CACHE }).then(r => r || Promise.reject(new Error('offline')))));
    return;
  }

  // External resources — network only
  if (!url.hostname.includes('github.io')) return;

  // App shell — network first, cache fallback (offline)
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })  // always bypass browser cache
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached => {
          if (cached) return cached;
          // page.html?tab=… / xf-access.js?v=… → the saved page / file (saved without the ?…)
          return caches.match(e.request, { ignoreSearch: true }).then(c2 => {
            if (c2) return c2;
            if (e.request.mode === 'navigate') {
              return caches.match('/xf-tools-3829/index.html')
                  .then(c3 => c3 || caches.match('/xf-tools-3829/'));
            }
          });
        })
      )
  );
});

// ── 📴 Data requests: live when the server answers; the last saved answer when it can't be reached ──────────
// Not saved: sign-in calls, and anything without a sign-in (nobody browses data without a password).
function dataCacheable(url, req) {
  if (/^\/auth\//.test(url.pathname)) return false;
  return !!req.headers.get('X-Cred-Token');
}
let lastNet = 0;
async function handleWorkerGet(request) {
  try {
    const res = await fetch(request.clone());
    if (res.ok && /json/.test(res.headers.get('Content-Type') || '')) {
      const c = res.clone();
      caches.open(DATA_CACHE).then(x => x.put(request.url, c)).then(() => dataTrim()).catch(() => {});
    }
    if (Date.now() - lastNet > 15000) { lastNet = Date.now(); tellClients({ type: 'XF_NET', online: true }); }
    return res;
  } catch (err) {
    let saved = await caches.match(request.url, { cacheName: DATA_CACHE });
    const u = new URL(request.url);
    // 📴 a part # / spot / UPC: answered from this device's stock copy (every part #, even one never looked up here),
    // unless the saved answer for it is newer than the copy.
    if (u.pathname === '/inventory/lookup') {
      const pk = await packGet(), savedAt = saved ? Date.parse(saved.headers.get('Date') || '') || 0 : 0;
      if (pk && (!saved || Date.parse(pk.at) > savedAt)) {
        const ans = packLookup(pk, u.searchParams.get('code') || '');
        tellClients({ type: 'XF_NET', online: false, saved: true, path: u.pathname });
        if (ans) return new Response(JSON.stringify(ans), { status: ans.error ? 400 : 200, headers: { 'Content-Type': 'application/json', 'X-XF-Offline': '1', 'X-XF-Offline-At': pk.at } });
      }
    }
    tellClients({ type: 'XF_NET', online: false, saved: !!saved, path: u.pathname });
    if (!saved) throw err;
    const h = new Headers(saved.headers); h.set('X-XF-Offline', '1');
    return new Response(await saved.blob(), { status: 200, headers: h });
  }
}
let trimAt = 0;
async function dataTrim() {
  if (Date.now() - trimAt < 60000) return; trimAt = Date.now();
  const c = await caches.open(DATA_CACHE), keys = await c.keys();
  for (let i = 0; i < keys.length - DATA_MAX; i++) await c.delete(keys[i]); // oldest first
}
async function tellClients(msg) { (await self.clients.matchAll()).forEach(c => c.postMessage(msg)); }

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'ONLINE')        { const tk = offlineTokenUser(e.data.token) ? '' : (e.data.token || ''); replayQueue(tk); packRefresh(tk).catch(() => {}); }
  if (e.data?.type === 'QUEUE_STATUS')  sendQueueStatus(e.source);
  if (e.data?.type === 'SKIP_WAITING')  self.skipWaiting();
  if (e.data?.type === 'CLEAR_DATA')    { caches.delete(DATA_CACHE); packMem = null; caches.open(META_CACHE).then(c => c.delete('pack')); }
});

// ── POST queueing for offline ─────────────────────────────────────────────────
async function handleWorkerPost(request) {
  // The Inventory page keeps its own "saved on this phone" outbox (v5): its
  // requests carry "_outbox": true and must NOT also be queued here, or the
  // same entry would wait in two places.
  const copy = request.clone();
  // 📴 a second copy for the save-for-later queue: fetch() uses up the request's body even when there is no internet,
  // so reading `request` afterwards failed ("body already used") and nothing was saved (found 2026-10-19).
  const forQueue = request.clone();
  const isLogin = new URL(request.url).pathname === '/auth/login';
  const loginCopy = isLogin ? request.clone() : null;
  try {
    const res = await fetch(request);
    if (isLogin && res.ok) rememberLogin(loginCopy, res.clone()).catch(() => {});
    return res;
  } catch {
    if (isLogin) return offlineLogin(loginCopy); // 📴 no internet: this scanner checks the password itself
    const url = new URL(request.url);
    if (url.pathname === '/auth/logout') { // 📴 signed out with no internet → on record too (Admin → 🔑 Log in, when back)
      let tk = ''; try { tk = JSON.parse(await copy.clone().text()).token || ''; } catch {}
      const uid = offlineTokenUser(tk);
      if (uid) { const list = await metaGet('offline-signins', []); list.push({ userId: uid, at: new Date().toISOString(), kind: 'signout' }); await metaPut('offline-signins', list.slice(-200)); }
      return new Response(JSON.stringify({ ok: true, offline: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    let pageOutbox = false;
    try { pageOutbox = !!JSON.parse(await copy.text())._outbox; } catch { /* not JSON */ }
    if (pageOutbox) throw new Error('Network unavailable');
    if (QUEUEABLE_PATHS.includes(url.pathname)) {
      const queueItem = await queueRequest(forQueue);
      return new Response(JSON.stringify({
        ok: true, queued: true, requestId: queueItem.requestId,
        message: 'Offline — entry queued and will sync when connection returns.'
      }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Network unavailable');
  }
}

function makeRequestId() {
  // crypto.randomUUID() is available in service worker contexts on every
  // browser that supports service workers at all — no fallback needed.
  return crypto.randomUUID();
}

async function queueRequest(request) {
  const rawBody = await request.text();
  let requestId = makeRequestId();
  try { const b = JSON.parse(rawBody); if (b && b._requestId) requestId = String(b._requestId); } catch { /* keep the new id */ }

  // Embed the requestId into the JSON body itself (not just tracked
  // locally) so that once the worker adds a matching dedup check, this
  // id travels with the request all the way to the server on both the
  // original attempt and any replay — see the v4 header note above for
  // why that check doesn't exist yet.
  let bodyWithId = rawBody;
  const offTok = offlineTokenUser(request.headers.get('X-Cred-Token'));
  try {
    const parsed = JSON.parse(rawBody);
    parsed._requestId = requestId; // an id the page already set is kept (same id = never counted twice)
    // 📴 made by someone signed in with no internet: it is sent later with whoever is signed in then, and still belongs
    // to the person who made it (the Worker records _byUserId for an _outbox entry).
    if (offTok) { parsed._outbox = true; parsed._byUserId = offTok; }
    bodyWithId = JSON.stringify(parsed);
  } catch { /* body wasn't JSON — leave it unmodified, id is still tracked locally below */ }

  const queue = await getQueue();
  const item = {
    url: request.url, method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: bodyWithId, requestId, ts: Date.now()
  };
  queue.push(item);
  await setQueue(queue);
  return item;
}

async function replayQueue(token) {
  sendOfflineSignins(token).catch(() => {});
  const queue = await getQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      // 📴 an entry made after an offline sign-in has no real sign-in: it goes with whoever is signed in now
      const headers = { ...item.headers };
      const hk = Object.keys(headers).find(k => k.toLowerCase() === 'x-cred-token');
      if (hk && offlineTokenUser(headers[hk])) { if (!token) { remaining.push(item); continue; } headers[hk] = token; }
      const res = await fetch(item.url, { method: item.method, headers, body: item.body });
      if (!res.ok) remaining.push(item);
    } catch { remaining.push(item); }
  }
  await setQueue(remaining);
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE',
    synced: queue.length - remaining.length, remaining: remaining.length }));
}

async function sendQueueStatus(client) {
  const queue = await getQueue();
  client.postMessage({
    type: 'QUEUE_STATUS', count: queue.length,
    // Age of the oldest queued item, so the frontend can warn "some of
    // these have been waiting since [date]" rather than just a bare count.
    oldestTs: queue.length ? Math.min(...queue.map(q => q.ts)) : null
  });
}

const META_CACHE = 'xfitting-meta';
async function getQueue() {
  try {
    const cache = await caches.open(META_CACHE);
    const res   = await cache.match('queue');
    return res ? res.json() : [];
  } catch { return []; }
}
async function setQueue(queue) {
  const cache = await caches.open(META_CACHE);
  await cache.put('queue', new Response(JSON.stringify(queue),
    { headers: { 'Content-Type': 'application/json' } }));
}

// ── 📴 Sign in with no internet (owner 2026-10-19: "4 scanners, 6 people — someone signs out and in on the same scanner") ──
// Each time a person signs in WITH internet, this scanner keeps a check of their password (PBKDF2, its own random salt —
// never the password itself) with their name and level. With no internet, the same person can sign in on THIS scanner:
// the password is checked here. Only people who signed in on this scanner with internet in the last 30 days can.
// Every offline sign-in is kept and sent to Admin → 🔑 Log in when the internet is back.
const LOGIN_DAYS = 30;
function offlineTokenUser(t) { const m = /^offline\.(\d+)\./.exec(String(t || '')); return m ? parseInt(m[1], 10) : 0; }
function hex(b) { return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function pwCheck(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256));
}
async function metaGet(k, d) { try { const r = await (await caches.open(META_CACHE)).match(k); return r ? await r.json() : d; } catch { return d; } }
async function metaPut(k, v) { await (await caches.open(META_CACHE)).put(k, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } })); }
async function rememberLogin(req, res) {
  const b = await req.json(), d = await res.json();
  const name = String(b.username || '').trim().toLowerCase();
  if (!name || !b.password || !d.token || !d.userId) return;
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const all = await metaGet('logins', {});
  all[name] = { salt, hash: await pwCheck(b.password, salt), at: Date.now(),
    user: { userId: d.userId, username: d.username || name, displayName: d.displayName || '', roles: d.roles || [], level: d.level || null } };
  await metaPut('logins', all);
}
async function offlineLogin(req) {
  const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
  let b = {}; try { b = await req.json(); } catch {}
  const name = String(b.username || '').trim().toLowerCase();
  const all = await metaGet('logins', {}), it = all[name];
  if (!it || Date.now() - it.at > LOGIN_DAYS * 864e5)
    return J({ error: '📴 No internet — ' + (b.username || 'this person') + ' has not signed in on THIS scanner with internet (in the last ' + LOGIN_DAYS + ' days), so it can\'t check the password. Use a scanner you signed in on before, or wait for the internet. 没有网络 — 此人没有在这台扫描器上联网登录过，无法验证密码。', offline: true }, 401);
  if (await pwCheck(b.password || '', it.salt) !== it.hash) return J({ error: 'Invalid username or password', offline: true }, 401);
  const at = new Date().toISOString();
  const list = await metaGet('offline-signins', []); list.push({ userId: it.user.userId, username: it.user.username, at, kind: 'signin' }); await metaPut('offline-signins', list.slice(-200));
  tellClients({ type: 'XF_NET', online: false });
  return J({ ...it.user, token: 'offline.' + it.user.userId + '.' + hex(crypto.getRandomValues(new Uint8Array(8))), offline: true });
}
async function sendOfflineSignins(token) {
  if (!token) return;
  const list = await metaGet('offline-signins', []); if (!list.length) return;
  const r = await fetch(WORKER_URL + '/auth/offline-signins', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cred-Token': token }, body: JSON.stringify({ items: list }) });
  if (r.ok) await metaPut('offline-signins', []);
}

// ── 📴 This device's stock copy (step 2b): every SKU Mgr row (part #, spot, cases, Ea/Case), cases waiting for approval,
// every UPC → part #. Refreshed at most every 10 minutes while online (any page sends ONLINE with its sign-in); with no
// internet a lookup of ANY part # / parent / UPC is answered from it the same way the Worker's /inventory/lookup does.
const PACK_MIN = 10 * 60000;
let packMem = null, packBusy = false;
async function packGet() { if (!packMem) packMem = await metaGet('pack', null); return packMem; }
async function packRefresh(token) {
  if (!token || packBusy) return;
  const cur = await packGet();
  if (cur && Date.now() - Date.parse(cur.at) < PACK_MIN) return;
  packBusy = true;
  try {
    const r = await fetch(WORKER_URL + '/inventory/offline-pack', { headers: { 'X-Cred-Token': token } });
    if (r.ok) { const d = await r.json(); if (d && d.ok && Array.isArray(d.rows)) { packMem = d; await metaPut('pack', d); } }
  } finally { packBusy = false; }
}
function packBase(p) { const s = String(p || ''); const b = s.includes('=') ? s.split('=')[0] : s; return b.replace(/^(\s*\d+(?:-\d+)+(?:&\d+)?)[cC](\s*)$/, '$1$2').trim().toUpperCase(); }
function packAddFirstDigit(z) { // the R20H scanner sends 810097207059 as 10097207059
  const ok = c => { let t = 0; for (let i = 0; i < 11; i++) t += (+c[i]) * (i % 2 ? 1 : 3); return (10 - t % 10) % 10 === +c[11]; };
  if (!/^\d{11}$/.test(z) || ok('0' + z)) return null;
  for (let d = 1; d <= 9; d++) if (ok(d + z)) return d + z;
  return null;
}
// The same steps, in the same order, as the Worker's /inventory/lookup (first match wins at each step).
function packLookup(pk, raw) {
  const rawCode = String(raw || '').trim().toUpperCase();
  const has = p => pk.rows.some(r => String(r[4]).trim().toUpperCase() === p);
  let code = (pk.cParts || []).includes(rawCode) ? rawCode : rawCode.replace(/^(\s*\d+(?:-\d+)+)[cC](?=\s*$|=)/, '$1');
  if (code !== rawCode && has(rawCode)) code = rawCode;
  if (!code) return { error: 'No code provided' };
  const norm = v => String(v || '').replace(/\D/g, '').replace(/^0+/, ''), z = norm(code), z11 = z.length === 11 ? packAddFirstDigit(z) : null;
  let partNum = null, sku = null, insideUpc = null, outsideUpc = null;
  // 1–2. 🔢 saved here, then the UPC list (part # and its UPCs)
  const p1 = (z && pk.prim[z] && (pk.editZ[pk.prim[z][0].toUpperCase()] || /^\d{8,14}$/.test(code)) ? pk.prim[z] : null)
    || (z11 && pk.prim[z11] && pk.editZ[pk.prim[z11][0].toUpperCase()] ? pk.prim[z11] : null);
  if (p1) { partNum = sku = p1[0]; insideUpc = p1[1] || null; outsideUpc = p1[2] || null; }
  // 3. the old UPC sheet: a UPC or the part # itself
  if (!partNum) for (const r of pk.sheet || []) {
    const variant = r[1], V = variant.toUpperCase(), ez = pk.editZ[V];
    if (ez && z && !ez.includes(z) && V !== code) continue;
    if ((z && (norm(r[3]) === z || norm(r[2]) === z)) || (variant && V === code)) { partNum = sku = variant || r[0] || null; insideUpc = r[2] || null; outsideUpc = r[3] || null; break; }
  }
  // 4. other UPC lists (part # only)
  const upcLike = /^\d{11,14}$/.test(code);
  if (!partNum && upcLike) { const f = pk.sec[z] || (z11 ? (pk.prim[z11] && pk.editZ[pk.prim[z11][0].toUpperCase()] ? pk.prim[z11][0] : pk.sec[z11]) : null); if (f) partNum = sku = f; }
  // 🏷 Amazon's FNSKU (X0…, inside bag) / ASIN (B0…, outside box) of our FBA listing → its part # (same as the Worker).
  if (!partNum && /^(X0|B0)[0-9A-Z]{8}$/.test(code) && !has(code)) {
    if (pk.amz && pk.amz[code]) partNum = sku = pk.amz[code];
    else return { partNum: null, amazonCode: { code, kind: code.startsWith('X0') ? 'FNSKU' : 'ASIN', part: null, parts: [] }, code, locations: [], offlineCopy: pk.at };
  }
  if (!partNum && upcLike && !has(code)) return { partNum: null, upcNotLinked: true, code, locations: [], offlineCopy: pk.at };
  const upcNotLinked = !partNum && upcLike;
  if (!partNum) partNum = code;
  const baseSku = packBase(sku || partNum), P = String(partNum).toUpperCase();
  const locations = [], partNums = new Set(); let name = '';
  for (const r of pk.rows) {
    const rowSku = String(r[2]).trim().toUpperCase(), rowPart = String(r[4]).trim(), rowPartUp = rowPart.toUpperCase();
    const ok = rowPartUp === P || (baseSku.length > 2 && (packBase(rowSku) === baseSku || packBase(rowPartUp) === baseSku));
    if (!ok) continue;
    if (!name && r[3]) name = String(r[3]).trim();
    if (rowPart) partNums.add(rowPart);
    const loc = String(r[5]).trim();
    if (!loc) continue;
    const pend = pk.pending[rowPartUp + '|' + loc.toUpperCase()] || 0;
    locations.push({ partNum: rowPart, location: loc, cases: String(r[6]), eachQty: String(r[7]), rowIndex: r[0] + 1, masterId: r[1] || null,
      isPlaceholder: /will be here/i.test(loc), pendingCases: pend, adjustedCases: Math.max(0, (parseFloat(r[6]) || 0) - pend) });
  }
  const variants = Array.from(partNums).sort();
  const caseOf = {}; Object.keys(pk.caseOf || {}).forEach(k => { if (packBase(k) === baseSku) caseOf[k] = pk.caseOf[k]; });
  return { partNum, sku: sku || partNum, name, baseSku, insideUpc, outsideUpc, locations, variants, isMultiVariant: variants.length > 1 && P === baseSku,
    fbaParts: [], photo: '', upcNotLinked, caseOf, offlineCopy: pk.at };
}
