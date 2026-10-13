# Pomodor — Focus Timer

> A production-ready, client-side Pomodoro web application designed according to Material Design 3 guidelines with a luminous cotton cream aesthetic and a drift-free timing engine.

---

## 🌟 Key Features

### 1. Interval-Accurate Timer Engine
- **Zero-Drift Web Worker Architecture**: Executes countdown ticks on an independent Web Worker thread combined with `Date.now()` timestamp deltas to prevent timer throttling when browser tabs are backgrounded or minimized.
- **Harmonic Audio Chimes**: Synthesized in real-time via the **Web Audio API** (melodic C5–E5–G5 major triad) with zero external audio asset dependencies.
- **Dynamic Browser Tab Indicator**: Displays clean countdown progress in the browser tab title (e.g., `23:30 Pomodor`).
- **Flexible Pomodoro Cycles**: Default 4 × 25-minute work intervals separated by 5-minute short breaks, concluding with a 25-minute long break.
- **Celebratory Feedback**: Confetti burst upon completing focus sessions.

### 2. Minimalist Unboxed Workspace
- Floating circular timer gauge with progress arc and session indicator.
- Minimalist session progress dots (`CycleIndicator`).
- Tag dropdown chip to categorize focus intervals on the fly.
- Ergonomic controls: Reset (`R`), Start/Pause (`Space`), and Skip (`S`).

### 3. Tag Management (Soft-Delete Architecture)
- Full categorization model (`id`, `name`, `color`, `isArchived`, `createdAt`).
- **Active Tags**: Directly selectable in the timer workspace and tracked in active aggregates.
- **Archived Tags**: Soft-deleted from selector dropdowns, but fully preserved in historical analytics.
- Curated pastel Material Design 3 color palette picker.

### 4. Advanced Multi-Period Statistics & Analytics
- Selectable time range windows:
  - **Day**: Detailed hourly distribution and peak focus window.
  - **Week**: 7-day breakdown (Monday through Sunday).
  - **Month**: Calendar month breakdown across multi-day blocks.
  - **Year**: 12-month annual progress (Jan–Dec).
  - **Custom Range**: Calendar date picker with presets (*Last 7 Days*, *Last 14 Days*, *This Month*, *Last 30 Days*, *Last 90 Days*, *Year to Date*).
  - **All Time**: Lifetime career metrics with **archived tags included**.
- Navigation controls: Step backward (`<`) and forward (`>`) through any time period.
- Aggregated focus hours, completed Pomodoros, peak productivity day, and per-category distributions.

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
│   ├── stats/                # StatisticsView, DateRangeModal
│   ├── settings/             # SettingsView
│   ├── profile/              # ProfileView
│   └── ui/                   # Button, Card, Switch, Input, Modal
└── utils/                    # Formatters, dates, confetti
```

- **Framework**: React 18 with TypeScript and Vite.
- **Styling**: Tailwind CSS with custom Material Design 3 pastel cotton tokens (`#FDFBF7` canvas, `#6750A4` primary).
- **Icons**: Lucide React.
- **Storage Abstraction**: Repository/Service pattern decoupling UI and domain services from browser `localStorage`, facilitating future migrations to IndexedDB, PostgreSQL, or REST/GraphQL backends.

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

## ⌨️ Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Toggle Start / Pause |
| `R` | Reset Current Interval |
| `S` | Skip to Next Interval |

---

## 📄 License
MIT
