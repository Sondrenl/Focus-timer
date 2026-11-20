// Service Worker for Pomodor Focus Timer
// Version: 1.0.7
// Handles Web Push, background, Home Screen, lock-screen, and smartwatch-friendly notifications

const RECENT_NOTIFIED_LIMIT = 20;

const notifiedSessionIds = [];

function hasNotifiedSession(sessionId) {
  if (!sessionId) return false;
  return notifiedSessionIds.includes(sessionId);
}

function recordNotifiedSession(sessionId) {
  if (!sessionId) return;
  const idx = notifiedSessionIds.indexOf(sessionId);
  if (idx !== -1) {
    notifiedSessionIds.splice(idx, 1);
  }
  notifiedSessionIds.push(sessionId);
  if (notifiedSessionIds.length > RECENT_NOTIFIED_LIMIT) {
    notifiedSessionIds.shift();
  }
}

function isMobileUA(hint) {
  if (typeof hint === 'boolean') return hint;
  try {
    const ua = self.navigator && self.navigator.userAgent ? self.navigator.userAgent : '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  } catch {
    return false;
  }
}

function isPureSafariBrowser() {
  try {
    const ua = self.navigator && self.navigator.userAgent ? self.navigator.userAgent : '';
    return /AppleWebKit/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg|EdgiOS|OPR|Android/i.test(ua);
  } catch {
    return false;
  }
}

function getNotificationTag(sessionId, allowImmediateRepeat) {
  if (allowImmediateRepeat) {
    return 'pomodor-test-' + Date.now();
  }
  if (sessionId) {
    return 'pomodor-session-' + sessionId;
  }
  return 'pomodor-alert-' + Date.now();
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Safely clear any legacy or obsolete CacheStorage entries on activation
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

async function closeAllExistingNotifications() {
  try {
    const existing = await self.registration.getNotifications();
    for (const notif of existing) {
      notif.close();
    }
  } catch {
    // Ignore getNotifications errors
  }
}

async function closeOlderNotifications(keepTag) {
  try {
    const existing = await self.registration.getNotifications();
    for (const notif of existing) {
      if (notif.tag !== keepTag) {
        notif.close();
      }
    }
  } catch {
    // Ignore getNotifications errors
  }
}

/**
 * Checks whether any app window on this device is currently open and visible.
 */
async function hasAnyVisibleClient() {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.visibilityState === 'visible') {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function showTimerNotification(title, body, sessionId, allowImmediateRepeat = false, extra = {}) {
  const notifTag = getNotificationTag(sessionId, allowImmediateRepeat);
  const silent = Boolean(extra.silent);

  if (!allowImmediateRepeat && sessionId) {
    if (hasNotifiedSession(sessionId) && !extra.forceRequiredForSafari) {
      return;
    }
    try {
      const existingWithTag = await self.registration.getNotifications({ tag: notifTag });
      if (existingWithTag.length > 0 && !extra.forceRequiredForSafari) {
        recordNotifiedSession(sessionId);
        return;
      }
    } catch {
      // Ignore getNotifications errors
    }
    recordNotifiedSession(sessionId);
  }

  // Close older notifications BEFORE posting the new one so Android's wearable bridge
  // never sees a post-close race condition that suppresses watch delivery.
  await closeOlderNotifications(notifTag);

  const mobile = isMobileUA(extra.isMobile);
  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: notifTag,
    timestamp: Date.now(),
    renotify: !silent,
    silent,
  };

  if (!silent) {
    options.vibrate = [250, 100, 250];
  }
  if (!mobile) {
    options.requireInteraction = true;
  }

  await self.registration.showNotification(title, options);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'MARK_SESSION_NOTIFIED') {
    if (data.sessionId) {
      recordNotifiedSession(data.sessionId);
    }
  }
});

self.addEventListener('push', (event) => {
  let title = 'Pomodor — Focus session complete';
  let body = 'Your timer session has ended.';
  let sessionId = null;
  let isTest = false;
  let isMobileHint;
  let completedAtMs = 0;
  let silent = false;

  if (event.data) {
    try {
      const json = event.data.json();
      if (typeof json.title === 'string' && json.title.trim()) {
        title = json.title.trim().slice(0, 100);
      }
      if (typeof json.body === 'string' && json.body.trim()) {
        body = json.body.trim().slice(0, 250);
      }
      if (typeof json.sessionId === 'string' && json.sessionId.trim()) {
        sessionId = json.sessionId.trim().slice(0, 128);
      }
      if (typeof json.isTest === 'boolean') {
        isTest = json.isTest;
      }
      if (typeof json.isMobile === 'boolean') {
        isMobileHint = json.isMobile;
      }
      if (typeof json.completedAtMs === 'number' && Number.isFinite(json.completedAtMs)) {
        completedAtMs = json.completedAtMs;
      }
      if (typeof json.silent === 'boolean') {
        silent = json.silent;
      }
    } catch {
      const text = event.data.text();
      if (text) {
        body = text.trim().slice(0, 250);
      }
    }
  }

  event.waitUntil(
    (async () => {
      const notifTag = getNotificationTag(sessionId, isTest);
      const visible = await hasAnyVisibleClient();
      const isStalePush =
        !isTest && completedAtMs > 0 && Date.now() - completedAtMs > 2 * 60 * 1000;
      let alreadyDisplayed = isStalePush;

      if (!isTest && sessionId && !alreadyDisplayed) {
        if (hasNotifiedSession(sessionId)) {
          alreadyDisplayed = true;
        } else {
          try {
            const existing = await self.registration.getNotifications({ tag: notifTag });
            if (existing.length > 0) {
              alreadyDisplayed = true;
            }
          } catch {
            // Ignore
          }
        }
      }

      if (!alreadyDisplayed) {
        await showTimerNotification(title, body, sessionId, isTest, {
          isMobile: isMobileHint,
          silent,
        });
        return;
      }

      // If a notification was already shown for this session on-device (or arrived stale):
      // - Chrome/Firefox allow skipping showNotification when a visible client is open.
      // - Pure Safari / iOS WebKit strictly enforces userVisibleOnly and can revoke subscriptions
      //   after repeated silent pushes, so update cleanly with silent: true, renotify: false.
      if (!visible || isPureSafariBrowser()) {
        await showTimerNotification(title, body, sessionId, isTest, {
          isMobile: isMobileHint,
          silent: true,
          forceRequiredForSafari: true,
        });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    closeAllExistingNotifications().then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: false }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(new URL('/', self.location.origin).href);
        }
      })
    )
  );
});
