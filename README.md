# Focus Timer (Pomodor)

A fast, modern Pomodoro and caffeine tracker web app built with React 18, TypeScript, Tailwind CSS, and a real-time reactive Convex backend. Designed for frictionless flow state, zero-latency multi-device synchronization, and deep productivity insights.

[![Version](https://img.shields.io/badge/version-2.3.1-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## Highlights

- **Reactive Multi-Device Sync (<50ms)**: Powered by Convex WebSockets. Timers, coffee logs, custom tags, and user settings synchronize seamlessly across your phone, tablet, and laptop in real-time without polling.
- **Drift-Free Background Timer**: Server-authoritative `targetEndTime` with a client background Web Worker and high-precision timestamps. Never drifts when switching tabs or minimizing.
- **Sleep & Lid-Closed Detection**: Heartbeat presence detection pauses gracefully when your laptop lid is closed or system sleeps, while keeping active peer devices running uninterrupted.
- **Zero-Latency Multi-Tab Sync**: Instant synchronization across tabs on the same computer using the `BroadcastChannel` API.
- **Coffee & Caffeine Tracker**: Log coffee cups with associated project tags. Reactive cloud sync with instant updates and comprehensive coffee analytics.
- **Keep Screen Awake (Mobile & Desktop)**: Uses the Screen Wake Lock API to prevent displays from going to sleep during active work sessions.
- **Productivity & Coffee Analytics**: Timeframe breakdowns (Day, Week, Month, Year, All-Time), peak productivity hours, daily coffee averages, and tag distribution donuts.
- **Local-First & Privacy Conscious**: Runs seamlessly offline with `localStorage`. Cloud sync is activated automatically when signed in or when `VITE_CONVEX_URL` is configured. Full JSON export/import backups are available at any time.
- **Customizable Intervals & Audio Alerts**: Adjustable work/break lengths, auto-start options, synthesized Web Audio chimes (no audio asset downloads needed), and desktop notifications.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Canvas Confetti
- **Backend**: [Convex](https://www.convex.dev/) (Reactive real-time database, server functions, scheduled actions, compound indexes)
- **Authentication**: Google OAuth 2.0 Identity Services / OIDC JWT
- **APIs**: Screen Wake Lock API, Web Audio API, BroadcastChannel, Notifications API, Web Workers

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

### Backend Setup (Convex)
1. Initialize or connect your Convex project:
```bash
npx convex dev
```
This will log you in, configure your dev deployment, and create `.env.local` containing `VITE_CONVEX_URL`.

2. Add your Google OAuth Web Client ID to `.env.local`:
```env
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### Running Locally
To run both the Vite frontend and the Convex backend development server concurrently:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

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

## Project Structure

```
├── public/                 # Static assets & SVG favicon
├── convex/                 # Convex reactive backend
│   ├── schema.ts           # Convex schema definitions & indexes
│   ├── users.ts            # User profile, preferences & embedded tags
│   ├── timer.ts            # Real-time timer state & presence heartbeat
│   ├── sessions.ts         # Pomodoro session history
│   ├── coffee.ts           # Coffee intake tracking
│   ├── tags.ts             # Tag CRUD mutations on user document
│   ├── push.ts             # Web Push subscription management
│   ├── migrations.ts       # Backup JSON import mutations
│   └── auth.config.ts      # Google OIDC authentication provider
└── src/
    ├── components/         # UI views (Timer, Coffee, Stats, Tags, Settings, Profile)
    ├── context/            # React state providers (AppContext, TimerContext)
    ├── hooks/              # Reactive hooks (useConvexSync, useConvexTimer, useTimer)
    ├── services/           # Convex client, Auth, Repositories, WakeLock, Sound, Notifications
    ├── types/              # TypeScript models (Timer, Session, Tag, Settings, Coffee, User)
    └── utils/              # Math, date formatting, and confetti helpers
```

---

## License

[MIT](LICENSE)
