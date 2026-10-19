// Service Worker for Pomodor Focus Timer
// Handles background & lock-screen notifications on mobile (iOS PWA / Android Chrome) and desktop

let scheduledTimerId = null;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function showTimerNotification(title, body) {
  return self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'pomodor-timer-complete',
    renotify: true,
    vibrate: [200, 100, 200, 100, 400],
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
    event.waitUntil(showTimerNotification(data.title, data.body));
  } else if (data.type === 'SCHEDULE_TIMER_NOTIFICATION') {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    const delayMs = Math.max(0, (data.targetEndTime || 0) - Date.now());
    if (delayMs > 0 && delayMs < 8 * 60 * 60 * 1000) {
      scheduledTimerId = setTimeout(() => {
        scheduledTimerId = null;
        showTimerNotification(data.title, data.body);
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
