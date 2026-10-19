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

const CACHE_VERSION = 'v262-offline-pages-20261019';
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
    const saved = await caches.match(request.url, { cacheName: DATA_CACHE });
    tellClients({ type: 'XF_NET', online: false, saved: !!saved, path: new URL(request.url).pathname });
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
  if (e.data?.type === 'ONLINE')        replayQueue();
  if (e.data?.type === 'QUEUE_STATUS')  sendQueueStatus(e.source);
  if (e.data?.type === 'SKIP_WAITING')  self.skipWaiting();
  if (e.data?.type === 'CLEAR_DATA')    caches.delete(DATA_CACHE); // signed out → this device keeps no data
});

// ── POST queueing for offline ─────────────────────────────────────────────────
async function handleWorkerPost(request) {
  // The Inventory page keeps its own "saved on this phone" outbox (v5): its
  // requests carry "_outbox": true and must NOT also be queued here, or the
  // same entry would wait in two places.
  const copy = request.clone();
  try {
    return await fetch(request);
  } catch {
    const url = new URL(request.url);
    let pageOutbox = false;
    try { pageOutbox = !!JSON.parse(await copy.text())._outbox; } catch { /* not JSON */ }
    if (pageOutbox) throw new Error('Network unavailable');
    if (QUEUEABLE_PATHS.includes(url.pathname)) {
      const queueItem = await queueRequest(request);
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
  try {
    const parsed = JSON.parse(rawBody);
    parsed._requestId = requestId; // an id the page already set is kept (same id = never counted twice)
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

async function replayQueue() {
  const queue = await getQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
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
