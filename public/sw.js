// Service Worker for Pomodor Focus Timer
// Version: 2.1.0
// Native Web Push fallback (for browsers without Declarative Web Push),
// visible-client silence coordination, pushsubscriptionchange recovery, and safe notificationclick focus

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
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

function resolveSameOriginUrl(rawUrl) {
  const fallback = new URL('/', self.location.origin).href;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return fallback;
  try {
    const parsed = new URL(rawUrl.trim(), self.location.origin);
    if (parsed.origin === self.location.origin) {
      return parsed.href;
    }
  } catch {
    // Fall back to app root
  }
  return fallback;
}

async function hasAnyVisibleClient() {
  try {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clientList) {
      if (client.visibilityState === 'visible') {
        return true;
      }
    }
  } catch {
    // Ignore matchAll errors
  }
  return false;
}

async function closeOlderSessionNotifications(keepTag) {
  if (typeof self.registration.getNotifications !== 'function') return;
  try {
    const existing = await self.registration.getNotifications();
    for (const notif of existing) {
      if (
        notif.tag &&
        notif.tag !== keepTag &&
        notif.tag.startsWith('pomodor-session-')
      ) {
        notif.close();
      }
    }
  } catch {
    // Ignore getNotifications errors
  }
}

self.addEventListener('push', (event) => {
  let title = 'Pomodor — Focus session complete';
  let body = 'Your timer session has ended.';
  let tag = 'pomodor-alert';
  let silent = false;
  let icon = '/icon-192.png';
  let badge = '/badge-72.png';
  let navigate = '/';
  let timestamp;
  let hasExplicitTag = false;

  if (event.notification && typeof event.notification === 'object') {
    const notif = event.notification;
    if (typeof notif.title === 'string' && notif.title.trim()) {
      title = notif.title.trim().slice(0, 100);
    }
    if (typeof notif.body === 'string' && notif.body.trim()) {
      body = notif.body.trim().slice(0, 250);
    }
    if (typeof notif.tag === 'string' && notif.tag.trim()) {
      tag = notif.tag.trim().slice(0, 128);
      hasExplicitTag = true;
    }
    if (typeof notif.silent === 'boolean') {
      silent = notif.silent;
    }
    if (typeof notif.icon === 'string' && notif.icon.trim()) {
      icon = notif.icon.trim();
    }
    if (typeof notif.badge === 'string' && notif.badge.trim()) {
      badge = notif.badge.trim();
    }
    if (typeof notif.navigate === 'string' && notif.navigate.trim()) {
      navigate = notif.navigate.trim();
    }
    if (typeof notif.timestamp === 'number' && Number.isFinite(notif.timestamp)) {
      timestamp = Math.round(notif.timestamp);
    }
  } else if (event.data) {
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
        hasExplicitTag = true;
      }
      if (typeof notif.silent === 'boolean') {
        silent = notif.silent;
      }
      if (typeof notif.icon === 'string' && notif.icon.trim()) {
        icon = notif.icon.trim();
      }
      if (typeof notif.badge === 'string' && notif.badge.trim()) {
        badge = notif.badge.trim();
      }
      if (typeof notif.navigate === 'string' && notif.navigate.trim()) {
        navigate = notif.navigate.trim();
      }
      if (typeof notif.timestamp === 'number' && Number.isFinite(notif.timestamp)) {
        timestamp = Math.round(notif.timestamp);
      }
    } catch {
      const text = event.data.text();
      if (text) {
        body = text.trim().slice(0, 250);
      }
    }
  }

  const safeNavigate = resolveSameOriginUrl(navigate);
  const isTestAlert = tag.startsWith('pomodor-test-');

  event.waitUntil(
    (async () => {
      // When the app is actively visible on screen, the page plays the instant in-app Web Audio
      // chime for timer completions. Keep the OS notification silent to prevent double-sound
      // while still satisfying browser userVisibleOnly requirements.
      const visible = !isTestAlert && (await hasAnyVisibleClient());
      const effectiveSilent = silent || visible;

      if (tag.startsWith('pomodor-session-')) {
        await closeOlderSessionNotifications(tag);
      }

      const options = {
        body,
        icon,
        badge,
        tag,
        silent: effectiveSilent,
        data: { navigate: safeNavigate },
      };

      if (typeof timestamp === 'number') {
        options.timestamp = timestamp;
      }
      if (!hasExplicitTag && !effectiveSilent) {
        options.renotify = true;
      }

      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const appServerKey = event.oldSubscription?.options?.applicationServerKey;
        if (appServerKey && self.registration.pushManager) {
          await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey,
          });
        }
      } catch {
        // Ignore silent re-subscribe errors; open clients will resync with Convex
      }

      try {
        const clientList = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of clientList) {
          client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
        }
      } catch {
        // Ignore broadcast errors
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = resolveSameOriginUrl(
    event.notification.data && typeof event.notification.data.navigate === 'string'
      ? event.notification.data.navigate
      : '/'
  );

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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

