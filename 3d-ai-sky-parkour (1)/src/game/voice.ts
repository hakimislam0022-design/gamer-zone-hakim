import { gameAudio } from "./audio";

export type VoiceMode = "idle" | "tts" | "browser" | "text";

export function detectLang(text: string): "bn" | "en" {
  return /[\u0980-\u09FF]/.test(text) ? "bn" : "en";
}

/**
 * Character voice. Preferred path: server-side TTS (/api/tts) played through WebAudio with an AnalyserNode,
 * so mouth movement is driven by the REAL speech signal. Fallback: browser speechSynthesis (the audio cannot be
 * tapped, so the mouth is driven by an estimated envelope and this is reported in `engineLabel`).
 */
export class Voice {
  enabled = true;
  speaking = false;
  audible = false;
  mouth = 0;
  viseme = 0.5;
  mode: VoiceMode = "idle";
  engineLabel = "checking…";
  ttsAvailable: boolean | null = null;
  onStart: (text: string) => void = () => {};
  onEnd: () => void = () => {};

  private analyser: AnalyserNode | null = null;
  private td: Uint8Array<ArrayBuffer> | null = null;
  private fd: Uint8Array<ArrayBuffer> | null = null;
  private source: AudioBufferSourceNode | null = null;
  private token = 0;
  private t = 0;
  private lastBoundary = -10;
  private cache = new Map<string, AudioBuffer>();

  setTtsAvailable(v: boolean) {
    this.ttsAvailable = v;
    this.engineLabel = v ? "Server TTS (audio-driven lip-sync)" : typeof speechSynthesis !== "undefined" ? "Browser voice (estimated lip-sync)" : "No voice engine";
  }

  stop() {
    this.token++;
    try {
      this.source?.stop();
    } catch {}
    this.source = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.finish();
  }

  private finish() {
    const was = this.speaking;
    this.speaking = false;
    this.audible = false;
    this.mouth = 0;
    this.mode = "idle";
    if (was) this.onEnd();
  }

  private sleep(ms: number, token: number) {
    return new Promise<void>((res) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (token !== this.token || Date.now() - start >= ms) {
          clearInterval(iv);
          res();
        }
      }, 120);
    });
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;
    this.stop();
    const token = this.token;
    this.speaking = true;
    this.onStart(text);
    const readTime = Math.min(14000, 1800 + text.length * 70);

    if (!this.enabled) {
      this.mode = "text";
      await this.sleep(readTime, token);
      if (token === this.token) this.finish();
      return;
    }

    gameAudio.init();
    const ctx = gameAudio.ctx;
    if (ctx && this.ttsAvailable !== false) {
      try {
        let buf = this.cache.get(text) ?? null;
        if (!buf) {
          const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
          if (token !== this.token) return;
          if (res.status === 501) {
            this.setTtsAvailable(false);
          } else if (res.ok) {
            const arr = await res.arrayBuffer();
            buf = await ctx.decodeAudioData(arr);
            if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value as string);
            this.cache.set(text, buf);
          }
        }
        if (token !== this.token) return;
        if (buf) {
          if (!this.analyser) {
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.4;
            this.analyser.connect(gameAudio.voiceGain);
            this.td = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
            this.fd = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
          }
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.analyser);
          this.source = src;
          this.mode = "tts";
          this.audible = true;
          await new Promise<void>((res) => {
            src.onended = () => res();
            src.start();
          });
          if (token === this.token) this.finish();
          return;
        }
      } catch (e) {
        if (token !== this.token) return;
        console.warn("TTS failed, falling back", e);
      }
    }

    // browser speechSynthesis fallback
    if (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
      const lang = detectLang(text);
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang === "bn" ? "bn" : "en-us")) ?? voices.find((x) => x.lang.toLowerCase().startsWith(lang));
      if (v) u.voice = v;
      u.lang = v?.lang ?? (lang === "bn" ? "bn-BD" : "en-US");
      u.pitch = 1.35;
      u.rate = 1.05;
      u.volume = Math.min(1, gameAudio.volumes.master * gameAudio.volumes.voice);
      if (v || lang === "en") {
        this.mode = "browser";
        this.audible = true;
        await new Promise<void>((res) => {
          u.onend = () => res();
          u.onerror = () => res();
          u.onboundary = () => {
            this.lastBoundary = this.t;
          };
          speechSynthesis.speak(u);
          setTimeout(res, Math.min(30000, readTime * 2.5));
        });
        if (token === this.token) this.finish();
        return;
      }
    }
    this.mode = "text";
    this.audible = false;
    await this.sleep(readTime, token);
    if (token === this.token) this.finish();
  }

  /** Call every frame. Fills `mouth` (0..1) and `viseme` (0=round, 1=wide). */
  update(dt: number) {
    this.t += dt;
    if (!this.speaking || !this.audible) {
      this.mouth = 0;
      return;
    }
    if (this.mode === "tts" && this.analyser && this.td && this.fd) {
      this.analyser.getByteTimeDomainData(this.td);
      let sum = 0;
      for (let i = 0; i < this.td.length; i++) {
        const v = (this.td[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.td.length);
      this.mouth = Math.min(1, rms * 6);
      this.analyser.getByteFrequencyData(this.fd);
      let lo = 0,
        hi = 0;
      const n = this.fd.length;
      for (let i = 0; i < n; i++) {
        if (i < n * 0.12) lo += this.fd[i];
        else if (i < n * 0.5) hi += this.fd[i];
      }
      this.viseme = Math.min(1, Math.max(0, (hi / (lo + hi + 1)) * 1.8));
    } else if (this.mode === "browser") {
      const pulse = Math.max(0, 1 - (this.t - this.lastBoundary) * 4);
      this.mouth = Math.min(1, 0.18 + 0.4 * Math.abs(Math.sin(this.t * 13)) * (0.5 + 0.5 * Math.abs(Math.sin(this.t * 3.3))) + 0.3 * pulse);
      this.viseme = 0.5 + 0.4 * Math.sin(this.t * 7);
    }
  }
}

export const voice = new Voice();
