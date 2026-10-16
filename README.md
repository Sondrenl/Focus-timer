# Focus Timer (Pomodor)

A fast, modern Pomodoro and caffeine tracker web app built with React 18, TypeScript, Tailwind CSS, and Cloudflare Workers + D1. Designed for frictionless flow state, multi-device synchronization, and deep productivity insights.

[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## Highlights

- **Drift-Free Background Timer**: Powered by a background Web Worker and high-precision timestamps. Never freezes or drifts when switching tabs or minimizing.
- **Sleep & Lid-Closed Detection**: Automatically pauses when your laptop lid is closed or system sleeps. If running across multiple devices (e.g. phone + laptop), active devices keep the session going uninterrupted.
- **Real-Time Cross-Device Sync**: Optional Google Sign-In with Cloudflare D1 database backend. Sessions, active timer state, coffee logs, and custom tags stay synchronized across all devices in real-time.
- **Zero-Latency Multi-Tab Sync**: Instant synchronization across tabs on the same computer using the `BroadcastChannel` API.
- **Coffee & Caffeine Tracker**: Log coffee cups with associated project tags. Real-time cloud sync with instant updates and comprehensive coffee analytics.
- **Keep Screen Awake (Mobile & Desktop)**: Uses the Screen Wake Lock API to prevent displays from going to sleep during active work sessions.
- **Productivity & Coffee Analytics**: Timeframe breakdowns (Day, Week, Month, Year, All-Time), peak productivity hours, daily coffee averages, and tag distribution donuts.
- **Local-First & Privacy Conscious**: Works 100% offline with `localStorage`. Cloud sync is opt-in, and full JSON export/import backups are available at any time.
- **Customizable Intervals & Audio Alerts**: Adjustable work/break lengths, auto-start options, synthesized Web Audio chimes (no audio asset downloads needed), and desktop notifications.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Canvas Confetti
- **Backend**: Cloudflare Workers, Cloudflare D1 (Serverless SQLite), Google OAuth 2.0 Identity Services, Web Crypto JWT
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

### Running Locally
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Cloudflare Worker (Full-Stack Mode)
```bash
# Run local worker + frontend
npx wrangler dev
```

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
├── migrations/             # Cloudflare D1 database migrations
├── worker/                 # Cloudflare Worker API & auth router
└── src/
    ├── components/         # Material 3 UI views (Timer, Coffee, Stats, Tags, Settings, Profile)
    ├── context/            # React state providers (AppContext, TimerContext)
    ├── services/           # Services (Auth, Storage, Repositories, WakeLock, Sound, Notifications)
    ├── types/              # TypeScript models (Timer, Session, Tag, Settings, Coffee, User)
    └── utils/              # Math, date formatting, and confetti helpers
```

---

## License

[MIT](LICENSE)
