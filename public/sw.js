// Service Worker for Pomodor Focus Timer
// Version: 2.0.0
// Minimal Web Push fallback (for browsers without Declarative Web Push) and notification click focus

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      (async () => {
        if (typeof caches !== 'undefined') {
          try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
          } catch {
            // Ignore cache cleanup errors
          }
        }
      })(),
    ])
  );
});

self.addEventListener('push', (event) => {
  let title = 'Pomodor — Focus session complete';
  let body = 'Your timer session has ended.';
  let tag = 'pomodor-alert';
  let silent = false;
  let icon = '/icon-192.png';
  let navigate = '/';

  if (event.data) {
    try {
      const json = event.data.json();
      // Support both Declarative Web Push ({ web_push: 8030, notification: {...} }) and flat payloads
      const notif =
        json && typeof json.notification === 'object' && json.notification !== null
          ? json.notification
          : json;

      if (typeof notif.title === 'string' && notif.title.trim()) {
        title = notif.title.trim().slice(0, 100);
      }
      if (typeof notif.body === 'string' && notif.body.trim()) {
        body = notif.body.trim().slice(0, 250);
      }
      if (typeof notif.tag === 'string' && notif.tag.trim()) {
        tag = notif.tag.trim().slice(0, 128);
      }
      if (typeof notif.silent === 'boolean') {
        silent = notif.silent;
      }
      if (typeof notif.icon === 'string' && notif.icon.trim()) {
        icon = notif.icon.trim();
      }
      if (typeof notif.navigate === 'string' && notif.navigate.trim()) {
        navigate = notif.navigate.trim();
      }
    } catch {
      const text = event.data.text();
      if (text) {
        body = text.trim().slice(0, 250);
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/badge-72.png',
      tag,
      silent,
      data: { navigate },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && typeof event.notification.data.navigate === 'string'
      ? event.notification.data.navigate
      : null) || new URL('/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: false }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
