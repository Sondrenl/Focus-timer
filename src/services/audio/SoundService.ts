/**
 * SoundService provides synthesized audio feedback using the Web Audio API.
 * This guarantees reliable, high-fidelity audio feedback without external asset dependencies.
 */
export class SoundService {
  private audioCtx: AudioContext | null = null;

  /**
   * Initializes or resumes the AudioContext on user interaction
   */
  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    return this.audioCtx;
  }

  /**
   * Plays a gentle, pleasant triple-tone chime (Major triad: C5 - E5 - G5)
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    // Frequencies for C5 (523.25 Hz), E5 (659.25 Hz), G5 (783.99 Hz)
    const notes = [523.25, 659.25, 783.99];
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteStartTime = now + idx * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteStartTime);

      // Smooth envelope: quick attack and natural exponential decay
      gain.gain.setValueAtTime(0.0001, noteStartTime);
      gain.gain.exponentialRampToValueAtTime(0.4 * clampedVol, noteStartTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStartTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStartTime);
      osc.stop(noteStartTime + 1.3);
    });
  }

  /**
   * Plays a deep calming gong/bell sound for break completion
   */
  playBreakComplete(volume: number = 0.8): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    const notes = [440.0, 554.37, 659.25]; // A4 major chord
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteStartTime = now + idx * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteStartTime);

      gain.gain.setValueAtTime(0.0001, noteStartTime);
      gain.gain.exponentialRampToValueAtTime(0.35 * clampedVol, noteStartTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStartTime + 1.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStartTime);
      osc.stop(noteStartTime + 1.7);
    });
  }
}

export const soundService = new SoundService();
