/**
 * SoundService plays a simple completion chime using the native Web Audio API.
 * Used when the app is running in-browser and OS notifications are not handling sound.
 */
const STALE_RESUME_THRESHOLD_MS = 1500;

export class SoundService {
  private audioCtx: AudioContext | null = null;
  private activeNodes: Set<{ osc: OscillatorNode; gain: GainNode }> = new Set();

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (this.audioCtx && this.audioCtx.state === 'closed') {
      this.activeNodes.clear();
      this.audioCtx = null;
    }

    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }

    return this.audioCtx;
  }

  private isContextPaused(ctx: AudioContext): boolean {
    const state = ctx.state as string;
    return state === 'suspended' || state === 'interrupted';
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

  /**
   * Initializes or resumes the native AudioContext during a user gesture
   * (such as starting a timer or clicking Test Chime).
   */
  prepareForPlayback(): void {
    const ctx = this.getAudioContext();
    if (ctx && this.isContextPaused(ctx)) {
      ctx.resume().catch(() => {});
    }
  }

  /**
   * Plays a gentle triple-tone completion chime (C5 - E5 - G5) via Web Audio API.
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    const ctx = this.getAudioContext();
    if (!ctx) return;

    const scheduleNotes = () => {
      this.stopActiveChime();

      const notes = [523.25, 659.25, 783.99];
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const noteStartTime = now + idx * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStartTime);

        gain.gain.setValueAtTime(0.0001, noteStartTime);
        gain.gain.exponentialRampToValueAtTime(0.4 * clampedVol, noteStartTime + 0.02);
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
    };

    if (this.isContextPaused(ctx)) {
      const requestedAt = Date.now();
      ctx
        .resume()
        .then(() => {
          if (ctx.state !== 'running' || Date.now() - requestedAt > STALE_RESUME_THRESHOLD_MS) {
            return;
          }
          scheduleNotes();
        })
        .catch(() => {});
    } else if (ctx.state === 'running') {
      scheduleNotes();
    }
  }
}

export const soundService = new SoundService();
