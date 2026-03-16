/* XFitting Service Worker — v2
   Cache name is versioned — change CACHE_VERSION every deploy to bust cache.
   Queues failed Worker API calls when offline and replays them on reconnect.
*/

// ── BUMP THIS every time you deploy a new index.html ─────────────────────────
// Match it to the build ID in the HTML comment on line 4.
// Example: if HTML says XFITTING-BUILD-V109-PACK-20260316, use 'v109-pack-20260316'
const CACHE_VERSION = 'v109-stat-20260316';
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME   = 'xfitting-shell-' + CACHE_VERSION;
const WORKER_URL   = 'https://xfitting-lookup.alfixedinc88.workers.dev';

// ── App shell: cache on install ──────────────────────────────────────────────
const SHELL_ASSETS = [
  '/xf-tools-3829/',
  '/xf-tools-3829/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for tabs to close
  );
});

self.addEventListener('activate', e => {
  // Delete ALL old caches (any name that isn't the current one)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)  // keep only current cache
          .map(k => {
            console.log('[XF SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim()) // take control of all open pages immediately
  );
});

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Worker API calls — network first, queue on failure
  if (url.origin === new URL(WORKER_URL).origin) {
    if (e.request.method === 'POST') {
      e.respondWith(handleWorkerPost(e.request.clone()));
    }
    // GETs pass through — no caching of API responses
    return;
  }

  // 2. External resources (Google Fonts etc.) — network only
  if (!url.hostname.includes(self.location.hostname.split('.')[0])) {
    return;
  }

  // 3. App shell — network first, fall back to cache
  // Network-first means a fresh deploy always gets picked up on next load.
  // Cache is only used when truly offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only cache successful HTML/JS/CSS
        if (res.ok && ['text/html', 'text/css', 'application/javascript'].some(t =>
          res.headers.get('content-type')?.includes(t)
        )) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match('/xf-tools-3829/index.html')
                || caches.match('/xf-tools-3829/');
          }
        });
      })
  );
});

// ── POST queueing for /inventory/log ─────────────────────────────────────────
async function handleWorkerPost(request) {
  try {
    const res = await fetch(request);
    return res;
  } catch {
    const url = new URL(request.url);
    if (url.pathname === '/inventory/log') {
      await queueRequest(request);
      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        message: 'Offline — entry queued and will sync when connection returns.'
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error('Network unavailable');
  }
}

async function queueRequest(request) {
  const body  = await request.text();
  const queue = await getQueue();
  queue.push({
    url:     request.url,
    method:  request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    ts:      Date.now()
  });
  await setQueue(queue);
}

// ── Background sync replay ────────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'xfitting-sync') {
    e.waitUntil(replayQueue());
  }
});

self.addEventListener('message', e => {
  if (e.data?.type === 'ONLINE')        replayQueue();
  if (e.data?.type === 'QUEUE_STATUS')  sendQueueStatus(e.source);
});

async function replayQueue() {
  const queue = await getQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method:  item.method,
        headers: item.headers,
        body:    item.body
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);

  const clients = await self.clients.matchAll();
  const synced  = queue.length - remaining.length;
  clients.forEach(c => c.postMessage({
    type: 'SYNC_COMPLETE',
    synced,
    remaining: remaining.length
  }));
}

async function sendQueueStatus(client) {
  const queue = await getQueue();
  client.postMessage({ type: 'QUEUE_STATUS', count: queue.length });
}

// ── Queue storage via Cache API ───────────────────────────────────────────────
const META_CACHE = 'xfitting-meta-' + CACHE_VERSION;

async function getQueue() {
  try {
    const cache = await caches.open(META_CACHE);
    const res   = await cache.match('queue');
    if (!res) return [];
    return res.json();
  } catch { return []; }
}

async function setQueue(queue) {
  const cache = await caches.open(META_CACHE);
  await cache.put('queue', new Response(JSON.stringify(queue), {
    headers: { 'Content-Type': 'application/json' }
  }));
}
