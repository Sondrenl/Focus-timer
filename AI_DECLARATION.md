# AI Development Declaration

- **Project**: Focus Timer (Pomodor)
- **Version**: 2.1.1
- **Project Lead**: Sondre Lassen
- **AI Collaborator**: Antigravity (Google DeepMind)
- **Methodology**: Prompt-Driven Software Engineering

---

## 1. Overview
This project was developed through **prompt-driven software engineering**. 

System architecture, frontend components, state management, Cloudflare Worker endpoints, database migrations, and performance optimizations were authored by the AI assistant under the iterative specification, UX direction, and domain requirements provided by Sondre Lassen.

---

## 2. Verification & Quality Assurance
- **Interactive Functional Validation**: Every feature iteration was tested and verified directly in real browser environments across desktop and mobile form factors.
- **Automated Type Checks & Builds**: All code commits must compile cleanly with `tsc -b` and produce valid production bundles through Vite without warnings or type bypasses.
- **Serverless Integration Testing**: Cloudflare Worker routes and D1 SQL schema migrations were validated against live remote staging environments (`focus-timer-db`).

---

## 3. Architecture & Generated Systems
Key architectural layers engineered via prompt-driven workflows:
1. **Frontend Architecture**: React 18 single-page application with modular Material 3 design tokens, strict TypeScript types, and repository patterns.
2. **Timing Engine**: Background Web Worker paired with high-precision timestamp calculations to guarantee drift-free operation across tab switches and throttling.
3. **Sleep & Lid-Closed Detection**: Wall-clock gap detection combined with Cloudflare Worker heartbeat liveness to pause asleep devices while allowing active secondary devices to maintain continuity.
4. **Cloud Synchronization**: Cloudflare Worker REST API backed by Cloudflare D1 (serverless SQLite) with JWT authentication and Google OAuth 2.0 Identity Services.
5. **Multi-Tab & Device Sync**: Combined `BroadcastChannel` for zero-latency local tab communication and sub-2-second HTTP polling for distributed cloud synchronization.
6. **Display & Audio APIs**: Screen Wake Lock API for mobile keep-awake and synthesized Web Audio API oscillators for chime alerts without external asset dependencies.
