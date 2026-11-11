import { makeRng } from "@/lib/rng";

/**
 * Procedural audio. The background music and every sound effect are generated in real time from this
 * source file (original composition, no samples) so there are no third-party licensing obligations.
 * See MUSIC_LICENSE.md.
 */
export class GameAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicGain!: GainNode;
  sfxGain!: GainNode;
  voiceGain!: GainNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private rng = makeRng(777);
  musicOn = true;
  sfxOn = true;
  volumes = { master: 0.8, music: 0.5, sfx: 0.7, voice: 1 };
  private lead = 4;

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.voiceGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.voiceGain.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.applyVolumes();
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (ctx.state === "suspended") void ctx.resume();
    if (this.musicOn) this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicGain.gain.value = this.musicOn ? this.volumes.music * 0.5 : 0;
    this.sfxGain.gain.value = this.sfxOn ? this.volumes.sfx : 0;
    this.voiceGain.gain.value = this.volumes.voice;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.applyVolumes();
    if (on) this.startMusic();
    else this.stopMusic();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    this.applyVolumes();
  }

  /* ------------------------------------------------------------ music */
  private startMusic() {
    if (!this.ctx || this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  private stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const stepDur = 60 / 124 / 4;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.1;
    while (this.nextTime < ctx.currentTime + 0.35) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, vol: number, dest: AudioNode, attack = 0.005, filter?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, vol: number, dest: AudioNode, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  private playStep(step: number, t: number, stepDur: number) {
    const ctx = this.ctx!;
    const s = step % 16;
    const chordIdx = this.bar % 4;
    const roots = [0, 7, 9, 5];
    const minor = chordIdx === 2;
    const root = 261.63 * Math.pow(2, roots[chordIdx] / 12);
    const third = minor ? 3 : 4;
    const chord = [0, third, 7, 12];
    const f = (semi: number, oct = 0) => root * Math.pow(2, (semi + oct * 12) / 12);
    const out = this.musicGain;
    // drums
    if (s % 4 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.25);
    }
    if (s === 4 || s === 12) this.noiseHit(t, 0.14, 0.35, out, "bandpass", 1800);
    if (s % 2 === 1) this.noiseHit(t, 0.04, 0.12, out, "highpass", 7000);
    // bass
    if ([0, 3, 6, 8, 11, 14].includes(s)) this.osc("triangle", f(0, -2), t, stepDur * 2.2, 0.5, out, 0.005, 700);
    // arpeggio
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2];
    this.osc("sawtooth", f(chord[pattern[s]], 1), t, stepDur * 0.9, 0.11, out, 0.004, 2600);
    // pad on bar start
    if (s === 0) for (const c of [0, third, 7]) this.osc("sine", f(c, 0), t, stepDur * 15, 0.12, out, 0.4);
    // evolving lead (pentatonic random walk, deterministic seed => original but never loops exactly)
    if (s % 2 === 0 && this.rng.chance(0.62)) {
      const pent = [0, 2, 4, 7, 9, 12, 14, 16];
      this.lead = Math.max(0, Math.min(pent.length - 1, this.lead + this.rng.int(-2, 2)));
      this.osc("square", 261.63 * 2 * Math.pow(2, pent[this.lead] / 12), t, stepDur * 1.6, 0.06, out, 0.005, 3200);
    }
  }

  /* -------------------------------------------------------------- sfx */
  play(name: "jump" | "land" | "step" | "hit" | "fall" | "checkpoint" | "finish" | "respawn" | "click" | "blip", intensity = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime;
    const d = this.sfxGain;
    switch (name) {
      case "jump": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(260, t);
        o.frequency.exponentialRampToValueAtTime(620, t + 0.14);
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g);
        g.connect(d);
        o.start(t);
        o.stop(t + 0.2);
        break;
      }
      case "land":
        this.noiseHit(t, 0.12, Math.min(0.5, 0.15 + intensity * 0.02), d, "lowpass", 600);
        this.osc("sine", 90, t, 0.12, 0.3, d);
        break;
      case "step":
        this.noiseHit(t, 0.05, 0.06, d, "bandpass", 1200);
        break;
      case "hit":
        this.osc("sawtooth", 220, t, 0.25, 0.25, d, 0.002, 900);
        this.osc("square", 110, t, 0.3, 0.2, d);
        this.noiseHit(t, 0.15, 0.3, d, "lowpass", 1500);
        break;
      case "fall": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(700, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.8);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(g);
        g.connect(d);
        o.start(t);
        o.stop(t + 0.9);
        break;
      }
      case "checkpoint":
        [523.25, 659.25, 783.99, 1046.5].forEach((fr, i) => this.osc("triangle", fr, t + i * 0.08, 0.3, 0.22, d));
        break;
      case "finish":
        [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((fr, i) => this.osc("square", fr, t + i * 0.11, 0.35, 0.14, d, 0.005, 3500));
        break;
      case "respawn":
        this.osc("sine", 330, t, 0.25, 0.2, d);
        this.osc("sine", 495, t + 0.1, 0.25, 0.2, d);
        break;
      case "click":
        this.osc("square", 880, t, 0.05, 0.1, d);
        break;
      case "blip":
        this.osc("triangle", 700, t, 0.08, 0.1, d);
        break;
    }
  }
}

export const gameAudio = new GameAudio();
