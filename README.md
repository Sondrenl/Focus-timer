# Pomodor — Focus Timer

A clean, modern Pomodoro timer web app built through **prompt-driven AI development**—designed and iterated using conversational prompts to help you stay focused, manage work and break sessions, and track your daily productivity.

> 💡 **Note**: This project's codebase was generated entirely by AI based on user prompts and validated through interactive browser testing. See [AI_DECLARATION.md](AI_DECLARATION.md) for details.

---

## ✨ Features

- **Reliable Timer**: Keeps running accurately in the background without freezing or drifting, even when you switch tabs or minimize the browser.
- **Customizable Intervals**: Set your own durations for focus sessions, short breaks, and long breaks, along with how many rounds make up a full cycle.
- **Cycle Progress Tracker**: A simple visual timeline shows where you are in your current session and when your next break is coming.
- **Color-Coded Tags**: Organize work sessions with custom tags (e.g., Coding, Writing, Study) and colors. The timer ring dynamically matches the active tag.
- **Built-in Sound Alerts**: Plays a gentle, pleasant chime when a timer ends (synthesized directly in the browser—no external sound files to download).
- **Tab Title Countdown**: Glance at your remaining time right in the browser tab title.
- **Productivity Statistics**:
  - Review your focus time across days, weeks, months, years, or custom date ranges.
  - See which tags you spend the most time on with an interactive donut chart.
- **Private & Local-First**: All your data is saved directly in your browser. No accounts, no trackers, and an easy JSON export button for backups.
- **Keyboard Shortcuts**: Quick controls from your keyboard (`Space` to start/pause, `S` to skip, `R` to reset).
- **Mobile Friendly & Installable (PWA)**: Fully responsive design that can be installed to your home screen or desktop.

---

## 🛠️ Tech Stack

- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Hosting**: Ready for Cloudflare Pages / Workers or any static web host

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- npm

### Installation
```bash
# Clone the repository
git clone <repository-url>

# Navigate into the project folder
cd focus-timer

# Install dependencies
npm install
```

### Running Locally
Start the development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Building for Production
Create an optimized production build:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | --- |
| `Space` | Start / Pause timer |
| `S` | Skip current interval |
| `R` | Reset current interval |

*(Shortcuts are automatically hidden on mobile devices)*

---

## 📁 Project Structure

```
src/
├── components/     # UI views (Timer, Statistics, Tags, Settings, Profile)
├── context/        # App and Timer state management
├── hooks/          # Custom React hooks (timer logic, stats, tag handling)
├── services/       # Local storage, audio chimes, and browser notifications
├── types/          # TypeScript types and data models
└── utils/          # Date formatting, confetti, and helpers
```

---

## 📄 License

MIT
