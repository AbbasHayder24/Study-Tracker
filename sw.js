/**
 * sw.js — Service Worker for Study Tracker Background Web Push (iOS 16.4+ PWA, Android, Desktop)
 */
const PUSH_META_CACHE = 'study-tracker-push-meta-v1';
const PUSH_META_URL = './__study_tracker_push_meta__';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
    await self.registration.showNotification(title, {
      body,
      icon: './image.png',
      badge: './image.png',
      tag: 'study-tracker-timer',
      renotify: true,
      data: { url: './' }
    });
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
