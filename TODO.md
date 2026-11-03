# Project Roadmap & Backlog (TODO)

This document tracks upcoming features, UX refinements, and architectural enhancements for Focus Timer. It serves as the primary task list across development sessions.

---

## 📋 Active Backlog

### 1. 📱 Mobile UX in Statistics Tab
* **Goal:** Optimize touch targets and layout density for mobile devices.
* **Details:**
  * Address dense clusters of small buttons, arrows, and cramped infographics on smaller touch screens.
  * Increase minimum tap target sizes to at least 44×44px (Apple HIG & Material standard).
  * Improve scrolling/swipe navigation for time period pagination (Day, Week, Month, Year).

### 2. 🔔 Mobile Notification Asset & Icon Framing
* **Goal:** Fix the notification icon framing on mobile devices.
* **Details:**
  * Current issue: The icon appears as a square with the logo tiny in the top-left corner on Android/iOS notifications.
  * Solution: Create properly padded, centered, and transparent maskable/monochrome icons (`icon-192.png`, `badge-72.png`, Android notification vector) following Android and PWA notification specifications.

### 3. 👤 Profile Page & Focus Targets
* **Goal:** Review and enhance user profile personalization and goal setting.
* **Details:**
  * Daily/weekly focus time targets (progress bars towards daily hours goal).
  * Profile editing capabilities (display name, avatar customization).
  * Account management and data export options.

### 4. 🎨 Component Active / Pressed State Colors
* **Goal:** Replace harsh/darker select and active state highlights across components.
* **Details:**
  * Currently, pressing or selecting buttons/cards applies a dark shade that looks unpolished.
  * Refine CSS transitions, active scale effects, subtle opacity/glow states, or softer tint overlays matching the warm minimalist aesthetic.

### 5. 📱 Desktop vs. Mobile Visual & Font Consistency
* **Goal:** Audit and eliminate unintentional discrepancies between mobile and desktop views.
* **Details:**
  * **Timer Font:** Investigate why mobile renders a different font for the timer digits than desktop (e.g., system font fallback vs. loaded font like JetBrains Mono or tabular numerals).
  * Ensure consistent letter-spacing, tabular numbers (`font-variant-numeric: tabular-nums` / `font-mono`) to prevent digit jitter.
  * Check for unintended layout divergences in buttons, paddings, and header states.

### 6. ⏱️ Timer Settings & Duration Editing UX
* **Goal:** Make configuring work, short break, and long break intervals intuitive and frictionless.
* **Details:**
  * Current input boxes or sliders can feel clunky on mobile and desktop.
  * Explore quick presets (e.g., 25/5, 50/10, 90/20), steppers (+/- 1 or 5 mins), or streamlined scrubbers with instant preview.

### 7. 🎨 Logo Design Revision
* **Goal:** Modernize and polish the application logo and branding.
* **Details:**
  * Revisit the coffee / pomodoro / focus visual identity.
  * Produce vector assets (SVG), high-DPI favicons, and PWA splash screen assets.

---

## ✅ Completed Tasks

### 📊 Meaningful Insights Refactoring
* **Completed:** Implemented deep multi-point correlation analytics engine in `src/utils/insights.ts` and enhanced `SmartInsightPanel.tsx`.
* **Delivered:**
  * **Precision Peak Focus Window:** Sliding 2.5h flow state window identifying exact hours (e.g., *"Your peak focus window is 09:00–11:30"*).
  * **Caffeine Kick-in Latency:** Tracks the minute-level transition from brewing coffee to deep work (e.g., *"Focus kicks in ~18m after coffee"*).
  * **Afternoon Slump Defense:** Correlates post-lunch caffeine timing with sustained afternoon focus blocks.
  * **Break Fatigue & Cadence:** Detects drop in stamina after 3+ continuous sessions without breaks (*"Focus drops after 3 consecutive sessions without a break"*), marathon flow, and healthy work-rest pacing.
  * **Day-of-Week Powerhouse & Distribution:** Identifies top-performing weekdays (*"Tuesday is your Powerhouse Day"*) and contrasts weekend focus vs. clean workweek boundaries.
  * **Consistency Streaks & Milestones:** Detects multi-day focus streaks and major volume landmarks (10h, 20h, 25+ sessions).
  * **Context Switching vs. Deep Dive Mode:** Compares single-project focus output against fragmented multi-tag days (*"+45% focus on single-topic days"*).
  * **Caffeine Sweet Spot & Efficiency:** Analyzes moderate (1–2 cups) vs heavy caffeine impact, Pomodoro-to-cup fuel efficiency, and 100% caffeine-free clean energy tags.
  * **Enhanced UI:** Added category badge pills, color-coordinated icons, and carousel dot indicators in `SmartInsightPanel.tsx`.
  * **Unit Tests:** 10 comprehensive tests in `tests/insights.test.ts`.

---

## 🔮 Future Explorations (Long-term)

### 8. 🌐 External Ecosystem & App Integrations
* **Goal:** Connect Focus Timer with broader productivity ecosystems.
* **Concepts:**
  * Calendar integration (sync focus blocks with Google Calendar / Outlook).
  * Task manager integration (import tasks/tags from Todoist, Notion, or Linear).
  * Webhook / API triggers for automated status updates (e.g., Slack status "In Focus").
  * Apple Shortcuts / Android Intents support.
