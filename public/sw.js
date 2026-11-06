// Service Worker for Pomodor Focus Timer
// Version: 1.0.4
// Handles background, Home Screen, and lock-screen notifications with multi-device arbitration

let scheduledTimerId = null;
let scheduledResolve = null;
let lastNotifiedSessionId = null;

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

function clearExistingSchedule() {
  if (scheduledTimerId) {
    clearTimeout(scheduledTimerId);
    scheduledTimerId = null;
  }
  if (scheduledResolve) {
    const resolve = scheduledResolve;
    scheduledResolve = null;
    resolve();
  }
}

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

/**
 * Checks whether this device should suppress its notification to prevent double-alerts:
 * - If an app tab on this device is currently open and visible, foreground in-app alerts handle it.
 */
async function shouldSuppressNotification(_sessionType, _sessionId, _isMobileDevice) {
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

async function showTimerNotification(title, body, sessionId, allowImmediateRepeat = false) {
  if (!allowImmediateRepeat && sessionId && lastNotifiedSessionId === sessionId) {
    return;
  }
  if (sessionId) {
    lastNotifiedSessionId = sessionId;
  }

  const notifTag = allowImmediateRepeat ? ('pomodor-test-' + Date.now()) : ('pomodor-alert-' + Date.now());

  await self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: notifTag,
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [250, 100, 250],
  });

  // Clean up older notifications in the background without canceling the current one
  self.registration.getNotifications().then((existing) => {
    for (const notif of existing) {
      if (notif.tag !== notifTag) {
        notif.close();
      }
    }
  }).catch(() => {});
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    clearExistingSchedule();
    event.waitUntil(
      showTimerNotification(
        data.title,
        data.body,
        data.sessionId || null,
        true // Always allow explicit SHOW_NOTIFICATION requests from the client
      )
    );
  } else if (data.type === 'SCHEDULE_TIMER_NOTIFICATION') {
    clearExistingSchedule();
    const delayMs = Math.max(0, (data.targetEndTime || 0) - Date.now());
    const sessionId = data.sessionId || null;
    const sessionType = data.sessionType || 'WORK';
    const isMobileDevice = Boolean(data.isMobile);

    if (delayMs > 0 && delayMs < 8 * 60 * 60 * 1000) {
      const waitPromise = new Promise((resolve) => {
        scheduledResolve = resolve;
        scheduledTimerId = setTimeout(async () => {
          scheduledTimerId = null;
          scheduledResolve = null;

          try {
            const suppress = await shouldSuppressNotification(sessionType, sessionId, isMobileDevice);
            if (!suppress) {
              await showTimerNotification(data.title, data.body, sessionId, false);
            }
          } catch {
            await showTimerNotification(data.title, data.body, sessionId, false);
          } finally {
            resolve();
          }
        }, delayMs);
      });
      event.waitUntil(waitPromise);
    } else if (delayMs === 0) {
      event.waitUntil(
        shouldSuppressNotification(sessionType, sessionId, isMobileDevice).then((suppress) => {
          if (!suppress) {
            return showTimerNotification(data.title, data.body, sessionId, false);
          }
        })
      );
    }
  } else if (data.type === 'MARK_SESSION_NOTIFIED') {
    clearExistingSchedule();
    if (data.sessionId) {
      lastNotifiedSessionId = data.sessionId;
    }
  } else if (data.type === 'CANCEL_TIMER_NOTIFICATION') {
    clearExistingSchedule();
  } else if (data.type === 'CLEAR_NOTIFICATIONS') {
    event.waitUntil(closeAllExistingNotifications());
  }
});

self.addEventListener('push', (event) => {
  let title = 'Pomodor Focus Timer';
  let body = 'Your timer session has ended.';
  let sessionId = null;

  if (event.data) {
    try {
      const json = event.data.json();
      if (typeof json.title === 'string' && json.title.trim()) {
        title = json.title.trim().slice(0, 100);
      }
      if (typeof json.body === 'string' && json.body.trim()) {
        body = json.body.trim().slice(0, 250);
      }
      if (typeof json.sessionId === 'string') {
        sessionId = json.sessionId.slice(0, 64);
      }
    } catch {
      const text = event.data.text();
      if (text) {
        body = text.trim().slice(0, 250);
      }
    }
  }

  event.waitUntil(
    showTimerNotification(title, body, sessionId, false)
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
