import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type Expression = "happy" | "surprised" | "worried" | "excited" | "sad";
export type Emote = "none" | "victory";

export interface CharacterState {
  speed: number;
  onGround: boolean;
  vy: number;
  stun: boolean;
  landImpact: number;
  mouth: number;
  viseme: number;
  talking: boolean;
  lookAt: THREE.Vector3 | null;
  emote: Emote;
  facing: number;
}

function makeTorsoTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 512);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const letters = "ROBO";
  const baseX = 76;
  const step = 120;
  g.lineJoin = "round";
  letters.split("").forEach((ch, i) => {
    g.save();
    g.translate(baseX + i * step + 30, 256 + (i % 2 ? 6 : -6));
    g.rotate((i % 2 ? 1 : -1) * 0.07);
    g.font = "900 190px Impact, 'Arial Black', Arial, sans-serif";
    g.lineWidth = 26;
    g.strokeStyle = "#e0262a";
    g.strokeText(ch, 0, 0);
    g.lineWidth = 8;
    g.strokeStyle = "#ffffff";
    g.fillStyle = "#ffffff";
    g.fillText(ch, 0, 0);
    g.restore();
  });
  g.font = "bold 34px Arial";
  g.fillStyle = "#ffffff";
  g.fillText("PARKOUR", 256, 400);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeCapTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 256, 256);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 200px Impact, 'Arial Black', Arial, sans-serif";
  g.lineJoin = "round";
  g.lineWidth = 22;
  g.strokeStyle = "#d9302f";
  g.strokeText("R", 128, 138);
  g.fillStyle = "#ffffff";
  g.fillText("R", 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Character {
  root = new THREE.Group();
  private model = new THREE.Group();
  private torso!: THREE.Mesh;
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private eyeL!: THREE.Mesh;
  private eyeR!: THREE.Mesh;
  private browL!: THREE.Mesh;
  private browR!: THREE.Mesh;
  private smile!: THREE.Mesh;
  private mouthOpen = new THREE.Group();
  private tongue!: THREE.Mesh;

  private phase = 0;
  private t = 0;
  private landTimer = 0;
  private landAmt = 0;
  private blinkTimer = 2;
  private blink = 0;
  private expr: Expression = "happy";
  private exprTimer = 0;
  private headYaw = 0;
  private headPitch = 0;
  private mouthSmooth = 0;
  private eyeOff = new THREE.Vector2();
  private lookTmp = new THREE.Vector3();

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.55, metalness: 0.05 });
    const darkEdge = new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45 });
    const black = new THREE.MeshBasicMaterial({ color: 0x0b0b0b });

    const legH = 1.0;
    const torsoH = 1.05;

    // torso
    this.torso = new THREE.Mesh(new RoundedBoxGeometry(1.05, torsoH, 0.58, 4, 0.06), dark);
    this.torso.position.y = legH + torsoH / 2;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.98, 0.98),
      new THREE.MeshStandardMaterial({ map: makeTorsoTexture(), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    logo.position.set(0, 0.04, 0.296);
    this.torso.add(logo);
    this.model.add(this.torso);

    // legs
    const mkLeg = (g: THREE.Group, x: number) => {
      g.position.set(x, legH, 0);
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.5, legH, 0.52, 3, 0.05), darkEdge);
      m.position.y = -legH / 2;
      g.add(m);
      this.model.add(g);
    };
    mkLeg(this.legL, -0.26);
    mkLeg(this.legR, 0.26);

    // arms
    const mkArm = (g: THREE.Group, x: number) => {
      g.position.set(x, legH + torsoH - 0.08, 0);
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.5, torsoH, 0.52, 3, 0.05), darkEdge);
      m.position.y = -torsoH / 2 + 0.08;
      g.add(m);
      this.model.add(g);
    };
    mkArm(this.armL, -0.8);
    mkArm(this.armR, 0.8);

    // head
    this.head.position.set(0, legH + torsoH + 0.02, 0);
    const skull = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.74, 0.74, 5, 0.24), white);
    skull.position.y = 0.37;
    this.head.add(skull);

    const face = new THREE.Group();
    face.position.set(0, 0.37, 0.372);
    const eyeGeo = new THREE.CircleGeometry(0.5, 20);
    this.eyeL = new THREE.Mesh(eyeGeo, black);
    this.eyeR = new THREE.Mesh(eyeGeo, black);
    this.eyeL.scale.set(0.075, 0.125, 1);
    this.eyeR.scale.set(0.075, 0.125, 1);
    this.eyeL.position.set(-0.15, 0.04, 0);
    this.eyeR.position.set(0.15, 0.04, 0);
    face.add(this.eyeL, this.eyeR);

    const browGeo = new THREE.BoxGeometry(0.17, 0.03, 0.01);
    this.browL = new THREE.Mesh(browGeo, black);
    this.browR = new THREE.Mesh(browGeo, black);
    this.browL.position.set(-0.15, 0.2, 0);
    this.browR.position.set(0.15, 0.2, 0);
    face.add(this.browL, this.browR);

    this.smile = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 8, 28, Math.PI), black);
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, -0.02, 0);
    face.add(this.smile);

    const mouthDark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x1c0508 }));
    mouthDark.scale.set(0.3, 0.3, 1);
    this.tongue = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xe0566a }));
    this.tongue.scale.set(0.18, 0.1, 1);
    this.tongue.position.set(0, -0.08, 0.002);
    this.mouthOpen.add(mouthDark, this.tongue);
    this.mouthOpen.position.set(0, -0.14, 0.001);
    this.mouthOpen.visible = false;
    face.add(this.mouthOpen);
    this.head.add(face);

    // cap
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.5, transparent: true, opacity: 0.96 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.46, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    dome.scale.set(0.93, 0.82, 0.93);
    dome.position.set(0, 0.62, -0.01);
    this.head.add(dome);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.04, 8, 36), new THREE.MeshStandardMaterial({ color: 0xd9544d, roughness: 0.5 }));
    band.rotation.x = Math.PI / 2;
    band.scale.set(0.93, 0.93, 1);
    band.position.set(0, 0.63, -0.01);
    this.head.add(band);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.04, 28, 1, false, -Math.PI / 2 + 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.5 }));
    brim.rotation.y = Math.PI / 2;
    brim.scale.set(1.0, 1, 1.15);
    brim.position.set(0, 0.62, 0.2);
    this.head.add(brim);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({ map: makeCapTexture(), transparent: true }));
    patch.position.set(0, 0.8, 0.4);
    patch.rotation.x = -0.35;
    this.head.add(patch);

    this.model.add(this.head);
    this.root.add(this.model);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
      }
    });
  }

  setExpression(e: Expression, seconds = 2.5) {
    this.expr = e;
    this.exprTimer = seconds;
  }

  update(dt: number, s: CharacterState) {
    this.t += dt;
    const t = this.t;
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.expr = "happy";
    }

    // facing: smooth turn
    let dy = s.facing - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * Math.min(1, dt * 14);

    // ---- body animation
    const run = Math.min(1, s.speed / 9);
    let armLx = 0, armRx = 0, legLx = 0, legRx = 0, bob = 0, lean = 0, armZ = 0.06;

    if (s.landImpact > 0) {
      this.landTimer = 0.22;
      this.landAmt = Math.min(1, s.landImpact / 20);
    }
    if (this.landTimer > 0) this.landTimer -= dt;

    if (s.emote === "victory") {
      armLx = -2.9 + Math.sin(t * 12) * 0.35;
      armRx = -2.9 - Math.sin(t * 12) * 0.35;
      armZ = 0.25;
      bob = Math.abs(Math.sin(t * 6)) * 0.18;
    } else if (!s.onGround) {
      if (s.vy > 0) {
        armLx = -2.5;
        armRx = -2.5;
        armZ = 0.35;
        legLx = -0.55;
        legRx = 0.35;
      } else {
        armLx = -1.9 + Math.sin(t * 16) * 0.55;
        armRx = -1.9 - Math.sin(t * 16) * 0.55;
        armZ = 0.5;
        legLx = 0.3 + Math.sin(t * 14) * 0.25;
        legRx = -0.25 - Math.sin(t * 14) * 0.25;
      }
      lean = 0.08;
    } else if (s.speed > 0.6) {
      this.phase += dt * (5 + s.speed * 1.15);
      const sw = Math.sin(this.phase);
      const amp = 0.45 + run * 0.85;
      legLx = sw * amp;
      legRx = -sw * amp;
      armLx = -sw * amp * 0.9;
      armRx = sw * amp * 0.9;
      bob = Math.abs(Math.cos(this.phase)) * 0.09 * (0.4 + run);
      lean = 0.1 + run * 0.18;
    } else {
      armZ = 0.07 + Math.sin(t * 1.7) * 0.02;
      armLx = Math.sin(t * 1.3) * 0.04;
      armRx = -Math.sin(t * 1.3) * 0.04;
      bob = Math.sin(t * 2) * 0.012;
      if (s.talking) {
        armRx = -0.5 + Math.sin(t * 3.1) * 0.45 * (0.3 + s.mouth);
        armLx = -0.15 + Math.sin(t * 2.3 + 1) * 0.25 * (0.3 + s.mouth);
        armZ = 0.18;
      }
    }
    if (s.stun) {
      armLx = -2.2;
      armRx = -2.2;
      armZ = 0.7;
    }
    const k = Math.min(1, dt * 18);
    this.armL.rotation.x += (armLx - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armRx - this.armR.rotation.x) * k;
    this.armL.rotation.z += (armZ - this.armL.rotation.z) * k;
    this.armR.rotation.z += (-armZ - this.armR.rotation.z) * k;
    this.legL.rotation.x += (legLx - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legRx - this.legR.rotation.x) * k;

    const squash = this.landTimer > 0 ? Math.sin((this.landTimer / 0.22) * Math.PI) * 0.12 * this.landAmt : 0;
    this.model.position.y = bob - squash * 0.6;
    this.model.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
    this.model.rotation.x += (lean - this.model.rotation.x) * k;

    // ---- head look
    let wantYaw = 0;
    let wantPitch = 0;
    if (s.lookAt) {
      this.head.getWorldPosition(this.lookTmp);
      const dx = s.lookAt.x - this.lookTmp.x;
      const dz = s.lookAt.z - this.lookTmp.z;
      const dyy = s.lookAt.y - this.lookTmp.y;
      const worldYaw = Math.atan2(dx, dz);
      let rel = worldYaw - this.root.rotation.y;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      wantYaw = THREE.MathUtils.clamp(rel, -0.9, 0.9);
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(dyy, Math.hypot(dx, dz)), -0.35, 0.35);
    }
    const mAmp = this.mouthSmooth;
    if (s.talking) {
      wantYaw += Math.sin(t * 2.1) * 0.12;
      wantPitch += Math.sin(t * 5.3) * 0.06 * (0.3 + mAmp);
    }
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * 6);
    this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 6);
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = this.headPitch;
    this.head.rotation.z = s.talking ? Math.sin(t * 2.7) * 0.05 : 0;

    // ---- eyes: blink + gaze
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.13;
      this.blinkTimer = 1.8 + Math.random() * 3.2;
    }
    let eyeScaleY = 0.125;
    if (this.blink > 0) {
      this.blink -= dt;
      const b = Math.sin((Math.max(0, this.blink) / 0.13) * Math.PI);
      eyeScaleY = 0.125 * (1 - 0.92 * b);
    }
    if (this.expr === "surprised") eyeScaleY *= 1.25;
    if (this.expr === "excited") eyeScaleY *= 1.1;
    const tgtX = Math.sin(t * 0.7) * 0.012 + (wantYaw - this.headYaw) * 0.05;
    const tgtY = Math.sin(t * 0.9 + 2) * 0.008 - (wantPitch - this.headPitch) * 0.05;
    this.eyeOff.x += (tgtX - this.eyeOff.x) * Math.min(1, dt * 10);
    this.eyeOff.y += (tgtY - this.eyeOff.y) * Math.min(1, dt * 10);
    this.eyeL.scale.y = eyeScaleY;
    this.eyeR.scale.y = eyeScaleY;
    this.eyeL.position.set(-0.15 + this.eyeOff.x, 0.04 + this.eyeOff.y, 0);
    this.eyeR.position.set(0.15 + this.eyeOff.x, 0.04 + this.eyeOff.y, 0);

    // ---- eyebrows by expression
    let browY = 0.2, browRot = 0;
    if (this.expr === "surprised") { browY = 0.27; browRot = 0; }
    else if (this.expr === "worried" || this.expr === "sad") { browY = 0.22; browRot = 0.35; }
    else if (this.expr === "excited") { browY = 0.25; browRot = -0.12; }
    this.browL.position.y += (browY - this.browL.position.y) * Math.min(1, dt * 12);
    this.browR.position.y = this.browL.position.y;
    this.browL.rotation.z += (-browRot - this.browL.rotation.z) * Math.min(1, dt * 12);
    this.browR.rotation.z += (browRot - this.browR.rotation.z) * Math.min(1, dt * 12);

    // ---- mouth: audio-driven openness
    const target = s.talking ? s.mouth : 0;
    this.mouthSmooth += (target - this.mouthSmooth) * Math.min(1, dt * 28);
    const o = this.mouthSmooth;
    const frown = this.expr === "sad" || this.expr === "worried";
    if (o > 0.06) {
      this.smile.visible = false;
      this.mouthOpen.visible = true;
      const wide = 0.75 + 0.55 * s.viseme; // 0=round "oo", 1=wide "ee"
      this.mouthOpen.scale.set(wide * (1.1 - 0.35 * o), 0.25 + o * 1.5, 1);
      this.tongue.visible = o > 0.3;
    } else {
      this.smile.visible = true;
      this.mouthOpen.visible = false;
      const bigSmile = this.expr === "excited" || this.expr === "happy" ? 1.0 : 0.8;
      this.smile.rotation.z = frown ? 0 : Math.PI;
      this.smile.position.y = frown ? -0.12 : -0.02;
      this.smile.scale.set(bigSmile * (this.expr === "excited" ? 1.25 : 1), frown ? 0.6 : 1, 1);
    }
  }
}
