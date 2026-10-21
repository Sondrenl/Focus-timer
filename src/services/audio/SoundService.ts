/**
 * SoundService provides synthesized audio feedback using the Web Audio API.
 * - Does NOT create or play HTML5 <audio> elements in the background, preventing mobile OSes
 *   (e.g. Android Chrome) from displaying unwanted media playback widgets / lock-screen controls.
 * - Completion chimes are played via Web Audio oscillators and the AudioContext is immediately
 *   suspended after ringing so zero audio power assertions or media locks are held.
 */
export class SoundService {
  private audioCtx: AudioContext | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // Explicitly clear any stale mediaSession playback state in mobile browsers
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch {
          // Ignore
        }
      }

      // Unlock AudioContext on the first user interaction so chimes can play on completion
      const unlockOnGesture = () => {
        this.getAudioContext();
        window.removeEventListener('pointerdown', unlockOnGesture);
        window.removeEventListener('touchstart', unlockOnGesture);
        window.removeEventListener('touchend', unlockOnGesture);
        window.removeEventListener('click', unlockOnGesture);
        window.removeEventListener('keydown', unlockOnGesture);
      };
      window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
      window.addEventListener('touchstart', unlockOnGesture, { passive: true });
      window.addEventListener('touchend', unlockOnGesture, { passive: true });
      window.addEventListener('click', unlockOnGesture, { passive: true });
      window.addEventListener('keydown', unlockOnGesture, { passive: true });
    }
  }

  /**
   * Initializes or resumes the AudioContext
   */
  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  /**
   * Safe no-op retained for API compatibility.
   * Background audio loops are intentionally disabled to prevent mobile media notification widgets.
   */
  startSilentKeepAlive(): void {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Safe no-op retained for API compatibility.
   */
  stopSilentKeepAlive(_forceImmediate: boolean = false): void {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Explicitly suspends audio context when the app or tab is being unloaded.
   */
  stopKeepAliveForUnload(): void {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {
        // Ignore
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'running') {
      this.audioCtx.suspend().catch(() => {});
    }
  }

  /**
   * Plays a gentle, pleasant triple-tone chime (Major triad: C5 - E5 - G5)
   * Used for both Focus and Break completions.
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    this.playWebAudioChime(clampedVol);
  }

  private playWebAudioChime(clampedVol: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }

    const scheduleNotes = () => {
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

        osc.start(noteStartTime);
        osc.stop(noteStartTime + 1.3);
      });

      // Suspend the AudioContext shortly after the chime finishes so the device
      // holds zero OS audio assertions and stays quiet.
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this.audioCtx && this.audioCtx.state === 'running') {
          this.audioCtx.suspend().catch(() => {});
        }
      }, 1650);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(scheduleNotes).catch(scheduleNotes);
    } else {
      scheduleNotes();
    }
  }

  /**
   * Plays the same triple-tone completion chime for break completion
   */
  playBreakComplete(volume: number = 0.8): void {
    this.playChime(volume);
  }
}

export const soundService = new SoundService();
