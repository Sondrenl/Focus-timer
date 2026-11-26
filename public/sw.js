// Service Worker for Pomodor Focus Timer
// Version: 2.4.0
// Native Web Push fallback (for browsers without Declarative Web Push),
// focused-client silence coordination, background pushsubscriptionchange rotation, and safe notificationclick focus

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

function resolveSameOriginUrl(rawUrl, fallbackPath = '/') {
  const fallback = new URL(fallbackPath, self.location.origin).href;
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

async function hasAnyFocusedVisibleClient() {
  try {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clientList) {
      // Require both visible AND focused so mobile lock-screen / split-screen states
      // where visibilityState briefly stays 'visible' do not silently mute the OS alert.
      if (client.visibilityState === 'visible' && client.focused === true) {
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
  const safeIcon = resolveSameOriginUrl(icon, '/icon-192.png');
  const safeBadge = resolveSameOriginUrl(badge, '/badge-72.png');
  const isTestAlert = tag.startsWith('pomodor-test-');

  event.waitUntil(
    (async () => {
      // When the app is actively visible and focused on screen, the page plays the instant in-app
      // Web Audio chime for timer completions. Keep the OS notification silent to prevent double-sound
      // while still satisfying browser userVisibleOnly requirements.
      const focusedVisible = !isTestAlert && (await hasAnyFocusedVisibleClient());
      const effectiveSilent = silent || focusedVisible;

      const options = {
        body,
        icon: safeIcon,
        badge: safeBadge,
        tag,
        silent: effectiveSilent,
        data: { navigate: safeNavigate },
      };

      if (typeof timestamp === 'number') {
        options.timestamp = timestamp;
      }
      if (!effectiveSilent) {
        options.vibrate = [200, 100, 200];
        if (!hasExplicitTag) {
          options.renotify = true;
        }
      }

      // Show the notification immediately before any secondary cleanup to minimize latency
      // and avoid iOS/browser silent-push timeout penalties.
      await self.registration.showNotification(title, options);

      if (tag.startsWith('pomodor-session-')) {
        await closeOlderSessionNotifications(tag);
      }
    })()
  );
});

function urlBase64ToUint8ArraySw(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let newSub = event.newSubscription || null;
      if (!newSub) {
        try {
          let appServerKey = event.oldSubscription?.options?.applicationServerKey || null;
          if (!appServerKey) {
            const meta = await readPushMeta();
            if (meta && typeof meta.vapidPublicKey === 'string' && meta.vapidPublicKey.trim()) {
              appServerKey = urlBase64ToUint8ArraySw(meta.vapidPublicKey.trim());
            }
          }
          if (appServerKey && self.registration.pushManager) {
            newSub = await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: appServerKey,
            });
          }
        } catch {
          // Ignore silent re-subscribe errors; open clients will resync with Convex
        }
      }

      if (newSub && typeof newSub.toJSON === 'function') {
        try {
          await syncRotatedSubscriptionToBackend(newSub);
        } catch {
          // Ignore background rotation errors; next app open will resync
        }
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

const PUSH_META_DB = 'pomodor_push_meta_v1';
const PUSH_META_STORE = 'meta';
const PUSH_META_KEY = 'current';

function openPushMetaDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const req = indexedDB.open(PUSH_META_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PUSH_META_STORE)) {
          db.createObjectStore(PUSH_META_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          try {
            db.close();
          } catch {
            // Ignore
          }
          return;
        }
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // Ignore
          }
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

async function readPushMeta() {
  const db = await openPushMetaDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // Ignore
      }
      resolve(val);
    };
    try {
      const tx = db.transaction(PUSH_META_STORE, 'readonly');
      const req = tx.objectStore(PUSH_META_STORE).get(PUSH_META_KEY);
      req.onsuccess = () => finish(req.result || null);
      req.onerror = () => finish(null);
      tx.onerror = () => finish(null);
      tx.onabort = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

async function writePushMeta(meta) {
  const db = await openPushMetaDb();
  if (!db) return;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // Ignore
      }
      resolve();
    };
    try {
      const tx = db.transaction(PUSH_META_STORE, 'readwrite');
      tx.objectStore(PUSH_META_STORE).put(meta, PUSH_META_KEY);
      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    } catch {
      finish();
    }
  });
}

function generateSwRotationToken() {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    return null;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256HexSw(raw) {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
    return null;
  }
  const encoded = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function syncRotatedSubscriptionToBackend(subscription) {
  const subJson = subscription.toJSON();
  const endpoint = subscription.endpoint || '';
  const p256dh = (subJson && subJson.keys && subJson.keys.p256dh) || '';
  const auth = (subJson && subJson.keys && subJson.keys.auth) || '';
  if (!endpoint || !p256dh || !auth) return;

  const meta = await readPushMeta();
  if (!meta || !meta.convexSiteUrl || !meta.deviceId || !meta.rotationToken) {
    return;
  }

  const nextRotationToken = generateSwRotationToken();
  const nextRotationTokenHash = nextRotationToken ? await sha256HexSw(nextRotationToken) : null;

  const baseUrl = meta.convexSiteUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/push/rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: meta.deviceId,
      rotationToken: meta.rotationToken,
      ...(nextRotationTokenHash ? { nextRotationTokenHash } : {}),
      endpoint,
      p256dh,
      auth,
    }),
  });

  if (response.ok && nextRotationToken && nextRotationTokenHash) {
    await writePushMeta({
      convexSiteUrl: meta.convexSiteUrl,
      deviceId: meta.deviceId,
      rotationToken: nextRotationToken,
      ...(meta.vapidPublicKey ? { vapidPublicKey: meta.vapidPublicKey } : {}),
    });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = resolveSameOriginUrl(
    event.notification.data && typeof event.notification.data.navigate === 'string'
      ? event.notification.data.navigate
      : '/'
  );

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          try {
            return await client.focus();
          } catch {
            // Fall through to openWindow if focus() rejects on a frozen/discarded mobile client
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

