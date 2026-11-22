# Investigation Backlog

Potential issue areas and hardening topics to investigate before or after merging `chore/remove-dead-code` into `main`.

_Captured: 2026-11-20 (branch `chore/remove-dead-code` @ `25bb355`)_

---

## ~~1. Push & Alert Edge Cases (Real-World Reliability)~~ *(Completed in `6a48c9c`)*

- [x] ~~**Silent-miss gap when Web Push is `"active"`**: [`src/context/timer/useTimerAlerts.ts`](../src/context/timer/useTimerAlerts.ts) delegates entirely to Convex Web Push when `navigator.onLine !== false` and `pushStatus === 'active'`. Investigate what happens when:~~
  - ~~The OS/browser silently revokes a push subscription without updating `pushStatus`.~~
  - ~~`navigator.onLine` reports `true` on flaky Wi-Fi or a captive portal.~~
  - ~~Web Push delivery is delayed while the user is actively looking at the app.~~
- [x] ~~**Cross-platform Declarative Web Push behavior**: Validate exact payload/header handling across iOS Safari 18.4+ PWA, macOS Safari 18.5+, Chrome Desktop, and Android, and verify smooth SW transition from `public/sw.js` v1.x to v2.0.0 on existing PWA installs.~~
- [x] ~~**In-app chime + OS notification edge cases**: Verify expected sound behavior when the app is focused vs. backgrounded, and test [`src/services/audio/SoundService.ts`](../src/services/audio/SoundService.ts) after OS sleep/wake or Bluetooth audio device switches.~~

---

## ~~2. Timer Accuracy, Server-vs-Client Races & Midnight Rollover~~ *(Completed in `b449414`)*

- [x] ~~**Client vs. Convex completion race**: Audit `api.timer.complete` vs. scheduled `internal.timer.onTimerCompleted` under clock skew, rapid pause/resume/reset sequences, `autoStartNext`, and aggressive browser background tab throttling.~~
- [x] ~~**New-day reset boundaries**: Audit [`src/context/timer/useTimerNewDayReset.ts`](../src/context/timer/useTimerNewDayReset.ts) and day-range logic across midnight, custom day-start boundaries, DST transitions, and devices waking up the next morning with a stale timer state.~~

---

## 3. Auth, Cloud Sync & Multi-Device Conflicts

- [ ] **Long-idle / mobile wake reconnects**: Verify how Convex WebSocket auth and subscriptions recover after a phone or laptop sleeps for hours (expired/refreshed JWTs, missed timer completions, re-syncing push subscriptions in [`src/hooks/usePushSubscriptionSync.ts`](../src/hooks/usePushSubscriptionSync.ts)).
- [ ] **Offline → online & local → cloud reconciliation**: Audit edge cases when sessions, tags, or settings are edited offline or concurrently across two open devices, and when signing in with pre-existing local data.

---

## 4. Convex Backend Health, Security & Cost

- [ ] **Authorization & validation audit**: Review every public query, mutation, and action under [`convex/`](../convex/) for strict identity/ownership checks, argument bounds, and abuse/rate-limit surfaces.
- [ ] **Query efficiency & OCC contention**: Scan for unbounded `.collect()` queries, hot-document writes (e.g., `active_timers` or `users`), or unnecessary reactive invalidations.
- [ ] **Schema & legacy field cleanup**: Check for leftover optional fields, tables, indexes, or functions from recent dead-code removals (such as `isMobile` in `push_subscriptions`) before merging to `main`.

---

## 5. Stats, Insights & Telemetry Correctness

- [ ] **Edge cases in aggregations**: Verify daily/weekly/streak stats, coffee/tag filters, and ML telemetry pipelines handle empty states, deleted tags, timezone changes, and back-to-back sessions consistently between local storage and Convex.

---

## 6. Frontend Bundle Size, Performance & PWA Resilience

- [ ] **Large single JS bundle**: The Vite production build currently outputs a single ~580 kB main chunk (~161 kB gzip). Evaluate route/view code-splitting (e.g., lazy-loading Stats/Insights and Settings) to speed up initial mobile load.
- [ ] **Chunk-load & deploy transitions**: Review [`src/utils/chunkResilience.ts`](../src/utils/chunkResilience.ts) and check for React render hot spots (e.g., per-second timer ticks causing broad context re-renders).

---

## 7. Production Release Readiness (`chore/remove-dead-code` → `main`)

- [ ] **Prod config parity**: Verify Convex production environment variables (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `SITE_URL`, OAuth origins), schema backward compatibility with existing production documents, and Cloudflare production worker settings before merging and deploying.
