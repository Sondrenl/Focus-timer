/**
 * SoundService provides synthesized audio feedback using both HTML5 Audio (primed
 * for reliable background tab playback) and Web Audio API oscillators.
 * - In modern desktop and mobile browsers, Web Audio `AudioContext.resume()` is deferred
 *   when called in a background/hidden tab until the user focuses the tab.
 * - An HTML5 `<audio>` element with a synthesized chime WAV primed on user interaction
 *   bypasses this restriction and plays immediately even when the tab is in the background.
 * - Does NOT loop audio continuously, preventing mobile OSes (e.g. Android Chrome) from
 *   displaying unwanted persistent media notification widgets.
 */

function createWavBlobUrl(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function generateChimeWav(): string {
  const sampleRate = 44100;
  const durationSec = 1.65;
  const numSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(numSamples);
  const notes = [523.25, 659.25, 783.99]; // Major triad: C5 - E5 - G5

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let val = 0;
    for (let idx = 0; idx < notes.length; idx++) {
      const noteStart = idx * 0.14;
      const dt = t - noteStart;
      if (dt >= 0 && dt <= 1.25) {
        let env = 0;
        if (dt <= 0.02) {
          env = (dt / 0.02) * 0.4;
        } else {
          env = 0.4 * Math.pow(0.00025, (dt - 0.02) / 1.18);
        }
        val += Math.sin(2 * Math.PI * notes[idx] * dt) * env;
      }
    }
    samples[i] = val;
  }
  return createWavBlobUrl(samples, sampleRate);
}

export class SoundService {
  private audioCtx: AudioContext | null = null;
  private chimeWavUrl: string | null = null;
  private chimeAudio: HTMLAudioElement | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.chimeWavUrl = generateChimeWav();
        if (typeof Audio !== 'undefined') {
          this.chimeAudio = new Audio(this.chimeWavUrl);
          this.chimeAudio.preload = 'auto';
          this.chimeAudio.addEventListener('ended', () => {
            if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
              try {
                navigator.mediaSession.playbackState = 'none';
              } catch {
                // Ignore
              }
            }
          });
        }
      } catch (err) {
        console.warn('Failed to pre-generate chime WAV:', err);
      }

      // Explicitly clear any stale mediaSession playback state in mobile browsers
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch {
          // Ignore
        }
      }

      // Prepare and prime audio on user interactions so completion chimes play reliably in the background
      const unlockOnGesture = () => {
        this.prepareForPlayback();
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
   * Primes the HTML5 audio element within a user gesture so modern browsers permit
   * asynchronous audio playback while the tab is hidden / in the background.
   */
  primeAudio(): void {
    if (this.chimeAudio) {
      try {
        this.chimeAudio.volume = 0.001;
        const p = this.chimeAudio.play();
        if (p !== undefined) {
          p.then(() => {
            this.chimeAudio?.pause();
            if (this.chimeAudio) {
              this.chimeAudio.currentTime = 0;
            }
          }).catch(() => {
            // Priming error ignored
          });
        }
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Arms both Web Audio and HTML5 Audio for playback.
   * Call during user gestures (such as clicking Start Timer or interacting with controls).
   */
  prepareForPlayback(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    this.primeAudio();
  }

  /**
   * Safe no-op retained for API compatibility.
   * Background audio loops are intentionally disabled to prevent mobile media notification widgets.
   */
  startSilentKeepAlive(): void {
    this.prepareForPlayback();
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
    if (this.chimeAudio) {
      try {
        this.chimeAudio.pause();
      } catch {
        // Ignore
      }
    }
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
   * Plays a gentle, pleasant triple-tone chime (Major triad: C5 - E5 - G5).
   * Uses primed HTML5 Audio for immediate background-tab playback with Web Audio as fallback.
   * @param volume Volume scalar between 0.0 and 1.0
   */
  playChime(volume: number = 0.8): void {
    const clampedVol = Math.max(0, Math.min(1, volume));
    if (clampedVol === 0) return;

    // 1. Try HTML5 Audio first — primed HTMLMediaElement plays immediately in background tabs
    // without being blocked or deferred by document.hidden like AudioContext.resume() is.
    if (this.chimeAudio) {
      try {
        this.chimeAudio.pause();
        this.chimeAudio.currentTime = 0;
        this.chimeAudio.volume = clampedVol;

        const playPromise = this.chimeAudio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              // HTML5 audio started playing successfully
            })
            .catch((err) => {
              console.warn('HTML5 chime play failed, falling back to Web Audio:', err);
              this.playWebAudioChime(clampedVol);
            });
          return;
        }
      } catch (err) {
        console.warn('HTML5 chime play error, falling back to Web Audio:', err);
        this.playWebAudioChime(clampedVol);
        return;
      }
    }

    // 2. Fallback to Web Audio synthesis if HTML5 audio is not available
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
   * Plays the completion chime for break completion
   */
  playBreakComplete(volume: number = 0.8): void {
    this.playChime(volume);
  }
}

export const soundService = new SoundService();
