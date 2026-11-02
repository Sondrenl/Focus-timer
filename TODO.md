# Project Roadmap & Backlog (TODO)

This document tracks upcoming features, UX refinements, and architectural enhancements for Focus Timer. It serves as the primary task list across development sessions.

---

## 📋 Active Backlog

### 1. 📊 Meaningful Insights Refactoring
* **Goal:** Make the Insights tab provide genuinely actionable, insightful analytics rather than generic observations.
* **Details:**
  * Review current heuristic generators in `src/utils/insights.ts`.
  * Highlight peak focus hours, correlation between coffee consumption and deep work intervals, day-of-week productivity patterns, and milestone achievements.
  * Deliver clear, high-value summaries (e.g., "Your peak focus window is 09:00–11:30" or "Focus drops after 3 consecutive sessions without a long break").

### 2. 📱 Mobile UX in Statistics Tab
* **Goal:** Optimize touch targets and layout density for mobile devices.
* **Details:**
  * Address dense clusters of small buttons, arrows, and cramped infographics on smaller touch screens.
  * Increase minimum tap target sizes to at least 44×44px (Apple HIG & Material standard).
  * Improve scrolling/swipe navigation for time period pagination (Day, Week, Month, Year).

### 3. 🔔 Mobile Notification Asset & Icon Framing
* **Goal:** Fix the notification icon framing on mobile devices.
* **Details:**
  * Current issue: The icon appears as a square with the logo tiny in the top-left corner on Android/iOS notifications.
  * Solution: Create properly padded, centered, and transparent maskable/monochrome icons (`icon-192.png`, `badge-72.png`, Android notification vector) following Android and PWA notification specifications.

### 4. 👤 Profile Page & Focus Targets
* **Goal:** Review and enhance user profile personalization and goal setting.
* **Details:**
  * Daily/weekly focus time targets (progress bars towards daily hours goal).
  * Profile editing capabilities (display name, avatar customization).
  * Account management and data export options.

### 5. 🎨 Component Active / Pressed State Colors
* **Goal:** Replace harsh/darker select and active state highlights across components.
* **Details:**
  * Currently, pressing or selecting buttons/cards applies a dark shade that looks unpolished.
  * Refine CSS transitions, active scale effects, subtle opacity/glow states, or softer tint overlays matching the warm minimalist aesthetic.

### 6. 📱 Desktop vs. Mobile Visual & Font Consistency
* **Goal:** Audit and eliminate unintentional discrepancies between mobile and desktop views.
* **Details:**
  * **Timer Font:** Investigate why mobile renders a different font for the timer digits than desktop (e.g., system font fallback vs. loaded font like JetBrains Mono or tabular numerals).
  * Ensure consistent letter-spacing, tabular numbers (`font-variant-numeric: tabular-nums` / `font-mono`) to prevent digit jitter.
  * Check for unintended layout divergences in buttons, paddings, and header states.

### 7. ⏱️ Timer Settings & Duration Editing UX
* **Goal:** Make configuring work, short break, and long break intervals intuitive and frictionless.
* **Details:**
  * Current input boxes or sliders can feel clunky on mobile and desktop.
  * Explore quick presets (e.g., 25/5, 50/10, 90/20), steppers (+/- 1 or 5 mins), or streamlined scrubbers with instant preview.

### 8. 🎨 Logo Design Revision
* **Goal:** Modernize and polish the application logo and branding.
* **Details:**
  * Revisit the coffee / pomodoro / focus visual identity.
  * Produce vector assets (SVG), high-DPI favicons, and PWA splash screen assets.

---

## 🔮 Future Explorations (Long-term)

### 9. 🌐 External Ecosystem & App Integrations
* **Goal:** Connect Focus Timer with broader productivity ecosystems.
* **Concepts:**
  * Calendar integration (sync focus blocks with Google Calendar / Outlook).
  * Task manager integration (import tasks/tags from Todoist, Notion, or Linear).
  * Webhook / API triggers for automated status updates (e.g., Slack status "In Focus").
  * Apple Shortcuts / Android Intents support.
