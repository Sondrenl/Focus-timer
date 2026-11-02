# AI Development Declaration

- **Project**: Focus Timer (Pomodor)
- **Version**: 3.0.0
- **Project Lead**: Sondre Lassen
- **AI Collaborator**: Antigravity (Google DeepMind)
- **Methodology**: Prompt-Driven Software Engineering

---

## 1. Overview
This project was designed, implemented, and refined through **prompt-driven software engineering**. 

System architecture, frontend components, state management, reactive backend schemas and functions, and high-frequency synchronization engines were authored by the AI assistant under the iterative specification, UX direction, and domain requirements provided by Sondre Lassen.

---

## 2. Verification & Quality Assurance
- **Interactive Functional Validation**: Every feature iteration was tested and verified directly in real browser environments across desktop and mobile form factors.
- **Automated Type Checks & Builds**: All code commits must compile cleanly with `tsc -b` and produce valid production bundles through Vite without warnings or type bypasses.
- **Reactive Cloud Integration Testing**: Real-time schemas, queries, and mutations were validated against live backend deployments with end-to-end multi-device synchronization.

---

## 3. Architecture & Generated Systems
Key architectural layers engineered via prompt-driven workflows:
1. **Frontend Architecture**: React 18 single-page application with modular Material 3 design tokens, strict TypeScript types, and repository patterns.
2. **Timing Engine**: Background Web Worker paired with high-precision timestamp calculations to guarantee drift-free operation across tab switches, screen locks, and background throttling.
3. **Multi-Device Presence & Arbitration**: Wall-clock gap detection combined with reactive presence heartbeats to pause asleep devices while allowing active secondary devices to maintain uninterrupted continuity. Smart audio arbitration ensures notifications chime only on the device actively in use.
4. **Cloud Synchronization**: Real-time reactive subscriptions backed by a serverless database with Google OAuth 2.0 OIDC Identity Services.
5. **Multi-Tab & Device Sync**: Combined `BroadcastChannel` for zero-latency local tab communication and sub-50ms WebSocket subscriptions for distributed multi-device synchronization.
6. **Display & Audio APIs**: Screen Wake Lock API for mobile keep-awake and synthesized Web Audio API oscillators for crisp chime alerts without external audio file downloads.
7. **Capacity Optimization & Change Detection**: Change-detection mutation guards, atomic batch deduplication, and throttled presence updates ensure zero wasted database writes and optimal free-tier performance.
