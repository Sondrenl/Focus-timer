# AI Development Declaration

- **Project**: Focus Timer (Pomodor)
- **Version**: 3.0.2
- **Project Lead**: Sondre Lassen
- **AI Collaborator**: Antigravity (Google DeepMind)
- **Methodology**: Prompt-Driven Software Engineering

---

## 1. Overview

This project was architected, implemented, and refined through **prompt-driven software engineering**. 

System architecture, frontend interfaces, state management, reactive backend schemas, arbitration algorithms, and security controls were authored by the AI assistant under the iterative specification, UX direction, and domain requirements established by Sondre Lassen.

---

## 2. Verification & Quality Assurance

- **Interactive Validation**: Every UX flow and component iteration was validated across mobile and desktop environments.
- **Automated Test Suite**: Automated end-to-end unit and integration tests executed via Vitest and Convex Test covering timer state transitions, arbitration, synchronization, and security invariants.
- **Strict Compilation & Bundling**: All commits compile cleanly under TypeScript (`tsc -b`) and bundle production assets via Vite with zero warnings or bypassed types.
- **Backend Schema Verification**: Real-time schemas, compound indexes, and background mutations are validated against reactive cloud environments.

---

## 3. Architecture & Engineered Systems

Core architectural layers developed through prompt-driven workflows:

1. **Frontend Architecture**: React 18 single-page application with modular Material 3 design tokens, strict TypeScript typing, and decoupled repository patterns.
2. **Timing Engine**: Dedicated background Web Worker combined with wall-clock timestamp calculations to ensure drift-free countdowns across device sleep, tab switching, and background throttling.
3. **Multi-Device Presence & Arbitration**: Intelligent presence heartbeat and activity arbitration ensuring chime alerts and notifications route strictly to the device actively in use.
4. **Reactive Cloud Synchronization**: Real-time WebSocket synchronization backed by Convex serverless functions and Google OAuth 2.0 / OIDC authentication.
5. **Multi-Tab & Device Coordination**: Native `BroadcastChannel` communication for instant local tab coordination alongside sub-50ms cloud sync for multi-device continuity.
6. **Security & Data Privacy**: Robust input sanitization, bounded database mutations, CSRF/SSRF protections, strict Content Security Policy, and sanitized export/import routines.
7. **Resilience & Background Maintenance**: Self-healing dynamic chunk loading for seamless PWA updates and scheduled Convex crons for automated state maintenance.
