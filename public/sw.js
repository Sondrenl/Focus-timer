// Service Worker for Pomodor Focus Timer
// Handles background & lock-screen notifications on mobile (iOS PWA / Android Chrome) and desktop

let scheduledTimerId = null;
let lastNotificationTimeMs = 0;
const NOTIFICATION_TAG = 'pomodor-timer-alert';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function showTimerNotification(title, body, allowImmediateRepeat = false) {
  const now = Date.now();
  // Prevent duplicate notifications if both the scheduled SW timer and main thread fire at 00:00
  if (!allowImmediateRepeat && now - lastNotificationTimeMs < 2500) {
    return;
  }
  lastNotificationTimeMs = now;

  try {
    // Close any prior notification with the same tag first so mobile & desktop OSes
    // always present a fresh banner without stacking multiple notifications in the shade.
    const existing = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
    for (const notif of existing) {
      notif.close();
    }
  } catch {
    // Ignore getNotifications errors
  }

  return self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: NOTIFICATION_TAG,
    renotify: true,
    requireInteraction: false,
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    event.waitUntil(showTimerNotification(data.title, data.body, Boolean(data.isManualTest)));
  } else if (data.type === 'SCHEDULE_TIMER_NOTIFICATION') {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    const delayMs = Math.max(0, (data.targetEndTime || 0) - Date.now());
    if (delayMs > 0 && delayMs < 8 * 60 * 60 * 1000) {
      scheduledTimerId = setTimeout(() => {
        scheduledTimerId = null;
        showTimerNotification(data.title, data.body, false);
      }, delayMs);
    }
  } else if (data.type === 'CANCEL_TIMER_NOTIFICATION') {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
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
  );
});
