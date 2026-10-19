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
 * Generates the C5 - E5 - G5 major triad completion chime as a 44.1 kHz WAV.
 */
function generateWorkChimeWav(): string {
  const sampleRate = 44100;
  const durationSec = 1.65;
  const numSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(numSamples);
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let val = 0;
    for (let idx = 0; idx < notes.length; idx++) {
      const noteStart = idx * 0.14;
      const dt = t - noteStart;
      if (dt >= 0 && dt <= 1.3) {
        let env = 0;
        if (dt <= 0.02) {
          env = (dt / 0.02) * 0.33;
        } else {
          env = 0.33 * Math.pow(0.00025, (dt - 0.02) / 1.28);
        }
        val += Math.sin(2 * Math.PI * notes[idx] * dt) * env;
      }
    }
    samples[i] = val;
  }
  return createWavBlobUrl(samples, sampleRate);
}

/**
 * Generates the A4 - C#5 - E5 calming triangle-wave break chime as a 44.1 kHz WAV.
 */
function generateBreakChimeWav(): string {
  const sampleRate = 44100;
  const durationSec = 1.95;
  const numSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(numSamples);
  const notes = [440.0, 554.37, 659.25]; // A4 major chord

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let val = 0;
    for (let idx = 0; idx < notes.length; idx++) {
      const noteStart = idx * 0.1;
      const dt = t - noteStart;
      if (dt >= 0 && dt <= 1.7) {
        let env = 0;
        if (dt <= 0.03) {
          env = (dt / 0.03) * 0.3;
        } else {
          env = 0.3 * Math.pow(0.00025, (dt - 0.03) / 1.67);
        }
        const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * notes[idx] * dt));
        val += tri * env;
      }
    }
    samples[i] = val;
  }
  return createWavBlobUrl(samples, sampleRate);
}

/**
 * SoundService provides synthesized audio feedback using both an HTML5 <audio> pipeline
 * (which stays active on mobile when the phone screen is turned off and plays through
 * iOS Silent Mode) and the Web Audio API as a fallback.
 */
export class SoundService {
  private audioCtx: AudioContext | null = null;
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;

  private bgAudio: HTMLAudioElement | null = null;
  private silentWavUrl: string | null = null;
  private workChimeWavUrl: string | null = null;
  private breakChimeWavUrl: string | null = null;
  private keepAliveActive: boolean = false;
  private isPlayingChime: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.silentWavUrl = generateSilentKeepAliveWav();
        this.workChimeWavUrl = generateWorkChimeWav();
        this.breakChimeWavUrl = generateBreakChimeWav();
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

      audio.onended = () => {
        this.isPlayingChime = false;
        if (this.keepAliveActive && this.silentWavUrl) {
          audio.src = this.silentWavUrl;
          audio.loop = true;
          audio.volume = 0.05;
          audio.play().catch(() => {});
        }
      };

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
   * Using an HTML5 <audio> element playing a real PCM WAV loop prevents mobile OSes
   * (iOS Safari / Android Chrome) from suspending JavaScript timers when the phone screen
   * is turned off, and keeps the media element active so the completion chime plays out loud
   * when the timer reaches 00:00 even while the phone is locked.
   */
  startSilentKeepAlive(): void {
    this.keepAliveActive = true;

    try {
      const audio = this.getOrCreateBgAudio();
      if (audio && this.silentWavUrl && !this.isPlayingChime) {
        if (!audio.src.endsWith(this.silentWavUrl)) {
          audio.src = this.silentWavUrl;
        }
        audio.loop = true;
        audio.volume = 0.05;
        audio.play().catch(() => {});
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
   * If a completion chime is currently playing on `bgAudio`, it lets the chime finish first.
   */
  stopSilentKeepAlive(forceImmediate: boolean = false): void {
    this.keepAliveActive = false;

    try {
      if (this.bgAudio && (forceImmediate || !this.isPlayingChime)) {
        this.isPlayingChime = false;
        this.bgAudio.loop = false;
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

    const audio = this.getOrCreateBgAudio();
    if (audio && this.workChimeWavUrl) {
      this.isPlayingChime = true;
      audio.loop = false;
      audio.src = this.workChimeWavUrl;
      audio.volume = clampedVol;
      audio.currentTime = 0;
      audio.play().catch(() => {
        this.isPlayingChime = false;
        this.playWebAudioChime(clampedVol);
      });
      return;
    }

    this.playWebAudioChime(clampedVol);
  }

  private playWebAudioChime(clampedVol: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

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
  }

  /**
   * Plays a deep calming gong/bell sound for break completion
   */
  playBreakComplete(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    const audio = this.getOrCreateBgAudio();
    if (audio && this.breakChimeWavUrl) {
      this.isPlayingChime = true;
      audio.loop = false;
      audio.src = this.breakChimeWavUrl;
      audio.volume = clampedVol;
      audio.currentTime = 0;
      audio.play().catch(() => {
        this.isPlayingChime = false;
        this.playWebAudioBreakComplete(clampedVol);
      });
      return;
    }

    this.playWebAudioBreakComplete(clampedVol);
  }

  private playWebAudioBreakComplete(clampedVol: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

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
  }
}

export const soundService = new SoundService();
