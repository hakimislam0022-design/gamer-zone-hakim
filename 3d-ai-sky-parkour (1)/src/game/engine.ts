import * as THREE from "three";
import { generateStage } from "@/lib/stage/generator";
import { Stage } from "@/lib/stage/types";
import { World, newBody, Body, StepInput } from "./physics";
import { Character, Expression } from "./character";
import { Scenery, SUN_DIR, HORIZON } from "./scenery";
import { StageView } from "./stageView";
import { Bot } from "./bot";
import { gameAudio } from "./audio";
import { voice } from "./voice";

export type Quality = "low" | "medium" | "high";

export interface HudInfo {
  stageId: number;
  name: string;
  difficulty: number;
  validated: boolean;
  cp: number;
  cpTotal: number;
  progress: number;
  falls: number;
  timeSec: number;
  botStatus: string;
  speed: number;
  fps: number;
  finished: boolean;
  quality: Quality;
  heapMB: number;
  geometries: number;
  textures: number;
}

export type EngineEventType = "stageStart" | "jump" | "land" | "fall" | "checkpoint" | "complete" | "hit" | "assist" | "stuck" | "quality" | "error";
export interface EngineEvent {
  type: EngineEventType;
  stageId: number;
  data?: Record<string, number | string | boolean>;
}

export interface EngineOptions {
  onHud: (h: HudInfo) => void;
  onEvent: (e: EngineEvent) => void;
  onLog: (level: "info" | "warn" | "error", source: string, message: string, detail?: string) => void;
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class GameEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 9000);
  private sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a78b5, 1.5);
  private scenery: Scenery;
  character = new Character();
  bot = new Bot();
  stage!: Stage;
  world!: World;
  private view: StageView | null = null;
  body: Body = newBody();

  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private jumpQueued = false;
  camYaw = 0;
  camPitch = 0.42;
  camDist = 11;
  private lastManualCam = -100;
  private camPos = new THREE.Vector3();
  private camInit = false;
  private tmpV = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  private t = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private cpIndex = 0;
  private cpByPlatform = new Map<number, number>();
  private falls = 0;
  private finished = false;
  private nextTimer = 0;
  private landImpact = 0;
  private stepTimer = 0;
  private hudTimer = 0;
  private fpsEma = 60;
  private lowFpsTime = 0;
  private emote: "none" | "victory" = "none";
  private contextLost = false;
  private errorTimes: number[] = [];
  private idleTime = 0;
  private cleanup: (() => void)[] = [];
  quality: Quality = "high";
  autoNext = true;
  talkingLook = false;

  // particles
  private pPos = new Float32Array(300 * 3);
  private pVel = new Float32Array(300 * 3);
  private pLife = new Float32Array(300);
  private pCol = new Float32Array(300 * 3);
  private pGeo = new THREE.BufferGeometry();
  private pPoints: THREE.Points;
  private pNext = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: EngineOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = HORIZON;
    this.scene.fog = new THREE.Fog(HORIZON, 500, 3600);

    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.sun.shadow.camera.left = -50;
    this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50;
    this.sun.shadow.camera.bottom = -50;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.scenery = new Scenery();
    this.scene.add(this.scenery.group);
    this.scene.add(this.character.root);

    this.pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    this.pPoints = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, depthWrite: false }));
    this.pPoints.frustumCulled = false;
    this.scene.add(this.pPoints);
    for (let i = 0; i < 300; i++) this.pPos[i * 3 + 1] = -9999;

    this.setQuality("high");
    this.bindInput();
    this.world = undefined as unknown as World;
  }

  /* --------------------------------------------------------------- setup */
  setQuality(q: Quality) {
    this.quality = q;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(q === "low" ? 0.75 : q === "medium" ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
    const shadows = q !== "low";
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = q === "high" ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scenery.setCloudCount(q === "high" ? 70 : q === "medium" ? 40 : 18);
    this.scenery.buildDecor(q === "high" ? 1 : q === "medium" ? 0.6 : 0.25);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private bindInput() {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const kd = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      gameAudio.init();
      const k = e.code;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === "Space" && !e.repeat) this.jumpQueued = true;
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);

    let dragging = false;
    let lx = 0;
    let ly = 0;
    const pd = (e: PointerEvent) => {
      gameAudio.init();
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      this.canvas.setPointerCapture?.(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.camYaw += dx * 0.0055;
      this.camPitch = Math.max(-0.1, Math.min(1.3, this.camPitch + dy * 0.004));
      this.lastManualCam = this.clock;
    };
    const pu = () => {
      dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      this.camDist = Math.max(5, Math.min(26, this.camDist + Math.sign(e.deltaY) * 1.2));
      this.lastManualCam = this.clock;
    };
    const lost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      this.opts.onLog("error", "webgl", "WebGL context lost");
    };
    const restored = () => {
      this.contextLost = false;
      this.opts.onLog("warn", "webgl", "WebGL context restored; rebuilding stage");
      this.setQuality(this.quality);
      this.loadStage(this.stage.id, this.cpIndex);
    };
    this.canvas.addEventListener("pointerdown", pd);
    this.canvas.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    this.canvas.addEventListener("wheel", wheel, { passive: true });
    this.canvas.addEventListener("webglcontextlost", lost);
    this.canvas.addEventListener("webglcontextrestored", restored);
    const ro = new ResizeObserver(() => this.resize());
    if (this.canvas.parentElement) ro.observe(this.canvas.parentElement);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      this.canvas.removeEventListener("pointerdown", pd);
      this.canvas.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
      this.canvas.removeEventListener("wheel", wheel);
      this.canvas.removeEventListener("webglcontextlost", lost);
      this.canvas.removeEventListener("webglcontextrestored", restored);
      ro.disconnect();
    });
  }

  /* ------------------------------------------------------------ public API */
  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }
  pressJump() {
    this.jumpQueued = true;
  }
  nudgeCamera(dyaw: number, dpitch: number) {
    this.camYaw += dyaw;
    this.camPitch = Math.max(-0.1, Math.min(1.3, this.camPitch + dpitch));
    this.lastManualCam = this.clock;
  }

  /** AI BOT ON/OFF. Turning it off cancels every pending bot decision before the human gets control back. */
  setBot(on: boolean) {
    if (on === this.bot.active) return;
    this.bot.setActive(on);
    this.jumpQueued = false;
    this.body.jumpBuf = 0;
    if (on) this.bot.wp = this.stage.checkpoints[this.cpIndex]?.wp ?? 0;
  }

  setExpression(e: Expression, sec = 2.5) {
    this.character.setExpression(e, sec);
  }

  get stageId() {
    return this.stage?.id ?? 1;
  }

  start(stageId: number, cp = 0) {
    this.loadStage(stageId, cp);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.view?.dispose();
    this.renderer.dispose();
  }

  loadStage(id: number, cp = 0) {
    const stage = generateStage(id);
    if (!stage.validation.ok) this.opts.onLog("warn", "stage", `Stage ${id} failed validation`, stage.validation.issues.join("; "));
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.stage = stage;
    this.world = new World(stage);
    this.world.onEvent = (e, data) => this.onPhys(e, data);
    this.view = new StageView(stage);
    this.scene.add(this.view.group);
    this.cpByPlatform.clear();
    stage.checkpoints.forEach((c, i) => this.cpByPlatform.set(c.platform, i));
    this.t = 0;
    this.falls = 0;
    this.finished = false;
    this.emote = "none";
    this.nextTimer = 0;
    this.cpIndex = Math.min(cp, stage.checkpoints.length - 1);
    this.bot.resetForStage();
    this.bot.wp = stage.checkpoints[this.cpIndex].wp;
    this.placeAtCheckpoint();
    this.view.setActiveCheckpoint(this.cpIndex);
    const first = stage.waypoints[Math.min(stage.checkpoints[this.cpIndex].wp + 1, stage.waypoints.length - 1)];
    this.camYaw = Math.atan2(first.x - this.body.x, -(first.z - this.body.z));
    this.camInit = false;
    this.opts.onEvent({ type: "stageStart", stageId: id, data: { cp: this.cpIndex } });
    const info = this.renderer.info.memory;
    if (info.geometries > 4000 || info.textures > 1500) this.opts.onLog("warn", "memory", `High GPU resource count geometries=${info.geometries} textures=${info.textures}`);
  }

  private placeAtCheckpoint() {
    const c = this.stage.checkpoints[this.cpIndex];
    const b = this.body;
    b.x = c.x;
    b.y = c.y + 0.05;
    b.z = c.z;
    b.vx = b.vy = b.vz = 0;
    b.onGround = false;
    b.ground = null;
    b.stun = 0;
    b.hitCd = 0;
    b.jumpBuf = 0;
    const next = this.stage.waypoints[Math.min(c.wp + 1, this.stage.waypoints.length - 1)];
    b.facing = Math.atan2(next.x - c.x, next.z - c.z);
    this.character.root.rotation.y = b.facing;
    this.world.update(this.t);
  }

  /* ------------------------------------------------------------ events */
  private emit(type: EngineEventType, data?: Record<string, number | string | boolean>) {
    this.opts.onEvent({ type, stageId: this.stage.id, data });
  }

  private onPhys(e: "jump" | "land" | "hit" | "step", data?: number) {
    const b = this.body;
    if (e === "jump") {
      gameAudio.play("jump");
      this.burst(b.x, b.y + 0.1, b.z, 0xffffff, 6, 2);
      if (this.bot.active || true) this.emit("jump");
    } else if (e === "land") {
      gameAudio.play("land", data ?? 5);
      this.landImpact = data ?? 5;
      this.burst(b.x, b.y + 0.1, b.z, 0xdddddd, Math.min(14, 4 + Math.floor((data ?? 5) / 2)), 3);
      this.emit("land", { impact: Math.round(data ?? 0) });
    } else if (e === "hit") {
      gameAudio.play("hit");
      this.character.setExpression("surprised", 1.5);
      this.burst(b.x, b.y + 1.2, b.z, 0xff3030, 14, 5);
      this.emit("hit");
    }
  }

  private burst(x: number, y: number, z: number, color: number, n: number, speed: number) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext++ % 300;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      this.pVel[i * 3] = Math.cos(a) * s;
      this.pVel[i * 3 + 1] = Math.random() * s * 1.3;
      this.pVel[i * 3 + 2] = Math.sin(a) * s;
      this.pLife[i] = 0.6 + Math.random() * 0.6;
      this.pCol[i * 3] = c.r;
      this.pCol[i * 3 + 1] = c.g;
      this.pCol[i * 3 + 2] = c.b;
    }
  }

  private updateParticles(dt: number) {
    for (let i = 0; i < 300; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -9999;
        continue;
      }
      this.pVel[i * 3 + 1] -= 12 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    (this.pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /* ------------------------------------------------------------ gameplay */
  private humanInput(): StepInput {
    const k = this.keys;
    let ix = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let iz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    ix += this.joy.x;
    iz += this.joy.y;
    const l = Math.hypot(ix, iz);
    if (l > 1) {
      ix /= l;
      iz /= l;
    }
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    // forward = (sin, -cos), right = (cos, sin)
    const mx = sy * iz + cy * ix;
    const mz = -cy * iz + sy * ix;
    const jump = this.jumpQueued || k.has("Space");
    return { mx, mz, jump, speedScale: 1 };
  }

  private respawn(reason: "fall" | "stuck") {
    this.falls++;
    this.opts.onLog("info", "game", `${reason} on stage ${this.stage.id} (checkpoint ${this.cpIndex})`);
    gameAudio.play(reason === "fall" ? "fall" : "respawn");
    this.character.setExpression("surprised", 1.8);
    this.emit(reason === "fall" ? "fall" : "stuck", { falls: this.falls, cp: this.cpIndex });
    this.placeAtCheckpoint();
    const c = this.stage.checkpoints[this.cpIndex];
    this.bot.onRespawn(this.cpIndex, c.wp, reason);
    if (this.bot.active && this.bot.assistRequested) {
      this.bot.assistRequested = false;
      if (this.cpIndex < this.stage.checkpoints.length - 1) {
        this.cpIndex++;
        this.placeAtCheckpoint();
        this.bot.wp = this.stage.checkpoints[this.cpIndex].wp;
        this.view?.setActiveCheckpoint(this.cpIndex);
        this.emit("assist", { cp: this.cpIndex });
        this.opts.onLog("warn", "bot", `Bot assist: skipped to checkpoint ${this.cpIndex} on stage ${this.stage.id} after repeated failures`);
      }
    }
    this.camInit = false;
    gameAudio.play("respawn");
  }

  private complete() {
    this.finished = true;
    this.emote = "victory";
    this.nextTimer = 5.5;
    gameAudio.play("finish");
    this.character.setExpression("excited", 5);
    const p = this.view!.finishPos;
    for (let i = 0; i < 6; i++) this.burst(p.x, p.y + 2 + i * 0.4, p.z, [0xff2bd6, 0xffe600, 0x22e83a, 0x00e5ff, 0xff8c00, 0xffffff][i], 40, 9);
    this.emit("complete", { timeMs: Math.round(this.t * 1000), falls: this.falls, bot: this.bot.active });
  }

  private tick(dt: number) {
    this.clock += dt;
    this.t += dt;
    const w = this.world;
    const b = this.body;
    w.update(this.t);
    w.carry(b);

    let inp: StepInput = { mx: 0, mz: 0, jump: false, speedScale: 1 };
    if (!this.finished) {
      // exactly one controller at a time: the bot while active, otherwise the human
      inp = this.bot.active ? this.bot.think(w, b, this.t, dt) : this.humanInput();
      if (this.bot.active && this.bot.wantRespawn) {
        this.respawn("stuck");
        return;
      }
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    for (let i = 0; i < steps; i++) w.step(b, { ...inp, jump: inp.jump && i === 0 }, dt / steps);
    this.jumpQueued = false;

    const speed = Math.hypot(b.vx, b.vz);
    if (speed > 0.8 && b.stun <= 0) b.facing = Math.atan2(b.vx, b.vz);
    if (speed < 0.5 && b.onGround) this.idleTime += dt;
    else this.idleTime = 0;

    // checkpoints / finish / falling
    if (b.onGround && b.ground) {
      const idx = this.cpByPlatform.get(b.ground.id);
      if (idx !== undefined) {
        if (b.ground.p.role === "finish") {
          if (!this.finished) this.complete();
        } else if (idx > this.cpIndex) {
          this.cpIndex = idx;
          this.view?.setActiveCheckpoint(idx);
          gameAudio.play("checkpoint");
          const c = this.stage.checkpoints[idx];
          this.burst(c.x, c.y + 1, c.z, 0x22e83a, 30, 6);
          this.emit("checkpoint", { cp: idx });
        }
      }
      if (speed > 3 && !this.finished) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          gameAudio.play("step");
          this.stepTimer = 0.3 * (9 / Math.max(speed, 3)) * 0.8;
        }
      }
    }
    if (b.y < this.stage.killY) this.respawn("fall");

    if (this.finished) {
      this.nextTimer -= dt;
      if (this.nextTimer <= 0 && this.autoNext) this.loadStage(this.stage.id + 1, 0);
    }
  }

  private updateCamera(dt: number) {
    const b = this.body;
    const manualIdle = this.clock - this.lastManualCam > 2.2;
    if (manualIdle && !this.finished) {
      let want: number | null = null;
      if (this.bot.active) {
        const wp = this.stage.waypoints[Math.min(this.bot.wp, this.stage.waypoints.length - 1)];
        const dx = wp.x - b.x;
        const dz = wp.z - b.z;
        if (Math.hypot(dx, dz) > 2) want = Math.atan2(dx, -dz);
      } else if (Math.hypot(b.vx, b.vz) > 2.5) want = Math.atan2(b.vx, -b.vz);
      if (want !== null) this.camYaw += angDiff(want, this.camYaw) * Math.min(1, dt * 1.3);
      // look a bit more downward when the next jump is a drop / flatter when climbing
      this.camPitch += (0.42 - this.camPitch) * Math.min(1, dt * 0.4);
    }
    const tx = b.x;
    const ty = b.y + 1.7;
    const tz = b.z;
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const fx = Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const desired = this.tmpV.set(tx - fx * cp * this.camDist, ty + sp * this.camDist, tz - fz * cp * this.camDist);
    // clearance: never let the camera sit inside a platform
    for (const c of this.world.cols) {
      if (this.world.inside(c, desired.x, desired.z, 0.7) && desired.y < c.top + 0.9 && desired.y > c.bottom - 0.9) desired.y = c.top + 0.9;
    }
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camInit = true;
    } else this.camPos.lerp(desired, 1 - Math.exp(-dt * 8));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.tmpT.set(tx + fx * 2.5, ty - 0.3, tz + fz * 2.5));
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;
    this.fpsEma += (1 / dt - this.fpsEma) * 0.05;
    try {
      this.tick(dt);
      this.visuals(dt);
      if (!this.contextLost) this.renderer.render(this.scene, this.camera);
    } catch (e) {
      const nowMs = Date.now();
      this.errorTimes = this.errorTimes.filter((x) => nowMs - x < 10000);
      this.errorTimes.push(nowMs);
      this.opts.onLog("error", "engine", (e as Error).message ?? String(e), (e as Error).stack);
      if (this.errorTimes.length >= 5) {
        this.errorTimes = [];
        this.opts.onLog("warn", "engine", "Repeated errors: rebuilding current stage");
        try {
          this.loadStage(this.stage.id, 0);
        } catch (e2) {
          this.opts.onLog("error", "engine", "Stage rebuild failed: " + (e2 as Error).message);
        }
      }
    }
    // performance guard: drop quality if consistently slow
    if (this.fpsEma < 22) this.lowFpsTime += dt;
    else this.lowFpsTime = Math.max(0, this.lowFpsTime - dt);
    if (this.lowFpsTime > 15 && this.quality !== "low") {
      this.lowFpsTime = 0;
      const nq: Quality = this.quality === "high" ? "medium" : "low";
      this.opts.onLog("warn", "perf", `Average FPS ${this.fpsEma.toFixed(0)}: lowering graphics to ${nq}`);
      this.setQuality(nq);
      this.emit("quality", { q: nq });
    }
  };

  private visuals(dt: number) {
    const b = this.body;
    this.view?.update(this.t);
    voice.update(dt);
    const speed = Math.hypot(b.vx, b.vz);
    const talking = voice.speaking && voice.audible;
    const lookAt = talking || this.idleTime > 1.5 || this.finished ? this.camera.position : null;
    this.character.root.position.set(b.x, b.y, b.z);
    this.character.update(dt, {
      speed,
      onGround: b.onGround,
      vy: b.vy,
      stun: b.stun > 0,
      landImpact: this.landImpact,
      mouth: voice.mouth,
      viseme: voice.viseme,
      talking,
      lookAt,
      emote: this.emote,
      facing: b.facing,
    });
    this.landImpact = 0;
    this.updateCamera(dt);
    this.scenery.update(dt, this.clock, this.camera.position);
    this.updateParticles(dt);
    // sun follows the player so shadows stay sharp
    this.sun.position.set(b.x + SUN_DIR.x * 120, b.y + SUN_DIR.y * 120, b.z + SUN_DIR.z * 120);
    this.sun.target.position.set(b.x, b.y, b.z);
    this.sun.target.updateMatrixWorld();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      const wps = this.stage.waypoints;
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      this.opts.onHud({
        stageId: this.stage.id,
        name: this.stage.name,
        difficulty: this.stage.difficulty,
        validated: this.stage.validation.ok,
        cp: this.cpIndex,
        cpTotal: this.stage.checkpoints.length - 1,
        progress: this.finished ? 1 : Math.max(0, Math.min(1, Math.max(this.bot.active ? this.bot.wp : 0, this.progressWp()) / Math.max(1, wps.length - 1))),
        falls: this.falls,
        timeSec: this.t,
        botStatus: this.bot.active ? this.bot.status : "off",
        speed,
        fps: Math.round(this.fpsEma),
        finished: this.finished,
        quality: this.quality,
        heapMB: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : 0,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      });
    }
  }

  private maxWpSeen = 0;
  private progressWp() {
    // human progress: index of the closest waypoint (monotonic per stage load)
    const b = this.body;
    const wps = this.stage.waypoints;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < wps.length; i++) {
      const d = (wps[i].x - b.x) ** 2 + (wps[i].z - b.z) ** 2 + (wps[i].y - b.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (this.t < 0.5) this.maxWpSeen = 0;
    this.maxWpSeen = Math.max(this.maxWpSeen, best);
    return this.maxWpSeen;
  }

  getCheckpointIndex() {
    return this.cpIndex;
  }
  getFalls() {
    return this.falls;
  }
}
