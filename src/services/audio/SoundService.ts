/**
 * SoundService plays a simple completion chime using the native Web Audio API.
 * Resilient to Safari 'interrupted' state, OS sleep/wake, Bluetooth output switches,
 * hung resume() promises, zombie 'running' contexts with frozen currentTime, and audio errors.
 */
const STALE_RESUME_THRESHOLD_MS = 1500;
const RESUME_TIMEOUT_MS = 1200;
const ZOMBIE_CLOCK_PROBE_MS = 120;
const SCHEDULE_LOOKAHEAD_SEC = 0.015;

export class SoundService {
  private audioCtx: AudioContext | null = null;
  private activeNodes: Set<{ osc: OscillatorNode; gain: GainNode }> = new Set();
  private playGeneration = 0;
  private needsHealthCheck = false;
  private lastObservedCurrentTime: number | null = null;
  private resumeInFlight: Promise<boolean> | null = null;

  private attachStateListener(ctx: AudioContext): void {
    try {
      if (typeof ctx.addEventListener === 'function') {
        ctx.addEventListener('statechange', () => {
          const state = ctx.state as string;
          if (state === 'interrupted' || state === 'suspended' || state === 'closed') {
            this.needsHealthCheck = true;
          }
        });
      }
    } catch {
      // Ignore environments with minimal mock AudioContext
    }
  }

  private createFreshContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      const fresh = new AudioContextClass();
      this.audioCtx = fresh;
      this.needsHealthCheck = false;
      this.lastObservedCurrentTime = null;
      this.resumeInFlight = null;
      this.attachStateListener(fresh);
      return fresh;
    } catch {
      this.audioCtx = null;
      return null;
    }
  }

  private recycleContext(): AudioContext | null {
    const old = this.audioCtx;
    this.stopActiveChime();
    this.audioCtx = null;
    this.resumeInFlight = null;
    this.needsHealthCheck = false;
    this.lastObservedCurrentTime = null;

    if (old && old.state !== 'closed') {
      try {
        const closeResult = old.close?.();
        if (closeResult && typeof closeResult.catch === 'function') {
          closeResult.catch(() => {});
        }
      } catch {
        // Ignore close errors
      }
    }

    return this.createFreshContext();
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (this.audioCtx && this.audioCtx.state === 'closed') {
      this.activeNodes.clear();
      this.audioCtx = null;
      this.resumeInFlight = null;
      this.needsHealthCheck = false;
      this.lastObservedCurrentTime = null;
    }

    if (!this.audioCtx) {
      return this.createFreshContext();
    }

    return this.audioCtx;
  }

  private isContextPaused(ctx: AudioContext): boolean {
    const state = ctx.state as string;
    return state === 'suspended' || state === 'interrupted';
  }

  private safeResume(ctx: AudioContext, timeoutMs: number = RESUME_TIMEOUT_MS): Promise<boolean> {
    if (ctx.state === 'running') return Promise.resolve(true);
    if (ctx.state === 'closed') return Promise.resolve(false);
    if (this.resumeInFlight) return this.resumeInFlight;

    let rawResume: Promise<void>;
    try {
      rawResume = ctx.resume();
    } catch {
      return Promise.resolve(false);
    }

    let timerId: ReturnType<typeof setTimeout> | null = null;
    const resumeAttempt = Promise.resolve(rawResume)
      .then(() => ctx.state === 'running')
      .catch(() => false);

    const timeout = new Promise<boolean>((resolve) => {
      timerId = setTimeout(() => resolve(false), timeoutMs);
    });

    const raced = Promise.race([resumeAttempt, timeout]).then((resumed) => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (this.resumeInFlight === raced) {
        this.resumeInFlight = null;
      }
      return resumed;
    });

    this.resumeInFlight = raced;
    return raced;
  }

  /**
   * Flags the current AudioContext for a clock-advancement health check after OS sleep/wake,
   * tab return, or audio output route switches.
   */
  markStaleForRecovery(): void {
    if (this.audioCtx) {
      this.needsHealthCheck = true;
      this.lastObservedCurrentTime =
        typeof this.audioCtx.currentTime === 'number' ? this.audioCtx.currentTime : null;
    }
  }

  private stopActiveChime(): void {
    for (const entry of this.activeNodes) {
      try {
        entry.osc.onended = null;
        entry.osc.stop();
      } catch {
        // Ignore if oscillator has already stopped
      }
      try {
        entry.osc.disconnect?.();
      } catch {
        // Ignore disconnect errors
      }
      try {
        entry.gain.disconnect?.();
      } catch {
        // Ignore disconnect errors
      }
    }
    this.activeNodes.clear();
  }

  private scheduleTriad(ctx: AudioContext, clampedVol: number): void {
    try {
      this.stopActiveChime();

      const notes = [523.25, 659.25, 783.99];
      const baseTime =
        (typeof ctx.currentTime === 'number' && Number.isFinite(ctx.currentTime)
          ? ctx.currentTime
          : 0) + SCHEDULE_LOOKAHEAD_SEC;
      // Floor peak gain strictly > 0 so exponentialRampToValueAtTime never throws RangeError
      const peakGain = Math.max(0.001, 0.4 * clampedVol);

      notes.forEach((freq, idx) => {
        const noteStartTime = baseTime + idx * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStartTime);

        gain.gain.setValueAtTime(0.0001, noteStartTime);
        gain.gain.exponentialRampToValueAtTime(peakGain, noteStartTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStartTime + 1.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        const entry = { osc, gain };
        this.activeNodes.add(entry);
        osc.onended = () => {
          this.activeNodes.delete(entry);
          try {
            osc.disconnect?.();
          } catch {
            // Ignore disconnect errors
          }
          try {
            gain.disconnect?.();
          } catch {
            // Ignore disconnect errors
          }
        };

        osc.start(noteStartTime);
        osc.stop(noteStartTime + 1.3);
      });

      this.lastObservedCurrentTime = ctx.currentTime;
      this.needsHealthCheck = false;
    } catch {
      // Never let Web Audio failures crash timer transitions
    }
  }

  /**
   * Initializes or resumes the native AudioContext during a user gesture
   * (such as starting a timer, toggling mute, or clicking Test Chime).
   * If a previously wedged context fails to resume in time, recycles it cleanly.
   */
  prepareForPlayback(): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (this.isContextPaused(ctx)) {
      void this.safeResume(ctx, RESUME_TIMEOUT_MS).then((resumed) => {
        if (!resumed && this.audioCtx === ctx && this.isContextPaused(ctx)) {
          const fresh = this.recycleContext();
          if (fresh && this.isContextPaused(fresh)) {
            void this.safeResume(fresh, RESUME_TIMEOUT_MS);
          }
        }
      });
    } else if (ctx.state === 'running' && this.needsHealthCheck) {
      const t0 = ctx.currentTime;
      setTimeout(() => {
        if (this.audioCtx === ctx && ctx.state === 'running' && ctx.currentTime === t0) {
          const fresh = this.recycleContext();
          if (fresh && this.isContextPaused(fresh)) {
            void this.safeResume(fresh, RESUME_TIMEOUT_MS);
          }
        } else if (this.audioCtx === ctx) {
          this.needsHealthCheck = false;
        }
      }, ZOMBIE_CLOCK_PROBE_MS);
    }
  }

  /**
   * Plays a gentle triple-tone completion chime (C5 - E5 - G5) via Web Audio API.
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const generation = ++this.playGeneration;

    if (typeof volume !== 'number' || !Number.isFinite(volume)) {
      return;
    }
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) {
      this.stopActiveChime();
      return;
    }

    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (this.isContextPaused(ctx)) {
      const requestedAt = Date.now();
      void this.safeResume(ctx, STALE_RESUME_THRESHOLD_MS).then((resumed) => {
        if (generation !== this.playGeneration) return;
        if (Date.now() - requestedAt > STALE_RESUME_THRESHOLD_MS) return;

        if (resumed && this.audioCtx === ctx && ctx.state === 'running') {
          this.scheduleTriad(ctx, clampedVol);
          return;
        }

        // Wedged context (sleep/wake/Bluetooth route change): attempt one clean recreate
        if (this.audioCtx === ctx) {
          const fresh = this.recycleContext();
          if (!fresh) return;
          if (fresh.state === 'running') {
            this.scheduleTriad(fresh, clampedVol);
          } else if (this.isContextPaused(fresh)) {
            void this.safeResume(fresh, 500).then((freshOk) => {
              if (
                freshOk &&
                generation === this.playGeneration &&
                this.audioCtx === fresh &&
                fresh.state === 'running' &&
                Date.now() - requestedAt <= STALE_RESUME_THRESHOLD_MS
              ) {
                this.scheduleTriad(fresh, clampedVol);
              }
            });
          }
        }
      });
    } else if (ctx.state === 'running') {
      // If wake/route-change flagged a health check and clock hasn't moved since markStaleForRecovery,
      // briefly probe whether CoreAudio/WASAPI froze ctx.currentTime before scheduling.
      if (
        this.needsHealthCheck &&
        this.lastObservedCurrentTime !== null &&
        ctx.currentTime === this.lastObservedCurrentTime
      ) {
        const t0 = ctx.currentTime;
        const requestedAt = Date.now();
        setTimeout(() => {
          if (generation !== this.playGeneration) return;
          if (this.audioCtx !== ctx) return;

          if (ctx.state === 'running' && ctx.currentTime > t0) {
            this.scheduleTriad(ctx, clampedVol);
            return;
          }

          // Zombie 'running' context with frozen clock: close & recreate
          const fresh = this.recycleContext();
          if (!fresh) return;
          if (fresh.state === 'running') {
            this.scheduleTriad(fresh, clampedVol);
          } else if (this.isContextPaused(fresh)) {
            void this.safeResume(fresh, 500).then((freshOk) => {
              if (
                freshOk &&
                generation === this.playGeneration &&
                this.audioCtx === fresh &&
                fresh.state === 'running' &&
                Date.now() - requestedAt <= STALE_RESUME_THRESHOLD_MS
              ) {
                this.scheduleTriad(fresh, clampedVol);
              }
            });
          }
        }, ZOMBIE_CLOCK_PROBE_MS);
        return;
      }

      this.scheduleTriad(ctx, clampedVol);
    }
  }
}

export const soundService = new SoundService();

