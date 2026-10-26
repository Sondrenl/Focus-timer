// Service Worker for Pomodor Focus Timer
// Handles background, Home Screen, and lock-screen notifications with multi-device arbitration

let scheduledTimerId = null;
let scheduledResolve = null;
let lastNotifiedSessionId = null;
let cachedAuthToken = null;
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

/**
 * Checks whether this device should suppress its notification to prevent double-alerts:
 * - If an app tab on this device is currently open and visible, foreground in-app alerts handle it.
 * - Queries GET /api/timer just-in-time to check peer presence:
 *   - For Focus (WORK): if desktop is active, desktop chimes/notifies -> suppress on mobile.
 *   - For Breaks: if desktop is active AND visible (user sitting at laptop), suppress on mobile.
 *     If laptop lid was closed or desktop went idle, mobile phone alerts!
 *   - If timer was already cancelled, reset, or completed on another device -> suppress on mobile.
 */
async function shouldSuppressNotification(sessionType, sessionId, isMobileDevice) {
  try {
    // 1. If this device has an open visible tab, the in-app timer handles the alert
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.visibilityState === 'visible') {
        return true;
      }
    }

    // 2. Query cloud timer and peer presence with a 2-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const headers = {
      'Accept': 'application/json',
    };
    if (cachedAuthToken) {
      headers['Authorization'] = `Bearer ${cachedAuthToken}`;
    }

    const res = await fetch('/api/timer', {
      method: 'GET',
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      // If unauthorized or network error, do not suppress (ensure user is notified)
      return false;
    }

    const data = await res.json();
    if (!data) return false;

    const timer = data.timer;
    const peer = data.peerPresence || {};

    // 3. Stale session detection: if timer was stopped, cancelled, or switched to another session
    if (timer) {
      if (sessionId && timer.timerRunId && timer.timerRunId !== sessionId) {
        return true; // Already transitioned
      }
      if (timer.status === 'IDLE' && timer.targetEndTime === null) {
        return true; // Timer was reset or stopped
      }
    }

    // 4. Device arbitration for Mobile:
    if (isMobileDevice) {
      if (sessionType === 'WORK') {
        // Work / Focus: if desktop is actively awake, desktop handles it (no double chime!)
        if (peer.desktopActive) {
          return true;
        }
      } else {
        // Break: if desktop is awake AND visible (user at laptop), desktop handles it.
        // If desktop is closed or user stepped away, mobile phone alerts!
        if (peer.desktopActive && peer.desktopVisible) {
          return true;
        }
      }
    } else {
      // Desktop client: for breaks, suppress only if mobile is actively visible
      if (sessionType !== 'WORK' && peer.mobileVisible) {
        return true;
      }
    }

    return false;
  } catch {
    // On any network error, fail open so user never misses their timer
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

  await closeAllExistingNotifications();

  return self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: allowImmediateRepeat ? ('pomodor-test-' + Date.now()) : ACTIVE_NOTIFICATION_TAG,
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [250, 100, 250],
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.token) {
    cachedAuthToken = data.token;
  }

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
  } else if (data.type === 'SET_AUTH_TOKEN') {
    if (data.token) {
      cachedAuthToken = data.token;
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
