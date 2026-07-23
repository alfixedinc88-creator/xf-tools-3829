/* XFitting Service Worker — v4
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

const CACHE_VERSION = 'v115-feat-20260723-offlinequeue';
const CACHE_NAME    = 'xfitting-shell-' + CACHE_VERSION;
const WORKER_URL    = 'https://xfitting-lookup.alfixedinc88.workers.dev';

const SHELL_ASSETS = [
  '/xf-tools-3829/',
  '/xf-tools-3829/index.html',
];

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
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && !k.startsWith('xfitting-meta-'))
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
    }
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
          if (e.request.mode === 'navigate') {
            return caches.match('/xf-tools-3829/index.html')
                || caches.match('/xf-tools-3829/');
          }
        })
      )
  );
});

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'ONLINE')        replayQueue();
  if (e.data?.type === 'QUEUE_STATUS')  sendQueueStatus(e.source);
  if (e.data?.type === 'SKIP_WAITING')  self.skipWaiting();
});

// ── POST queueing for offline ─────────────────────────────────────────────────
async function handleWorkerPost(request) {
  try {
    return await fetch(request);
  } catch {
    const url = new URL(request.url);
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
  const requestId = makeRequestId();

  // Embed the requestId into the JSON body itself (not just tracked
  // locally) so that once the worker adds a matching dedup check, this
  // id travels with the request all the way to the server on both the
  // original attempt and any replay — see the v4 header note above for
  // why that check doesn't exist yet.
  let bodyWithId = rawBody;
  try {
    const parsed = JSON.parse(rawBody);
    parsed._requestId = requestId;
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
