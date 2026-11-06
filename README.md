# Focus Timer (Pomodor)

A fast, modern Pomodoro timer and caffeine tracker web app built with React 18, TypeScript, Tailwind CSS, and a real-time reactive backend. Engineered for frictionless flow state, zero-latency multi-device synchronization, and deep productivity insights.

[![Version](https://img.shields.io/badge/version-3.0.2-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Build & Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](tests/)

---

## Features

- **Real-Time Multi-Device Sync**: Powered by reactive Convex WebSocket subscriptions. Active timers, coffee logs, custom tags, and user preferences synchronize across mobile, tablet, and desktop without manual polling.
- **Smart Device Arbitration**: Dynamically detects whether you are active on mobile or desktop to route alarms and notifications to the active device without duplicate chimes.
- **Drift-Free Background Timing**: Web Worker engine combined with server timestamp anchoring ensures sub-millisecond precision even when tabs are backgrounded, mobile screens lock, or system sleep occurs.
- **Tag-Scoped Caffeine Tracking**: Interactive coffee logging with customizable cups, milligrams tracking, tag scoping, and daily intake analytics.
- **Productivity Analytics & Insights**: Multi-timeframe performance breakdowns (Day, Week, Month, Year, All-Time), interactive activity calendar, tag distribution, and correlation insights.
- **Local-First with Cloud Continuity**: Full offline operation using local storage, with instant cloud synchronization upon signing in with Google OAuth.
- **PWA & Display Controls**: Installable Progressive Web App with Screen Wake Lock support to keep displays awake during focus intervals, and self-healing dynamic chunk loading.
- **Synthesized Web Audio**: Crisp harmonic alert chimes synthesized in-browser via the Web Audio API without external audio asset downloads.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Canvas Confetti
- **Backend & Database**: [Convex](https://www.convex.dev/) (Reactive document database, compound indexes, scheduled background crons)
- **Authentication**: Google OAuth 2.0 / OIDC Identity Services
- **Browser APIs**: Web Audio API, Screen Wake Lock API, Web Workers, BroadcastChannel, Notifications API, Service Worker
- **Testing**: Vitest, Convex Test

---

## Getting Started

### Prerequisites

- **Node.js** (v18 or newer)
- **npm** (v9 or newer)

### Installation

```bash
# Clone repository
git clone https://github.com/sondrelassen/Focus-timer.git
cd Focus-timer

# Install dependencies
npm install
```

### Environment Configuration

Create a `.env.local` file in the project root:

```env
# Convex backend deployment URL (generated via convex dev)
VITE_CONVEX_URL=https://your-deployment-name.convex.cloud

# Google OAuth Web Client ID
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### Development

Run both the Vite frontend and the Convex backend concurrently:

```bash
npm run dev
```

Alternatively, run each process individually:
- `npm run dev:frontend` – Starts the Vite dev server (`http://localhost:5173`)
- `npm run dev:convex` – Starts the Convex backend sync process

### Testing

Run the full automated test suite:

```bash
npm test
```

### Production Build

Typecheck and generate optimized production bundles:

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

*(Shortcuts are automatically disabled on mobile and touch devices)*

---

## Project Structure

```
├── public/                 # Static assets, Web App Manifest, Service Worker, headers
├── convex/                 # Reactive real-time backend
│   ├── crons.ts            # Scheduled background maintenance tasks
│   ├── schema.ts           # Database schema & compound indexes
│   ├── timer.ts            # Active timer state, server scheduling & cleanup
│   ├── sessions.ts         # Pomodoro session history & deduplication
│   ├── coffee.ts           # Caffeine tracking with tag scoping
│   ├── tags.ts             # Tag operations and color palettes
│   ├── users.ts            # User profiles & settings persistence
│   ├── push.ts             # Web Push notifications & allowlist validation
│   ├── migrations.ts       # Atomic backup import/export
│   └── auth.config.ts      # Google OIDC authentication provider config
├── src/
│   ├── components/         # UI components (Timer, Coffee, Stats, Tags, Settings, Profile)
│   ├── context/            # Global state providers (Auth, Timer, Data)
│   ├── hooks/              # Custom reactive hooks & synchronization logic
│   ├── services/           # Repositories, audio, notifications, arbitration
│   ├── types/              # TypeScript definitions & data models
│   └── utils/              # Formatting, color sanitization, resilience utilities
└── tests/                  # Automated Vitest test suite
```

---

## License

This project is licensed under the [MIT License](LICENSE).
