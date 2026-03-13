/* XFitting Service Worker — v1
   Caches the app shell for offline access.
   Queues failed Worker API calls when offline and replays them on reconnect.
*/

const CACHE_NAME   = 'xfitting-shell-v1';
const WORKER_URL   = 'https://xfitting-lookup.alfixedinc88.workers.dev';
const QUEUE_KEY    = 'xfitting-sync-queue';

// ── App shell: cache on install ──────────────────────────────────────────────
const SHELL_ASSETS = [
  '/',
  '/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Remove old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Worker API calls — network first, queue on failure
  if (url.origin === new URL(WORKER_URL).origin) {
    if (e.request.method === 'POST') {
      e.respondWith(handleWorkerPost(e.request.clone()));
    }
    // GETs just pass through — no caching of API responses
    return;
  }

  // 2. Google Fonts / external — network only, no caching
  if (!url.origin.includes(self.location.hostname) && !url.pathname.startsWith('/')) {
    return;
  }

  // 3. App shell — cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache successful HTML/JS/CSS responses
        if (res.ok && ['text/html','text/css','application/javascript'].some(t =>
          res.headers.get('content-type')?.includes(t)
        )) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline — serve cached index for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html') || caches.match('/');
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
    // Network failure — only queue /inventory/log POSTs
    const url = new URL(request.url);
    if (url.pathname === '/inventory/log') {
      await queueRequest(request);
      // Return a fake success so the UI shows "queued" state
      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        message: 'Offline — entry queued and will sync when connection returns.'
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    // All other POSTs — let the error propagate normally
    throw new Error('Network unavailable');
  }
}

async function queueRequest(request) {
  const body = await request.text();
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

// Also replay when the SW receives an online message from the page
self.addEventListener('message', e => {
  if (e.data?.type === 'ONLINE') replayQueue();
  if (e.data?.type === 'QUEUE_STATUS') sendQueueStatus(e.source);
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
      if (!res.ok) remaining.push(item); // keep if server error
    } catch {
      remaining.push(item); // keep if still offline
    }
  }
  await setQueue(remaining);

  // Notify all open tabs
  const clients = await self.clients.matchAll();
  const synced = queue.length - remaining.length;
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

// ── Simple queue storage via Cache API (no IndexedDB needed) ─────────────────
const META_CACHE = 'xfitting-meta-v1';

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
