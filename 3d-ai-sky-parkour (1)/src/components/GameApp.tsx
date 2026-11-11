"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, HudInfo, EngineEvent, Quality } from "@/game/engine";
import { gameAudio } from "@/game/audio";
import { voice, detectLang } from "@/game/voice";

/* ----------------------------------------------------------------- types */
interface Prefs {
  bot: boolean;
  talk: boolean;
  liveChat: boolean;
  voice: boolean;
  music: boolean;
  joystick: boolean;
  quality: Quality;
  camDist: number;
  master: number;
  musicVol: number;
  voiceVol: number;
}
interface ChatEntry {
  id: string;
  author: string;
  text: string;
  source: "youtube" | "local";
  reply?: string;
  engine?: string;
  state: "queued" | "replied" | "skipped";
  ts: number;
  verdict?: string;
  channelId?: string;
}
interface YtState {
  code: string;
  label: string;
  detail?: string;
  configured: boolean;
  authorized: boolean;
  channel: string | null;
  title: string | null;
}
interface Caps {
  llm: boolean;
  tts: boolean;
  youtubeConfigured: boolean;
  model?: string;
}
interface SpeechItem {
  text: string;
  prio: number;
  ts: number;
}

const DEFAULT_PREFS: Prefs = { bot: true, talk: true, liveChat: true, voice: true, music: true, joystick: false, quality: "high", camDist: 11, master: 0.8, musicVol: 0.5, voiceVol: 1 };

const LINES: Record<string, { en: string[]; bn: string[] }> = {
  fall: {
    en: ["Whoa, I fell again! Back to the checkpoint.", "Oops! That gap was bigger than it looked.", "Splash! Okay, let's try that jump again.", "I slipped! The ocean looks nice from up here though.", "Not my best landing. One more try!"],
    bn: ["ওহ না, আবার পড়ে গেলাম! চেকপয়েন্ট থেকে আবার শুরু।", "ইশ! ফাঁকটা তো দেখার চেয়ে বড় ছিল!", "ছপ! ঠিক আছে, আবার চেষ্টা করি।", "পিছলে গেলাম! নিচের সমুদ্র কিন্তু সুন্দর।"],
  },
  hit: {
    en: ["Ouch! That obstacle hit me hard.", "Whoa, that bar nearly knocked me out!", "Bonk! I need better timing."],
    bn: ["আউচ! বাধাটা জোরে লাগল!", "বাবারে, প্রায় উড়িয়েই দিয়েছিল!", "ঠুস! টাইমিংটা আরও ভালো করতে হবে।"],
  },
  checkpoint: {
    en: ["Checkpoint reached! Safe for now.", "Nice, checkpoint saved!", "Yes! Halfway there, I hope!"],
    bn: ["চেকপয়েন্ট পেয়ে গেছি! এখন নিরাপদ।", "দারুণ, চেকপয়েন্ট সেভ হলো!", "ইয়েস! আরেকটু এগোলাম!"],
  },
  complete: {
    en: ["Stage {s} complete! Woohoo!", "I did it! Stage {s} is done!", "Victory dance time! Stage {s} cleared!"],
    bn: ["স্টেজ {s} শেষ! ইয়াহু!", "আমি পেরে গেছি! স্টেজ {s} সম্পন্ন!", "জয়ের নাচ হবে! স্টেজ {s} পার!"],
  },
  stageStart: {
    en: ["Starting stage {s}. Look at all those platforms!", "Stage {s}, here we go!", "New stage, new jumps. Stage {s} time!"],
    bn: ["স্টেজ {s} শুরু করছি। কত প্ল্যাটফর্ম দেখো!", "স্টেজ {s}, চলো যাই!", "নতুন স্টেজ, নতুন লাফ! স্টেজ {s}!"],
  },
  assist: {
    en: ["That part is really tough, my bot took a shortcut to the next checkpoint.", "I got stuck too many times, so I'm skipping ahead a little."],
    bn: ["এই জায়গাটা খুব কঠিন, তাই বট পরের চেকপয়েন্টে এগিয়ে গেল।", "অনেকবার আটকে গেছি, তাই একটু এগিয়ে যাচ্ছি।"],
  },
  stuck: {
    en: ["I got stuck, resetting to the checkpoint."],
    bn: ["আটকে গিয়েছিলাম, চেকপয়েন্টে ফিরছি।"],
  },
  jump: {
    en: ["Hup!", "Jumping!", "Here I go!", "Wheee!"],
    bn: ["হুপ!", "লাফ!", "যাচ্ছি!", "ওয়াহ!"],
  },
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

function post(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/* ------------------------------------------------------------ UI pieces */
function Toggle({ label, on, onClick, sub, tone = "emerald" }: { label: string; on: boolean; onClick: () => void; sub?: string; tone?: string }) {
  void tone;
  return (
    <button
      onClick={(e) => {
        onClick();
        e.currentTarget.blur(); // keep Space free for jumping
      }}
      aria-pressed={on}
      className={`pointer-events-auto flex min-w-[104px] flex-col items-center rounded-xl border px-3 py-1.5 text-xs font-bold tracking-wide shadow-lg backdrop-blur transition active:scale-95 ${
        on ? "border-emerald-300/70 bg-emerald-500/80 text-white" : "border-white/20 bg-slate-900/70 text-slate-300"
      }`}
    >
      <span>{label}</span>
      <span className={`text-[10px] font-semibold ${on ? "text-emerald-50" : "text-slate-400"}`}>{on ? "ON" : "OFF"}{sub ? ` · ${sub}` : ""}</span>
    </button>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-950/65 px-2.5 py-1 text-[11px] backdrop-blur">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="font-semibold text-slate-300">{label}</span>
      <span className="max-w-[170px] truncate text-white">{value}</span>
    </div>
  );
}

function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const handle = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 20;
    const l = Math.hypot(dx, dy);
    if (l > max) {
      dx = (dx / l) * max;
      dy = (dy / l) * max;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx / max, -dy / max);
  };
  return (
    <div
      ref={base}
      className="pointer-events-auto absolute bottom-6 left-6 h-36 w-36 touch-none select-none rounded-full border-2 border-white/40 bg-white/10 backdrop-blur"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        handle(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && handle(e)}
      onPointerUp={() => {
        active.current = null;
        setKnob({ x: 0, y: 0 });
        onMove(0, 0);
      }}
      onPointerCancel={() => {
        active.current = null;
        setKnob({ x: 0, y: 0 });
        onMove(0, 0);
      }}
    >
      <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow-lg" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}

/* ----------------------------------------------------------------- main */
export default function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const prefsRef = useRef(prefs);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const hudRef = useRef<HudInfo | null>(null);
  const [caption, setCaption] = useState<{ text: string; who: string } | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [yt, setYt] = useState<YtState>({ code: "checking", label: "CHECKING…", configured: false, authorized: false, channel: null, title: null });
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [panel, setPanel] = useState(true);
  const [hideUi, setHideUi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [videoId, setVideoId] = useState("");
  const [localMsg, setLocalMsg] = useState("");
  const [localName, setLocalName] = useState("Viewer");
  const [stageInput, setStageInput] = useState("");
  const [stats, setStats] = useState({ completed: 0, falls: 0, highest: 1, playMs: 0 });
  const [bestMap, setBestMap] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  const statsRef = useRef(stats);
  const chatRef = useRef<ChatEntry[]>([]);
  const speechQ = useRef<SpeechItem[]>([]);
  const lastEventSpeech = useRef(0);
  const lastSpeechEnd = useRef(Date.now());
  const lastReplyAt = useRef(0);
  const authorLast = useRef(new Map<string, number>());
  const seenAuthors = useRef(new Set<string>());
  const lineIdx = useRef<Record<string, number>>({});
  const lastEventName = useRef("");
  const ytRef = useRef(yt);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);
  useEffect(() => {
    ytRef.current = yt;
  }, [yt]);

  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => {
      const n = { ...p, [k]: v };
      prefsRef.current = n;
      try {
        localStorage.setItem("skyparkour.prefs", JSON.stringify(n));
      } catch {}
      return n;
    });
  }, []);

  const logRemote = useCallback((level: string, source: string, message: string, detail?: string) => {
    if (level === "info") return;
    post("/api/log", { level, source, message, detail, stage: hudRef.current?.stageId }).catch(() => {});
  }, []);

  /* ----------------------------------------------------- speech manager */
  const say = useCallback((text: string, prio: number) => {
    if (!prefsRef.current.talk && prio < 3) return;
    const q = speechQ.current;
    q.push({ text, prio, ts: Date.now() });
    if (q.length > 12) q.splice(0, q.length - 12);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (voice.speaking) return;
      const q = speechQ.current;
      // drop stale low-priority lines
      for (let i = q.length - 1; i >= 0; i--) if (q[i].prio < 2 && now - q[i].ts > 7000) q.splice(i, 1);
      if (!q.length) return;
      let bi = 0;
      for (let i = 1; i < q.length; i++) if (q[i].prio > q[bi].prio) bi = i;
      const item = q.splice(bi, 1)[0];
      voice.enabled = prefsRef.current.voice;
      void voice.speak(item.text);
    }, 250);
    voice.onStart = (t) => setCaption({ text: t, who: "Robo Parkour" });
    voice.onEnd = () => {
      lastSpeechEnd.current = Date.now();
      setTimeout(() => {
        if (!voice.speaking) setCaption(null);
      }, 900);
    };
    return () => clearInterval(iv);
  }, []);

  const reactTo = useCallback(
    (ev: EngineEvent) => {
      lastEventName.current = ev.type;
      const now = Date.now();
      const h = hudRef.current;
      const key = ev.type;
      const set = LINES[key];
      if (!set) return;
      if (key === "jump") {
        if (Math.random() > 0.06) return;
      }
      const minGap = key === "complete" || key === "stageStart" ? 2500 : key === "jump" ? 25000 : 11000;
      if (now - lastEventSpeech.current < minGap) return;
      if (voice.speaking || speechQ.current.some((s) => s.prio >= 1)) return;
      lastEventSpeech.current = now;
      const lang = Math.random() < 0.5 ? "bn" : "en";
      const arr = set[lang];
      let i = Math.floor(Math.random() * arr.length);
      if (i === lineIdx.current[key + lang]) i = (i + 1) % arr.length;
      lineIdx.current[key + lang] = i;
      say(arr[i].replace("{s}", String(h?.stageId ?? ev.stageId)), 1);
    },
    [say],
  );

  /* --------------------------------------------------- progress saving */
  const saveProgress = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const s = statsRef.current;
    const body = {
      currentStage: e.stageId,
      highestStage: Math.max(s.highest, e.stageId),
      totalCompleted: s.completed,
      totalFalls: s.falls,
      totalPlayMs: s.playMs,
      checkpoint: { stage: e.stageId, cp: e.getCheckpointIndex() },
      settings: prefsRef.current,
    };
    try {
      localStorage.setItem("skyparkour.progress", JSON.stringify(body));
    } catch {}
    post("/api/progress", body).catch(() => {});
  }, []);

  /* ------------------------------------------------------- engine setup */
  useEffect(() => {
    let disposed = false;
    let engine: GameEngine | null = null;
    let playTimer: ReturnType<typeof setInterval> | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // preferences
      let p = DEFAULT_PREFS;
      try {
        const raw = localStorage.getItem("skyparkour.prefs");
        if (raw) p = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
        else if (matchMedia("(pointer: coarse)").matches) p = { ...p, joystick: true };
        setBestMap(JSON.parse(localStorage.getItem("skyparkour.best") || "{}"));
      } catch {}
      setPrefs(p);
      prefsRef.current = p;
      voice.enabled = p.voice;
      gameAudio.musicOn = p.music;
      gameAudio.volumes = { master: p.master, music: p.musicVol, sfx: 0.7, voice: p.voiceVol };

      // capabilities
      try {
        const c = (await (await fetch("/api/config")).json()) as Caps;
        if (!disposed) {
          setCaps(c);
          voice.setTtsAvailable(c.tts);
        }
      } catch {
        voice.setTtsAvailable(false);
      }

      // saved progress (database first, local copy as fallback)
      let startStage = 1;
      let startCp = 0;
      try {
        const r = (await (await fetch("/api/progress")).json()) as { progress: { currentStage: number; highestStage: number; totalCompleted: number; totalFalls: number; totalPlayMs: number; checkpoint?: { stage: number; cp: number } } | null };
        let pr = r.progress;
        if (!pr) {
          const loc = localStorage.getItem("skyparkour.progress");
          if (loc) pr = JSON.parse(loc);
        }
        if (pr) {
          startStage = pr.currentStage || 1;
          if (pr.checkpoint && pr.checkpoint.stage === startStage) startCp = pr.checkpoint.cp || 0;
          setStats({ completed: pr.totalCompleted || 0, falls: pr.totalFalls || 0, highest: pr.highestStage || startStage, playMs: pr.totalPlayMs || 0 });
        }
      } catch {}
      const q = new URLSearchParams(location.search).get("stage");
      if (q && Number(q) > 0) {
        startStage = Number(q);
        startCp = 0;
      }
      if (disposed || !canvasRef.current) return;

      engine = new GameEngine(canvasRef.current, {
        onHud: (h) => {
          hudRef.current = h;
          setHud(h);
        },
        onEvent: (ev) => {
          if (ev.type === "complete") {
            const e = engineRef.current!;
            const t = Number(ev.data?.timeMs ?? 0);
            setStats((s) => ({ ...s, completed: s.completed + 1, highest: Math.max(s.highest, ev.stageId + 1) }));
            setBestMap((m) => {
              const k = String(ev.stageId);
              const n = { ...m, [k]: Math.min(m[k] ?? Infinity, t) };
              try {
                localStorage.setItem("skyparkour.best", JSON.stringify(n));
              } catch {}
              return n;
            });
            const st = e.stage;
            post("/api/progress", { type: "stage", stageId: ev.stageId, completed: true, timeMs: t, falls: ev.data?.falls, bot: ev.data?.bot, seed: st.seed, fingerprint: st.fingerprint, name: st.name, validated: st.validation.ok, issues: st.validation.issues, platformCount: st.platforms.length }).catch(() => {});
            setTimeout(saveProgress, 100);
          } else if (ev.type === "fall" || ev.type === "stuck") {
            setStats((s) => ({ ...s, falls: s.falls + 1 }));
          } else if (ev.type === "checkpoint" || ev.type === "stageStart") {
            setTimeout(saveProgress, 100);
          } else if (ev.type === "quality") {
            setPref("quality", ev.data?.q as Quality);
          }
          reactTo(ev);
        },
        onLog: (level, source, message, detail) => logRemote(level, source, message, detail),
      });
      engineRef.current = engine;
      engine.camDist = p.camDist;
      engine.setQuality(p.quality);
      engine.start(startStage, startCp);
      engine.setBot(p.bot);
      setReady(true);
      if (p.music) {
        // browsers start audio only after a user gesture; this arms it for the very first interaction
        const arm = () => {
          gameAudio.init();
          window.removeEventListener("pointerdown", arm);
          window.removeEventListener("keydown", arm);
        };
        window.addEventListener("pointerdown", arm);
        window.addEventListener("keydown", arm);
      }
      playTimer = setInterval(() => setStats((s) => ({ ...s, playMs: s.playMs + 1000 })), 1000);
      saveTimer = setInterval(saveProgress, 20000);
    })();

    const onErr = (e: ErrorEvent) => logRemote("error", "window", e.message, e.error?.stack);
    const onRej = (e: PromiseRejectionEvent) => logRemote("error", "promise", String(e.reason?.message ?? e.reason), e.reason?.stack);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.code === "KeyH") setHideUi((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    const onUnload = () => saveProgress();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      disposed = true;
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
      if (playTimer) clearInterval(playTimer);
      if (saveTimer) clearInterval(saveTimer);
      engine?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------ independent toggles */
  useEffect(() => {
    engineRef.current?.setBot(prefs.bot);
  }, [prefs.bot, ready]);
  useEffect(() => {
    voice.enabled = prefs.voice;
    if (!prefs.voice) voice.stop();
  }, [prefs.voice]);
  useEffect(() => {
    gameAudio.volumes = { master: prefs.master, music: prefs.musicVol, sfx: 0.7, voice: prefs.voiceVol };
    gameAudio.applyVolumes();
  }, [prefs.master, prefs.musicVol, prefs.voiceVol]);
  useEffect(() => {
    gameAudio.musicOn = prefs.music;
    if (gameAudio.ctx) gameAudio.setMusic(prefs.music);
  }, [prefs.music]);
  useEffect(() => {
    if (!prefs.joystick) engineRef.current?.setJoystick(0, 0);
  }, [prefs.joystick]);
  useEffect(() => {
    const e = engineRef.current;
    if (e) e.camDist = prefs.camDist;
  }, [prefs.camDist, ready]);
  useEffect(() => {
    const e = engineRef.current;
    if (e && e.quality !== prefs.quality) e.setQuality(prefs.quality);
  }, [prefs.quality]);

  /* ---------------------------------------------------- YouTube status */
  const refreshYt = useCallback(async () => {
    try {
      const s = (await (await fetch("/api/youtube/status")).json()) as { configured: boolean; authorized: boolean; channel: string | null; liveChatConnected: boolean; title: string | null; lastError: string | null };
      setYt((prev) => {
        let code = prev.code;
        let label = prev.label;
        if (!s.configured) {
          code = "not-configured";
          label = "NOT CONFIGURED";
        } else if (!s.authorized) {
          code = "unauthorized";
          label = "AUTHORIZATION NEEDED";
        } else if (!["connected", "no-broadcast", "ended", "quota", "error", "reconnecting"].includes(code)) {
          code = s.liveChatConnected ? "connected" : "no-broadcast";
          label = s.liveChatConnected ? "CONNECTED" : "WAITING FOR LIVESTREAM";
        }
        return { ...prev, code, label, configured: s.configured, authorized: s.authorized, channel: s.channel, title: s.title, detail: s.lastError ?? prev.detail };
      });
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const y = sp.get("yt");
    if (y) {
      setNotice(y === "authorized" ? "YouTube authorized. Searching for your active livestream…" : `YouTube authorization failed: ${sp.get("msg") ?? "unknown error"}`);
      history.replaceState(null, "", location.pathname);
    }
    void refreshYt();
    const iv = setInterval(refreshYt, 30000);
    return () => clearInterval(iv);
  }, [refreshYt]);

  /* ------------------------------------------------- live chat polling */
  useEffect(() => {
    if (!prefs.liveChat) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = 5000;
    const loop = async () => {
      if (cancelled) return;
      let next = 8000;
      try {
        const cur = ytRef.current;
        if (!cur.configured || !cur.authorized) {
          next = 15000;
        } else {
          const r = (await (await fetch("/api/youtube/poll", { cache: "no-store" })).json()) as { status: string; messages: { id: string; author: string; channelId: string; text: string; verdict: string }[]; intervalMs: number; detail?: string; filtered?: number };
          backoff = 5000;
          const labels: Record<string, string> = {
            connected: "CONNECTED",
            unauthorized: "AUTHORIZATION NEEDED",
            "no-broadcast": "WAITING FOR LIVESTREAM",
            ended: "STREAM ENDED, WAITING",
            quota: "API QUOTA EXCEEDED",
            error: "ERROR, RETRYING",
            "not-configured": "NOT CONFIGURED",
          };
          setYt((p) => ({ ...p, code: r.status, label: labels[r.status] ?? r.status.toUpperCase(), detail: r.detail }));
          next = Math.max(2000, r.intervalMs || 5000);
          if (r.status === "connected") void refreshYt();
          if (r.messages?.length) {
            const entries: ChatEntry[] = r.messages.map((m) => ({ id: m.id, author: m.author, text: m.text, source: "youtube", state: "queued", ts: Date.now(), verdict: m.verdict, channelId: m.channelId }));
            chatRef.current = [...chatRef.current, ...entries].slice(-60);
            setChat(chatRef.current);
          }
        }
      } catch (e) {
        setYt((p) => ({ ...p, code: "reconnecting", label: "RECONNECTING…", detail: (e as Error).message }));
        backoff = Math.min(60000, backoff * 2);
        next = backoff;
      }
      if (!cancelled) timer = setTimeout(loop, next);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prefs.liveChat, refreshYt]);

  /* ---------------------------------------- chat → AI → voice pipeline */
  const updateEntry = useCallback((id: string, patch: Partial<ChatEntry>) => {
    chatRef.current = chatRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c));
    setChat(chatRef.current);
  }, []);

  const replying = useRef(false);
  useEffect(() => {
    const iv = setInterval(async () => {
      if (replying.current || !prefsRef.current.talk) return;
      const now = Date.now();
      // YouTube messages require LIVE CHAT ON; local test messages do not
      const queued = chatRef.current.filter((c) => c.state === "queued" && (c.source === "local" || prefsRef.current.liveChat));
      for (const c of queued) if (now - c.ts > 120000) updateEntry(c.id, { state: "skipped" });
      const next = queued.find((c) => now - c.ts <= 120000 && (c.source === "local" || now - lastReplyAt.current > 6500) && now - (authorLast.current.get(c.channelId || c.author) ?? 0) > (c.source === "local" ? 0 : 20000));
      if (!next) return;
      replying.current = true;
      try {
        const h = hudRef.current;
        const isNew = !seenAuthors.current.has(next.author);
        seenAuthors.current.add(next.author);
        const res = await post("/api/chat/reply", {
          author: next.author,
          message: next.text,
          channelId: next.channelId,
          messageId: next.source === "youtube" ? next.id : undefined,
          source: next.source,
          context: { stage: h?.stageId, botOn: prefsRef.current.bot, falls: h?.falls, progress: h ? Math.round(h.progress * 100) : 0, lastEvent: isNew ? "new_viewer" : lastEventName.current },
        });
        const j = (await res.json()) as { reply: string | null; engine?: string; verdict?: string };
        if (!j.reply) updateEntry(next.id, { state: "skipped", verdict: j.verdict });
        else {
          updateEntry(next.id, { state: "replied", reply: j.reply, engine: j.engine, verdict: j.verdict });
          lastReplyAt.current = Date.now();
          authorLast.current.set(next.channelId || next.author, Date.now());
          engineRef.current?.setExpression("excited", 2);
          say(j.reply, 3);
        }
      } catch (e) {
        updateEntry(next.id, { state: "skipped" });
        logRemote("warn", "chat", "reply failed: " + (e as Error).message);
      } finally {
        replying.current = false;
      }
    }, 900);
    return () => clearInterval(iv);
  }, [say, updateEntry, logRemote]);

  // spontaneous commentary when it has been quiet for a while
  useEffect(() => {
    const iv = setInterval(async () => {
      if (!prefsRef.current.talk || voice.speaking || speechQ.current.length) return;
      if (Date.now() - lastSpeechEnd.current < 80000 + Math.random() * 60000) return;
      lastSpeechEnd.current = Date.now();
      try {
        const h = hudRef.current;
        const r = await post("/api/chat/reply", { source: "ambient", context: { stage: h?.stageId, botOn: prefsRef.current.bot, falls: h?.falls, progress: h ? Math.round(h.progress * 100) : 0 } });
        const j = (await r.json()) as { reply?: string };
        if (j.reply) say(j.reply, 0);
      } catch {}
    }, 10000);
    return () => clearInterval(iv);
  }, [say]);

  const sendLocal = () => {
    const text = localMsg.trim();
    if (!text) return;
    gameAudio.init();
    const entry: ChatEntry = { id: `local-${Date.now()}`, author: localName.trim() || "Viewer", text, source: "local", state: "queued", ts: Date.now() };
    chatRef.current = [...chatRef.current, entry].slice(-60);
    setChat(chatRef.current);
    setLocalMsg("");
  };

  /* -------------------------------------------------------------- render */
  const cap = caps;
  const ytColor = yt.code === "connected" ? "bg-emerald-400" : yt.code === "quota" || yt.code === "error" || yt.code === "reconnecting" ? "bg-red-500" : "bg-amber-400";
  const botLabel = prefs.bot ? (hud?.botStatus ?? "running").toUpperCase() : "OFF (MANUAL)";
  const voiceLabel = !prefs.voice ? "OFF (subtitles)" : cap ? (cap.tts ? "ON · server TTS" : "ON · browser voice") : "ON";
  const best = hud ? bestMap[String(hud.stageId)] : undefined;
  const goStage = (id: number) => {
    if (!Number.isFinite(id) || id < 1) return;
    engineRef.current?.loadStage(Math.floor(id), 0);
    setTimeout(saveProgress, 200);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-300 text-white select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {!hideUi && (
        <>
          {/* top-left: stage HUD */}
          <div className="pointer-events-none absolute left-3 top-3 w-[300px] space-y-2">
            <div className="rounded-2xl bg-slate-950/70 p-3 shadow-xl backdrop-blur">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-300">Stage</div>
                <div className="text-[11px] text-slate-400">difficulty {hud ? Math.round(hud.difficulty * 100) : 0}%</div>
              </div>
              <div className="text-3xl font-extrabold leading-none">{hud?.stageId ?? "…"}</div>
              <div className="truncate text-xs text-slate-300">{hud?.name}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-yellow-300 to-emerald-400 transition-all" style={{ width: `${Math.round((hud?.progress ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                <div><div className="text-slate-400">Checkpoint</div><div className="font-bold">{hud ? `${hud.cp}/${hud.cpTotal}` : "-"}</div></div>
                <div><div className="text-slate-400">Falls</div><div className="font-bold">{hud?.falls ?? 0}</div></div>
                <div><div className="text-slate-400">Time</div><div className="font-bold">{fmtTime(hud?.timeSec ?? 0)}</div></div>
                <div><div className="text-slate-400">Best</div><div className="font-bold">{best ? fmtTime(best / 1000) : "-"}</div></div>
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>Completed: {stats.completed}</span>
                <span>Total falls: {stats.falls}</span>
                <span>Play: {fmtTime(stats.playMs / 1000)}</span>
              </div>
              {hud && !hud.validated && <div className="mt-1 text-[10px] text-amber-300">Stage failed validation (see logs)</div>}
              {hud?.finished && <div className="mt-1 text-center text-sm font-bold text-yellow-300">STAGE COMPLETE! Next stage loading…</div>}
            </div>
          </div>

          {/* top-right: status chips */}
          <div className="pointer-events-none absolute right-3 top-3 flex max-w-[340px] flex-col items-end gap-1.5" style={{ right: panel ? 372 : 12 }}>
            <Chip label="AI BOT" value={botLabel} color={prefs.bot ? "bg-emerald-400" : "bg-slate-500"} />
            <Chip label="LIVE CHAT" value={prefs.liveChat ? yt.label : "OFF"} color={prefs.liveChat ? ytColor : "bg-slate-500"} />
            <Chip label="AI TALK" value={prefs.talk ? (cap?.llm ? `ON · LLM ${cap.model}` : "ON · rule-based fallback") : "OFF"} color={prefs.talk ? (cap?.llm ? "bg-emerald-400" : "bg-amber-400") : "bg-slate-500"} />
            <Chip label="VOICE" value={voiceLabel} color={prefs.voice ? "bg-emerald-400" : "bg-slate-500"} />
            <Chip label="MUSIC" value={prefs.music ? "ON" : "OFF"} color={prefs.music ? "bg-emerald-400" : "bg-slate-500"} />
            <Chip label="JOYSTICK" value={prefs.joystick ? "ON" : "OFF"} color={prefs.joystick ? "bg-emerald-400" : "bg-slate-500"} />
          </div>

          {/* bottom toggle bar */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-wrap items-end justify-center gap-2" style={{ marginLeft: panel ? -180 : 0 }}>
            <Toggle label="AI BOT" on={prefs.bot} onClick={() => setPref("bot", !prefs.bot)} sub={prefs.bot ? hud?.botStatus : undefined} />
            <Toggle label="AI TALK" on={prefs.talk} onClick={() => setPref("talk", !prefs.talk)} />
            <Toggle label="LIVE CHAT" on={prefs.liveChat} onClick={() => setPref("liveChat", !prefs.liveChat)} sub={prefs.liveChat ? (yt.code === "connected" ? "live" : "idle") : undefined} />
            <Toggle label="AI VOICE" on={prefs.voice} onClick={() => setPref("voice", !prefs.voice)} />
            <Toggle label="MUSIC" on={prefs.music} onClick={() => { gameAudio.init(); setPref("music", !prefs.music); }} />
            <Toggle label="JOYSTICK" on={prefs.joystick} onClick={() => setPref("joystick", !prefs.joystick)} />
          </div>

          {/* subtitle bubble */}
          {caption && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 w-[min(720px,90vw)] -translate-x-1/2 rounded-2xl border border-white/30 bg-slate-950/80 px-5 py-3 text-center shadow-2xl backdrop-blur" style={{ marginLeft: panel ? -180 : 0 }}>
              <div className="text-[11px] font-bold uppercase tracking-widest text-fuchsia-300">{caption.who}</div>
              <div className="text-lg font-semibold leading-snug" lang={detectLang(caption.text)}>{caption.text}</div>
            </div>
          )}

          {/* side panel */}
          <button onClick={() => setPanel((v) => !v)} className="pointer-events-auto absolute right-3 top-3 z-20 rounded-lg bg-slate-950/80 px-3 py-1.5 text-xs font-bold backdrop-blur">
            {panel ? "Hide panel ▶" : "◀ Panel"}
          </button>
          {panel && (
            <div className="pointer-events-auto absolute bottom-3 right-3 top-12 z-10 w-[352px] space-y-3 overflow-y-auto rounded-2xl bg-slate-950/80 p-3 text-xs shadow-2xl backdrop-blur">
              {notice && (
                <div className="rounded-lg bg-sky-900/80 p-2 text-sky-100">
                  {notice} <button className="ml-1 underline" onClick={() => setNotice(null)}>dismiss</button>
                </div>
              )}

              <section className="space-y-1.5">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-300">YouTube Live Chat</h3>
                <div className="rounded-lg bg-white/5 p-2">
                  <div>Status: <b className={yt.code === "connected" ? "text-emerald-300" : "text-amber-300"}>{yt.label}</b></div>
                  {yt.channel && <div>Channel: {yt.channel}</div>}
                  {yt.title && <div className="truncate">Stream: {yt.title}</div>}
                  {yt.detail && <div className="break-words text-[11px] text-red-300">{yt.detail}</div>}
                  {!yt.configured && <div className="mt-1 text-amber-300">Server has no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. See README to configure. No chat messages are received until this is set up.</div>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <a href="/api/youtube/auth" className="rounded-lg bg-red-600 px-2.5 py-1.5 font-bold">{yt.authorized ? "Re-authorize YouTube" : "Authorize YouTube"}</a>
                  {yt.authorized && (
                    <button className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold" onClick={async () => { await post("/api/youtube/disconnect", {}); setYt((p) => ({ ...p, authorized: false, code: "unauthorized", label: "AUTHORIZATION NEEDED", channel: null, title: null })); }}>Disconnect</button>
                  )}
                </div>
                {yt.authorized && (
                  <div className="flex gap-1.5">
                    <input value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="Live video ID/URL (optional)" className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1.5 outline-none" />
                    <button
                      className="rounded-lg bg-emerald-600 px-2.5 py-1.5 font-bold"
                      onClick={async () => {
                        const r = (await (await post("/api/youtube/connect", { videoId })).json()) as { ok: boolean; error?: string };
                        setYt((p) => ({ ...p, code: r.ok ? "connected" : "no-broadcast", label: r.ok ? "CONNECTED" : "WAITING FOR LIVESTREAM", detail: r.error }));
                        void refreshYt();
                      }}
                    >Connect</button>
                  </div>
                )}
                <p className="text-[10px] leading-snug text-slate-400">Polling respects YouTube&apos;s interval (min 5 s). The default 10,000-unit daily quota allows roughly 2,000 polls/day; request more quota for 24-hour streams.</p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-300">Chat &amp; AI replies</h3>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-white/5 p-2">
                  {chat.length === 0 && <div className="text-slate-400">No messages yet. Real YouTube comments appear here when connected. Use the box below to test the AI locally.</div>}
                  {[...chat].reverse().map((c) => (
                    <div key={c.id} className="rounded bg-slate-900/70 p-1.5">
                      <div className="flex justify-between">
                        <b className={c.source === "youtube" ? "text-red-300" : "text-sky-300"}>{c.author}</b>
                        <span className="text-[10px] text-slate-400">{c.source === "youtube" ? "YouTube" : "local test"} · {c.state}{c.verdict && c.verdict !== "ok" ? ` · ${c.verdict}` : ""}</span>
                      </div>
                      <div>{c.text}</div>
                      {c.reply && <div className="mt-0.5 text-emerald-300">↳ {c.reply} <span className="text-[10px] text-slate-400">({c.engine})</span></div>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input value={localName} onChange={(e) => setLocalName(e.target.value)} className="w-20 rounded-lg bg-slate-800 px-2 py-1.5 outline-none" aria-label="name" />
                  <input value={localMsg} onChange={(e) => setLocalMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendLocal()} placeholder="তোমার নাম কী? / Hello!" className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1.5 outline-none" />
                  <button onClick={sendLocal} className="rounded-lg bg-sky-600 px-2.5 py-1.5 font-bold">Ask</button>
                </div>
                <p className="text-[10px] text-slate-400">&quot;Ask&quot; is a LOCAL test input (labelled as such). It is not a YouTube message.</p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-300">Stage</h3>
                <div className="flex items-center gap-1.5">
                  <button className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold" onClick={() => goStage((hud?.stageId ?? 1) - 1)}>◀</button>
                  <input value={stageInput} onChange={(e) => setStageInput(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && goStage(Number(stageInput))} placeholder={`1 – ∞ (now ${hud?.stageId ?? 1})`} className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1.5 outline-none" />
                  <button className="rounded-lg bg-emerald-600 px-2.5 py-1.5 font-bold" onClick={() => goStage(Number(stageInput))}>Go</button>
                  <button className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold" onClick={() => goStage((hud?.stageId ?? 1) + 1)}>▶</button>
                </div>
                <p className="text-[10px] text-slate-400">Stages 1–1000 are unlocked; higher ids keep generating unique validated layouts.</p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-300">Graphics, camera &amp; audio</h3>
                <div className="flex gap-1.5">
                  {(["low", "medium", "high"] as Quality[]).map((q) => (
                    <button key={q} onClick={() => setPref("quality", q)} className={`flex-1 rounded-lg px-2 py-1.5 font-bold capitalize ${prefs.quality === q ? "bg-fuchsia-600" : "bg-slate-700"}`}>{q}</button>
                  ))}
                </div>
                {([
                  ["Camera distance", "camDist", 5, 26, 0.5],
                  ["Master volume", "master", 0, 1, 0.05],
                  ["Music volume", "musicVol", 0, 1, 0.05],
                  ["Voice volume", "voiceVol", 0, 1, 0.05],
                ] as const).map(([label, key, min, max, step]) => (
                  <label key={key} className="block">
                    <span className="text-slate-300">{label}</span>
                    <input type="range" min={min} max={max} step={step} value={prefs[key]} onChange={(e) => setPref(key, Number(e.target.value))} className="w-full" />
                  </label>
                ))}
                <p className="text-[10px] text-slate-400">Controls: WASD/arrows move, Space jumps, drag mouse to orbit, wheel zooms, H hides the UI (for stream capture).</p>
              </section>

              <section className="space-y-1">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-300">Diagnostics</h3>
                <div className="rounded-lg bg-white/5 p-2 text-[11px] text-slate-300">
                  FPS {hud?.fps ?? "-"} · quality {hud?.quality} · speed {hud ? hud.speed.toFixed(1) : "-"}
                  <br />GPU geometries {hud?.geometries ?? "-"} · textures {hud?.textures ?? "-"} · JS heap {hud?.heapMB ? `${hud.heapMB} MB` : "n/a"}
                  <br />LLM: {cap ? (cap.llm ? `OpenAI-compatible (${cap.model})` : "not configured → rule-based replies") : "…"}
                  <br />TTS: {cap ? (cap.tts ? "server TTS, lip-sync from real audio" : "not configured → browser voice, estimated lip-sync") : "…"}
                  <br />Music: procedural, original (see MUSIC_LICENSE.md)
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {prefs.joystick && (
        <>
          <Joystick onMove={(x, y) => engineRef.current?.setJoystick(x, y)} />
          <div className="absolute bottom-6 right-6 z-10 flex flex-col items-center gap-2" style={{ right: panel && !hideUi ? 372 : 24 }}>
            <div className="pointer-events-auto flex gap-1.5">
              {([["◀", -0.25, 0], ["▲", 0, -0.12], ["▼", 0, 0.12], ["▶", 0.25, 0]] as const).map(([l, dy, dp]) => (
                <button key={l} className="h-9 w-9 rounded-full bg-white/25 text-sm font-bold backdrop-blur active:bg-white/50" onClick={() => engineRef.current?.nudgeCamera(dy, dp)}>{l}</button>
              ))}
            </div>
            <button
              className="pointer-events-auto h-24 w-24 touch-none rounded-full border-2 border-white/50 bg-fuchsia-500/60 text-lg font-extrabold shadow-xl backdrop-blur active:scale-95 active:bg-fuchsia-500/90"
              onPointerDown={() => { gameAudio.init(); engineRef.current?.pressJump(); }}
            >JUMP</button>
          </div>
        </>
      )}
      {!hideUi && (prefs.music || prefs.voice) && ready && gameAudio.ctx?.state !== "running" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-amber-400/90 px-4 py-1.5 text-xs font-bold text-slate-900 shadow-lg">
          🔊 Click, tap or press a key once to enable sound (browser autoplay policy)
        </div>
      )}
      {hideUi && <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/40">Press H to show UI</div>}
    </div>
  );
}
