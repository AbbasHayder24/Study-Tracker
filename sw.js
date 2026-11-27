/**
 * sw.js — Service Worker for Study Tracker (Fast Offline Cache + Background Web Push)
 */
const APP_CACHE = 'study-tracker-shell-v81';
const PUSH_META_CACHE = 'study-tracker-push-meta-v1';
const PUSH_META_URL = './__study_tracker_push_meta__';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './image.png',
  './css/styles.css?v=81',
  './js/config.js?v=81',
  './js/i18n.js?v=81',
  './js/state.js?v=81',
  './js/google-sync.js?v=81',
  './js/push.js?v=81',
  './js/ledger.js?v=81',
  './js/ui.js?v=81',
  './js/app.js?v=81',
  './js/bookshelf.js?v=81',
  './js/focus.js?v=81',
  './js/stats.js?v=81',
  './js/reviews.js?v=81',
  './js/groups.js?v=81',
  './js/challenge.js?v=81',
  './js/settings.js?v=81',
  './js/profile.js?v=81'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
    .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
    .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
    .then((keys) => Promise.all(
      keys
      .filter((k) => k.startsWith('study-tracker-shell-') && k !== APP_CACHE)
      .map((k) => caches.delete(k))
    ))
    .then(() => self.clients.claim())
  );
});

// Stale-While-Revalidate for same-origin static files (instant boot + background updates)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('__study_tracker_push_meta__')) return;
  
  // Network-First for HTML pages so updates on GitHub appear immediately
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(req, clone).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req))
    );
    return;
  }
  
  event.respondWith(
    caches.open(APP_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

async function getSavedPushMeta() {
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const res = await cache.match(PUSH_META_URL);
    if (res) {
      return await res.json();
    }
  } catch (e) {}
  return null;
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = null;
    if (event.data) {
      try {
        payload = event.data.json();
      } catch (e) {
        try {
          payload = { body: event.data.text() };
        } catch (e2) {}
      }
    }
    
    const saved = await getSavedPushMeta();
    const title = (payload && payload.title) || (saved && saved.title) || 'Study Session Complete! 📚';
    const body = (payload && payload.body) || (saved && saved.body) || 'Your Focus timer has finished. Great work!';
    
    // Safari / iOS strictly requires showing a visible notification on every push event
    const notifOpts = {
      body,
      icon: './image.png',
      badge: './image.png',
      tag: 'study-tracker-timer',
      renotify: true,
      vibrate: [120, 60, 120],
      timestamp: Date.now(),
      data: { url: './' }
    };
    try {
      notifOpts.actions = [
        { action: 'open', title: '📚 Open App' }
      ];
      await self.registration.showNotification(title, notifOpts);
    } catch (e) {
      delete notifOpts.actions;
      await self.registration.showNotification(title, notifOpts);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});