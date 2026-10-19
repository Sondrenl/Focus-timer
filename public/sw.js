// Service Worker for Pomodor Focus Timer
// Handles background, Home Screen, and lock-screen notifications on mobile and desktop

let scheduledTimerId = null;
let scheduledResolve = null;
let lastNotifiedTag = null;

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

async function closePreviousNotifications(exceptTag) {
  try {
    const existing = await self.registration.getNotifications();
    for (const notif of existing) {
      if (!exceptTag || notif.tag !== exceptTag) {
        notif.close();
      }
    }
  } catch {
    // Ignore getNotifications errors
  }
}

async function showTimerNotification(title, body, tag, allowImmediateRepeat = false) {
  const effectiveTag = tag || 'pomodor-timer-alert';

  // Deduplicate by session run tag so the scheduled SW timer and main thread never double-fire
  // for the same session, while a Break session (which has a new tag) always fires immediately!
  if (!allowImmediateRepeat && tag && lastNotifiedTag === tag) {
    return;
  }
  lastNotifiedTag = effectiveTag;

  // Close any prior notification from an earlier session (e.g. close the Focus notification
  // before showing the Break notification) so Android/iOS always pop a fresh heads-up banner.
  await closePreviousNotifications(effectiveTag);

  return self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: effectiveTag,
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: false,
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    clearExistingSchedule();
    event.waitUntil(
      showTimerNotification(data.title, data.body, data.tag, Boolean(data.isManualTest))
    );
  } else if (data.type === 'SCHEDULE_TIMER_NOTIFICATION') {
    clearExistingSchedule();
    const delayMs = Math.max(0, (data.targetEndTime || 0) - Date.now());
    const tag = data.tag || 'pomodor-timer-alert';

    if (delayMs > 0 && delayMs < 8 * 60 * 60 * 1000) {
      // Hold an active ExtendableEvent lifetime lock via event.waitUntil so mobile browsers
      // do not suspend the Service Worker timer when the user goes to the phone's Home Screen.
      const waitPromise = new Promise((resolve) => {
        scheduledResolve = resolve;
        scheduledTimerId = setTimeout(() => {
          scheduledTimerId = null;
          scheduledResolve = null;
          showTimerNotification(data.title, data.body, tag, false).finally(resolve);
        }, delayMs);
      });
      event.waitUntil(waitPromise);
    } else if (delayMs === 0) {
      event.waitUntil(showTimerNotification(data.title, data.body, tag, false));
    }
  } else if (data.type === 'CANCEL_TIMER_NOTIFICATION') {
    clearExistingSchedule();
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
