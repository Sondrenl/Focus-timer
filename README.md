# Focus Timer (Pomodor)

A fast, modern Pomodoro and caffeine tracker web app built with React 18, TypeScript, Tailwind CSS, and a real-time reactive backend. Designed for frictionless flow state, zero-latency multi-device synchronization, and deep productivity insights.

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## Highlights

- **Reactive Multi-Device Synchronization (<50ms)**: Powered by real-time WebSocket subscriptions. Timers, coffee logs, custom tags, and user settings synchronize seamlessly across your phone, tablet, and laptop without manual refreshing or polling.
- **Smart Device Arbitration & Alert Routing**: Intelligently detects whether you are active on mobile or desktop. Completion chimes and notifications route to the device you are actively using, avoiding annoying duplicate alarms.
- **Drift-Free Background Timer**: Server-anchored timestamps combined with a dedicated background Web Worker maintain millisecond accuracy even when tabs are minimized, mobile screens lock, or the browser throttles timers.
- **Sleep & Lid-Closed Detection**: Gracefully detects when your laptop lid closes or system sleeps, pausing local ticks while allowing connected peer devices to continue running smoothly.
- **Instant Multi-Tab Communication**: Instant synchronization across tabs on the same computer using the browser's native `BroadcastChannel` API.
- **Tag-Scoped Coffee & Caffeine Logging**: Visual, interactive coffee tray where clicking any cup selects its associated tag. Strict tag scoping, instant cloud logging, and detailed daily caffeine statistics.
- **Keep Screen Awake (Mobile & Desktop)**: Leverages the Screen Wake Lock API to prevent device displays from dimming or sleeping during active focus intervals.
- **Deep Productivity Analytics**: Comprehensive timeframe breakdowns (Day, Week, Month, Year, All-Time), interactive calendar inspector, peak productivity hours, daily coffee averages, and tag distribution donuts.
- **Local-First with Seamless Cloud Continuity**: Operates 100% offline via local storage. Signing in with Google automatically connects cloud synchronization with automatic account linking and zero data loss.
- **Synthesized Web Audio Alerts**: Clean, synthesized harmonic chime alerts powered by the Web Audio API without requiring external audio asset downloads.
- **Customizable Intervals**: Configurable focus, short break, and long break durations, long break intervals, auto-start options, sound volumes, and daily focus goals.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Canvas Confetti
- **Backend Database & Functions**: [Convex](https://www.convex.dev/) (Reactive real-time database, compound indexes, server-side scheduled actions)
- **Authentication**: Google OAuth 2.0 Identity Services / OIDC JWT
- **Browser APIs**: Screen Wake Lock API, Web Audio API, BroadcastChannel, Notifications API, Web Workers

---

## Getting Started

### Prerequisites
- Node.js (v18 or newer)
- npm

### Installation
```bash
# Clone the repository
git clone https://github.com/sondrelassen/Focus-timer.git

# Enter project directory
cd Focus-timer

# Install dependencies
npm install
```

### Backend Setup
1. Initialize or connect your Convex project:
```bash
npx convex dev
```
This configures your backend environment and writes the deployment URL to `.env.local`.

2. Add your Google OAuth Web Client ID to `.env.local`:
```env
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### Running Locally
To run both the Vite frontend and the Convex backend development server concurrently:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

You can also run them individually:
- `npm run dev:frontend` – Starts the Vite dev server only
- `npm run dev:convex` – Starts the Convex backend sync process only

### Building for Production
```bash
npm run build
```

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Space` | Start / Pause timer |
| `S` | Skip to next interval |
| `R` | Reset current interval |

*(Automatically hidden on mobile viewports)*

---

## Architecture & Project Structure

```
├── public/                 # Static assets, Web App Manifest, and Service Worker
├── convex/                 # Reactive real-time backend
│   ├── schema.ts           # Database schema definitions & compound indexes
│   ├── users.ts            # User profile, preferences & embedded tags
│   ├── timer.ts            # Active timer state, server scheduler, and presence heartbeat
│   ├── sessions.ts         # Pomodoro session history with time-window deduplication
│   ├── coffee.ts           # Timestamped coffee intake tracking with strict tag scoping
│   ├── tags.ts             # Tag operations and preference persistence
│   ├── push.ts             # Multi-device push notification registrations
│   ├── migrations.ts       # Atomic backup import/export and data ingestion routines
│   └── auth.config.ts      # Google OIDC authentication provider config
└── src/
    ├── components/         # UI modules (Timer, Coffee, Stats, Tags, Settings, Profile)
    ├── context/            # React state providers (AppContext, TimerContext)
    ├── hooks/              # Reactive hooks (useConvexSync, useConvexTimer, useTimer)
    ├── services/           # Repositories, AuthService, WakeLockService, SoundService, NotificationService
    ├── types/              # TypeScript definitions (Timer, Session, Tag, Settings, Coffee, User)
    └── utils/              # Math, environment detection, formatting, and visual effects
```

---

## License

[MIT](LICENSE)
