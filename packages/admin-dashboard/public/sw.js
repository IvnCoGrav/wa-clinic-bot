// Service Worker for Kala Clinic Admin PWA with Web Push VAPID Support & Offline Caching
const CACHE_NAME = 'kala-admin-v6';
const PRECACHE_ASSETS = [
  '/admin/',
  '/admin/manifest.json',
  '/admin/pwa-192x192.png',
  '/admin/pwa-512x512.png',
  '/admin/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[PWA SW] Precache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallbackShell = await caches.match('/admin/');
          if (fallbackShell) return fallbackShell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

/**
 * 🔔 Web Push Notification Event Listener
 * Menerima sinyal push dari server Apple (APNs) / Google (FCM) saat tab sedang tertutup.
 */
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const origin = self.location.origin;
  const resolveUrl = (url) => {
    if (!url) return undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return origin + (url.startsWith('/') ? '' : '/') + url;
  };

  const title = data.title || 'Kala Clinic';
  const options = {
    body: data.body || 'Pesan baru dari pelanggan',
    icon: resolveUrl(data.icon) || resolveUrl('/admin/pwa-192x192.png'),
    badge: resolveUrl(data.badge) || resolveUrl('/admin/pwa-192x192.png'),
    image: resolveUrl(data.image) || resolveUrl(data.icon),
    tag: data.tag || 'chat-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: resolveUrl(data.url) || resolveUrl('/admin/live-chat'),
      ...data.data,
    },
    actions: [
      { action: 'open', title: 'Buka Chat' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * 👆 Notification Click Listener
 * Menutup banner notifikasi dan membuka / memfokuskan tab Live Chat.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const origin = self.location.origin;
  const resolveUrl = (url) => {
    if (!url) return origin + '/admin/live-chat';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return origin + (url.startsWith('/') ? '' : '/') + url;
  };

  const targetUrl = resolveUrl(event.notification.data?.url || '/admin/live-chat');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
