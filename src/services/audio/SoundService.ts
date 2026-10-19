/**
 * Encodes floating-point mono audio samples (-1.0 to 1.0) into a 16-bit PCM WAV Blob URL.
 */
function createWavBlobUrl(samples: Float32Array, sampleRate: number): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(intSample), true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Generates a 1-second sub-audible (-84 dB) WAV for keeping mobile HTML5 <audio> alive
 * when the phone screen is turned off or the user switches apps.
 */
function generateSilentKeepAliveWav(): string {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < sampleRate; i++) {
    // Non-zero (~2/32767) so mobile OS audio decoders do not suspend it as digital silence
    samples[i] = Math.sin((2 * Math.PI * 2 * i) / sampleRate) * 0.00006;
  }
  return createWavBlobUrl(samples, sampleRate);
}

/**
 * SoundService provides synthesized audio feedback using Web Audio API while maintaining
 * an uninterrupted HTML5 <audio> + Web Audio keep-alive session in the background so
 * mobile browsers never cut off the completion chime mid-ring when on the Home Screen or locked.
 */
export class SoundService {
  private audioCtx: AudioContext | null = null;
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;

  private bgAudio: HTMLAudioElement | null = null;
  private silentWavUrl: string | null = null;
  private keepAliveActive: boolean = false;
  private chimeEndTimeMs: number = 0;
  private deferredStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.silentWavUrl = generateSilentKeepAliveWav();
      } catch {
        // Ignore if Blob/URL is unavailable in test environment
      }
    }
  }

  private getOrCreateBgAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    if (!this.bgAudio) {
      const audio = new Audio();
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.preload = 'auto';
      audio.loop = true;
      audio.volume = 0.05;
      if (this.silentWavUrl) {
        audio.src = this.silentWavUrl;
      }
      this.bgAudio = audio;
    }
    return this.bgAudio;
  }

  /**
   * Initializes or resumes the AudioContext on user interaction
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
   * Starts an inaudible keep-alive audio loop when the timer is started by a user gesture.
   * Keeping both the HTML5 <audio> loop and Web Audio oscillator alive without swapping `.src`
   * prevents mobile OSes from suspending the background tab or cutting off the completion chime.
   */
  startSilentKeepAlive(): void {
    this.keepAliveActive = true;
    if (this.deferredStopTimer) {
      clearTimeout(this.deferredStopTimer);
      this.deferredStopTimer = null;
    }

    try {
      const audio = this.getOrCreateBgAudio();
      if (audio && this.silentWavUrl) {
        audio.loop = true;
        audio.volume = 0.05;
        if (audio.paused) {
          audio.play().catch(() => {});
        }
      }
    } catch {
      // Ignore HTML5 audio errors
    }

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      if (this.keepAliveOsc) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        return;
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1, ctx.currentTime);
      gain.gain.setValueAtTime(0.00001, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      this.keepAliveOsc = osc;
      this.keepAliveGain = gain;
    } catch {
      // Ignore audio context restrictions if called without user gesture
    }
  }

  /**
   * Stops the silent background keep-alive audio when the timer is paused, reset, or completed.
   * When `forceImmediate` is false (natural completion at 00:00), it waits until any active
   * completion chime has completely finished ringing out before releasing the audio session.
   */
  stopSilentKeepAlive(forceImmediate: boolean = false): void {
    this.keepAliveActive = false;

    if (this.deferredStopTimer) {
      clearTimeout(this.deferredStopTimer);
      this.deferredStopTimer = null;
    }

    const remainingChimeMs = this.chimeEndTimeMs - Date.now();
    if (!forceImmediate && remainingChimeMs > 0) {
      this.deferredStopTimer = setTimeout(() => {
        this.deferredStopTimer = null;
        if (!this.keepAliveActive) {
          this.stopKeepAliveNodesNow();
        }
      }, remainingChimeMs + 250);
      return;
    }

    this.stopKeepAliveNodesNow();
  }

  private stopKeepAliveNodesNow(): void {
    try {
      if (this.bgAudio) {
        this.bgAudio.pause();
      }
    } catch {
      // Ignore HTML5 audio pause errors
    }

    try {
      if (this.keepAliveOsc) {
        this.keepAliveOsc.stop();
        this.keepAliveOsc.disconnect();
        this.keepAliveOsc = null;
      }
      if (this.keepAliveGain) {
        this.keepAliveGain.disconnect();
        this.keepAliveGain = null;
      }
    } catch {
      this.keepAliveOsc = null;
      this.keepAliveGain = null;
    }
  }

  /**
   * Plays a gentle, pleasant triple-tone chime (Major triad: C5 - E5 - G5)
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    // Reserve keep-alive grace window so the OS does not suspend the tab before the 1.65s chime finishes
    this.chimeEndTimeMs = Date.now() + 2600;
    this.playWebAudioChime(clampedVol);
  }

  private playWebAudioChime(clampedVol: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

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
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(scheduleNotes).catch(scheduleNotes);
    } else {
      scheduleNotes();
    }
  }

  /**
   * Plays a deep calming gong/bell sound for break completion
   */
  playBreakComplete(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    // Reserve keep-alive grace window so the OS does not suspend the tab before the 1.95s chime finishes
    this.chimeEndTimeMs = Date.now() + 2800;
    this.playWebAudioBreakComplete(clampedVol);
  }

  private playWebAudioBreakComplete(clampedVol: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const scheduleNotes = () => {
      const notes = [440.0, 554.37, 659.25];
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
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(scheduleNotes).catch(scheduleNotes);
    } else {
      scheduleNotes();
    }
  }
}

export const soundService = new SoundService();
