# Pomodor — Focus Timer

> A production-ready, client-side Pomodoro web application designed according to Material Design 3 guidelines with a luminous bright cotton aesthetic, a drift-free timing engine, and rich tag analytics.

---

## 🌟 Key Features

### 1. Interval-Accurate Drift-Free Timer Engine
- **Web Worker Architecture**: Executes countdown ticks on an independent background Web Worker thread combined with `Date.now()` timestamp deltas to guarantee zero timer drift when browser tabs are backgrounded or minimized.
- **Dynamic Tag-Themed Donut Gauge**: The timer gauge, progress arc, and center status badge dynamically adapt to the color of the currently active focus tag.
- **Harmonic Audio Chimes**: Synthesized in real-time via the native browser **Web Audio API** (melodic C5–E5–G5 triad) without external audio asset network latency. Minimalist header icon toggle for quick mute/unmute.
- **Bracket-Free Browser Tab Title**: Displays clean countdown progress in the browser tab title (e.g., `23:30 Pomodor`).
- **Flexible Pomodoro Cycles**: User-configurable intervals via Settings with celebratory confetti bursts upon completion.

### 2. Carousel Status Indicator & Workspace
- **Egg Timer Brand Identity**: Clean, custom mechanical egg timer brand mark in the collapsible sidebar navigation rail and browser favicon.
- **Unified Single-Line Timeline**: Displays focus sessions and in-between short/long breaks on one clean, continuous horizontal timeline.
- **Overflow Carousel with Edge Indicators**: If a cycle has many sessions (configurable up to 12), the indicator automatically centers on the active step with subtle visual fade cues and mini chevrons on the sides.
- **Unspecified Tag Option**: Supports running timers without a specific tag, attributing untagged intervals to an explicit "Unspecified" tag in analytics.
- **Ergonomic Controls**: Reset (`R`), Start/Pause (`Space`), and Skip (`S`), with keyboard shortcuts cleanly hidden on mobile viewports.

### 3. Tag Management (Soft-Delete Architecture)
- Full tag data model (`id`, `name`, `color`, `isArchived`, `createdAt`).
- **Active Tags**: Selectable in the timer workspace and tracked in current aggregates.
- **Archived Tags**: Soft-deleted from selector dropdowns, but fully preserved in historical analytics.
- Curated pastel Material Design 3 color palette picker.

### 4. Advanced Multi-Period Statistics & Donut Analytics
- **Clean Production Data**: Starts clean with 0 mock sessions, with automatic purging of legacy development seed sessions from browser storage.
- Selectable time range windows:
  - **Day**: Single-day focus hours, 4-hour breakdown slots, and physically clamped peak focus hour analysis (never exceeding 60 minutes).
  - **Week**: 7-day breakdown (Monday through Sunday).
  - **Month**: Calendar month breakdown across multi-day blocks.
  - **Year**: 12-month annual progress (Jan–Dec).
  - **Custom Range**: Calendar date picker with presets (*Last 7 Days*, *Last 14 Days*, *This Month*, *Last 30 Days*, *Last 90 Days*, *Year to Date*).
  - **All Time**: Lifetime career metrics with **archived tags included**.
- **Interactive SVG Donut Diagram**: Visual breakdown of tag focus distribution placed prominently above the activity breakdown, with center-hole telemetry inspection.
- **Explicit "Today" Jump Button**: Clear, accessible button to return directly to today's date.

### 5. Settings & Profile
- Fully customizable durations (Work, Short Break, Long Break, Cycle Interval).
- Auto-start breaks and auto-start focus sessions.
- Audio volume slider and "Test Chime" preview.
- Browser desktop notification toggles.
- User Profile stub previewing upcoming multi-device cloud synchronization with a local JSON backup exporter.

---

## 🛠️ Architecture & Tech Stack

```
src/
├── types/                     # Domain contracts (timer, tag, session, settings)
├── services/
│   ├── storage/              # IStorageService & LocalStorageService
│   ├── repository/           # TagRepository, SessionRepository, SettingsRepository
│   ├── audio/                # Web Audio API chime synthesizer
│   └── notification/         # Web Notifications handler
├── context/                  # AppContext & dependency injection provider
├── hooks/                    # useTimer, useStatistics, useTags
├── components/
│   ├── layout/               # Sidebar (collapsible rail) & Header
│   ├── timer/                # TimerDisplay, TimerControls, TagSelector, CycleIndicator
│   ├── tags/                 # TagManager, TagFormModal
│   ├── stats/                # StatisticsView, DateRangeModal, TagDistributionDonut
│   ├── settings/             # SettingsView
│   ├── profile/              # ProfileView
│   └── ui/                   # Button, Card, Switch, Input, Modal, EggTimerIcon
└── utils/                    # Formatters, dates, confetti
```

- **Framework**: React 18 with TypeScript and Vite.
- **Styling**: Tailwind CSS with custom Material Design 3 bright cotton tokens (`#FFFEFC` canvas, `#6750A4` primary).
- **Icons**: Lucide React + custom SVG EggTimerIcon.
- **Storage Abstraction**: Repository/Service pattern decoupling UI and domain services from browser `localStorage`.
- **PWA & Web Standards**: Vector SVG favicon, `manifest.json`, `robots.txt`, and mobile status bar theming.

---

## 🚀 Getting Started

### Prerequisites
- Node.js `v18+` (tested on Node `v24`)
- npm `v9+`

### Installation
```bash
npm install
```

### Development
Start the local Vite development server:
```bash
npm run dev
```

### Production Build
Type-check and bundle for production:
```bash
npm run build
```

Preview the production build locally:
```bash
npm run preview
```

---

## 🌐 Cloudflare Deployment

### Option A: Cloudflare Workers (Workers Builds)
1. In Cloudflare Dashboard, connect your Git repository.
2. Build Settings:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
3. Wrangler serves `./dist` directly via the included `wrangler.json`.

### Option B: Cloudflare Pages
1. In Cloudflare Dashboard, select **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Build Settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`

---

## ⌨️ Keyboard Shortcuts (Desktop)

| Key | Action |
| --- | --- |
| `Space` | Toggle Start / Pause |
| `R` | Reset Current Interval |
| `S` | Skip to Next Interval |

---

## 📄 License
MIT
