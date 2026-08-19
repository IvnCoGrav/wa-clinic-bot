// Service Worker for Kala Clinic Admin PWA with Web Push VAPID Support
const CACHE_NAME = 'kala-admin-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
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
  // Pass-through network request to satisfy Chrome PWA installability criteria
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
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
    icon: resolveUrl(data.icon) || resolveUrl('/admin/favicon.ico'),
    badge: resolveUrl(data.badge) || resolveUrl('/admin/favicon.ico'),
    image: resolveUrl(data.image) || resolveUrl(data.icon),
    tag: data.tag || 'chat-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: resolveUrl(data.url) || resolveUrl('/admin/#/live-chat'),
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
  const targetUrl = event.notification.data?.url || (self.location.origin + '/admin/#/live-chat');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. Jika tab admin sudah terbuka, fokuskan tab tersebut
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // 2. Jika belum ada tab terbuka, buka window baru
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
