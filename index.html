/* XFitting Service Worker — v3
   Network-first for app shell. Auto-detects new build ID and forces reload.
   Queues failed Worker API calls when offline and replays on reconnect.
*/

const CACHE_VERSION = 'v114-feat-20260501z14';
const CACHE_NAME    = 'xfitting-shell-' + CACHE_VERSION;
const WORKER_URL    = 'https://xfitting-lookup.alfixedinc88.workers.dev';

const SHELL_ASSETS = [
  '/xf-tools-3829/',
  '/xf-tools-3829/index.html',
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
  );
});

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
    if (url.pathname === '/inventory/log') {
      await queueRequest(request);
      return new Response(JSON.stringify({
        ok: true, queued: true,
        message: 'Offline — entry queued and will sync when connection returns.'
      }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Network unavailable');
  }
}

async function queueRequest(request) {
  const body  = await request.text();
  const queue = await getQueue();
  queue.push({ url: request.url, method: request.method,
    headers: Object.fromEntries(request.headers.entries()), body, ts: Date.now() });
  await setQueue(queue);
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
  client.postMessage({ type: 'QUEUE_STATUS', count: queue.length });
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
