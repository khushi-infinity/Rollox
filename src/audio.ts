/**
 * Procedural Web Audio synthesizer for Rollox tactile bowling feedback.
 * Zero external audio assets required; all sounds respect master volume and mute.
 */
export class RolloxAudio {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastTickTime = 0;
  private lastPinSoundTime = 0;
  private lastRollSoundTime = 0;
  private _muted = false;
  private _volume = 0.85;

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    return this._muted;
  }

  private effectiveGain(baseGain: number): number {
    return Math.max(0.0005, baseGain * this._volume);
  }

  private ensureContext(): AudioContext | null {
    if (this._muted || this._volume <= 0.01) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext})
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.noiseBuffer && this.ctx) {
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.ctx;
  }

  playGrab(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const chime = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.055);
    chime.type = 'sine';
    chime.frequency.setValueAtTime(880, now + 0.015);
    gain.gain.setValueAtTime(this.effectiveGain(0.14), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.08);
    osc.connect(gain);
    chime.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    chime.start(now + 0.015);
    osc.stop(now + 0.085);
    chime.stop(now + 0.085);
  }

  playPowerTick(power01: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const nowMs = performance.now();
    if (nowMs - this.lastTickTime < 72) return;
    this.lastTickTime = nowMs;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = power01 >= 0.72 ? 'triangle' : 'sine';
    const freq = 260 + power01 * 460;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(this.effectiveGain(0.048), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.038);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  playLaunch(power01: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160 + power01 * 80, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.16);
    gain.gain.setValueAtTime(
      this.effectiveGain(0.22 * (0.5 + 0.5 * power01)),
      now
    );
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520 + power01 * 700, now);
      filter.Q.value = 1.6;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(
        this.effectiveGain(0.11 * (0.4 + 0.6 * power01)),
        now
      );
      nGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.22);
      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.23);
    }
  }

  /** Synthesizes gentle speed-modulated wooden alley rolling rumble while ball rolls. */
  updateRollingRumble(speed: number, onLane: boolean): void {
    if (!onLane || speed < 0.28) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const nowMs = performance.now();
    if (nowMs - this.lastRollSoundTime < 90) return;
    this.lastRollSoundTime = nowMs;

    const intensity = Math.min(1, speed / 3.4);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140 + intensity * 190, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectiveGain(0.045 * intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.095);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.1);
  }

  playPinHit(strength01 = 0.7): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const nowMs = performance.now();
    if (nowMs - this.lastPinSoundTime < 28) return;
    this.lastPinSoundTime = nowMs;

    const now = ctx.currentTime;
    const vol = this.effectiveGain(Math.min(1, Math.max(0.2, strength01)) * 0.18);

    const freqs = [920 + Math.random() * 140, 1480 + Math.random() * 200];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freqs[i], now);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.68, now + 0.08);
      gain.gain.setValueAtTime(vol * (i === 0 ? 1 : 0.6), now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    }

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 2.5;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(vol * 0.6, now);
      nGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.045);
      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.05);
    }
  }

  playDwarfBonk(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;

    gain.gain.setValueAtTime(this.effectiveGain(0.2), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.16);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playObstacleClang(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.11);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 680;
    gain.gain.setValueAtTime(this.effectiveGain(0.14), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.12);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  playRailTap(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(170, now + 0.05);
    gain.gain.setValueAtTime(this.effectiveGain(0.08), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.055);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playStrikeFanfare(): void {
    this.playChord([523.25, 659.25, 783.99, 1046.5], 0.075, 0.28);
  }

  playSpareChime(): void {
    this.playChord([440, 554.37, 659.25], 0.07, 0.22);
  }

  playLevelWin(): void {
    this.playChord([523.25, 659.25, 783.99, 987.77, 1046.5], 0.09, 0.3);
  }

  playClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    gain.gain.setValueAtTime(this.effectiveGain(0.08), now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  private playChord(
    notes: number[],
    staggerSec: number,
    durationSec: number
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const base = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const start = base + idx * staggerSec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(this.effectiveGain(0.13), start);
      gain.gain.exponentialRampToValueAtTime(0.0005, start + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durationSec + 0.02);
    });
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.noiseBuffer = null;
  }
}
