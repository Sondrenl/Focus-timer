// Service Worker for Pomodor Focus Timer
// Handles background, Home Screen, and lock-screen notifications on mobile and desktop

let scheduledTimerId = null;
let scheduledResolve = null;
let lastNotifiedSessionId = null;
const ACTIVE_NOTIFICATION_TAG = 'pomodor-active-alert';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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

async function showTimerNotification(title, body, sessionId, allowImmediateRepeat = false) {
  // Deduplicate by sessionId so the scheduled SW timer and main thread never double-fire
  // for the same interval, while the next interval (e.g. Break after Focus) always fires!
  if (!allowImmediateRepeat && sessionId && lastNotifiedSessionId === sessionId) {
    return;
  }
  if (sessionId) {
    lastNotifiedSessionId = sessionId;
  }

  // Always remove any previous notifications in the notification center first
  // so old notifications never bunch up and the new notification triggers a fresh alert.
  await closeAllExistingNotifications();

  return self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: ACTIVE_NOTIFICATION_TAG,
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [250, 100, 250],
  });
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
        Boolean(data.isManualTest)
      )
    );
  } else if (data.type === 'SCHEDULE_TIMER_NOTIFICATION') {
    clearExistingSchedule();
    const delayMs = Math.max(0, (data.targetEndTime || 0) - Date.now());
    const sessionId = data.sessionId || null;

    if (delayMs > 0 && delayMs < 8 * 60 * 60 * 1000) {
      // Hold an active ExtendableEvent lifetime lock via event.waitUntil so mobile browsers
      // do not suspend the Service Worker timer when the user goes to the phone's Home Screen.
      const waitPromise = new Promise((resolve) => {
        scheduledResolve = resolve;
        scheduledTimerId = setTimeout(() => {
          scheduledTimerId = null;
          scheduledResolve = null;
          showTimerNotification(data.title, data.body, sessionId, false).finally(resolve);
        }, delayMs);
      });
      event.waitUntil(waitPromise);
    } else if (delayMs === 0) {
      event.waitUntil(showTimerNotification(data.title, data.body, sessionId, false));
    }
  } else if (data.type === 'CANCEL_TIMER_NOTIFICATION') {
    clearExistingSchedule();
  } else if (data.type === 'CLEAR_NOTIFICATIONS') {
    event.waitUntil(closeAllExistingNotifications());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    closeAllExistingNotifications().then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    )
  );
});
