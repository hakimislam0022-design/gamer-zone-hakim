import * as THREE from "three";
import { makeRng, Rng } from "@/lib/rng";

export const SUN_DIR = new THREE.Vector3(0.45, 0.62, -0.5).normalize();
export const HORIZON = new THREE.Color(0xb7dcf7);
export const SKY_TOP = new THREE.Color(0x1466d8);
export const OCEAN_Y = -70;

const skyVert = `
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const skyFrag = `
uniform vec3 uHorizon; uniform vec3 uTop; uniform vec3 uSun;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
  col = mix(col, uHorizon, smoothstep(0.0, -0.25, d.y));
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0,0.92,0.72) * (pow(sd, 900.0) * 4.0 + pow(sd, 14.0) * 0.28);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const seaVert = `
varying vec3 vWorld;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const seaFrag = `
uniform float uTime; uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uTop;
varying vec3 vWorld;
vec3 waveN(vec2 p){
  vec2 d = vec2(0.0);
  for(int i=0;i<5;i++){
    float fi = float(i);
    vec2 dir = normalize(vec2(cos(fi*1.7+0.3), sin(fi*2.3+0.1)));
    float f = 0.09 + fi*0.12;
    float a = 0.55/(1.0+fi*1.4);
    float ph = dot(dir,p)*f + uTime*(0.55+fi*0.22);
    d += dir * cos(ph) * a * f;
  }
  return normalize(vec3(-d.x*5.0, 1.0, -d.y*5.0));
}
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec3 N = waveN(vWorld.xz);
  N = normalize(mix(N, vec3(0.0,1.0,0.0), clamp(dist/1800.0, 0.0, 0.85)));
  float fres = pow(1.0 - max(dot(N,V),0.0), 3.2);
  vec3 R = reflect(-V,N);
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uTop, pow(h,0.5));
  vec3 deep = vec3(0.01,0.14,0.36);
  vec3 shallow = vec3(0.03,0.42,0.72);
  vec3 base = mix(deep, shallow, clamp(0.35 + (N.x+N.z)*1.2, 0.0, 1.0));
  vec3 col = mix(base, sky, clamp(fres*1.15 + 0.06, 0.0, 1.0));
  vec3 Lr = reflect(-uSun, N);
  float spec = pow(max(dot(Lr, V), 0.0), 220.0);
  col += vec3(1.0,0.95,0.8) * spec * 3.0;
  float fogF = smoothstep(300.0, 3500.0, dist);
  col = mix(col, uHorizon, fogF);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = makeRng(42);
  for (let i = 0; i < 26; i++) {
    const x = 40 + r.next() * 176;
    const y = 50 + r.next() * 40 - Math.abs(x - 128) * 0.15;
    const rad = 22 + r.next() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,0.55)");
    gr.addColorStop(0.55, "rgba(255,255,255,0.25)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------------------------------------------------- decor builder */

interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  color: number;
}

class DecorBuilder {
  boxes: Inst[] = [];
  glow: Inst[] = [];
  cyls: Inst[] = [];
  spheres: Inst[] = [];
  ox = 0;
  oy = 0;
  oz = 0;
  rot = 0;
  sc = 1;
  begin(ox: number, oy: number, oz: number, rot: number, sc: number) {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.rot = rot;
    this.sc = sc;
  }
  private tf(lx: number, ly: number, lz: number) {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return { x: this.ox + (lx * c + lz * s) * this.sc, y: this.oy + ly * this.sc, z: this.oz + (-lx * s + lz * c) * this.sc };
  }
  private mk(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, lry = 0): Inst {
    const p = this.tf(lx, ly, lz);
    return { ...p, sx: sx * this.sc, sy: sy * this.sc, sz: sz * this.sc, ry: this.rot + lry, color };
  }
  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, ry = 0) {
    this.boxes.push(this.mk(lx, ly, lz, sx, sy, sz, color, ry));
  }
  glowBox(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color = 0xffffff, ry = 0) {
    this.glow.push(this.mk(lx, ly, lz, sx, sy, sz, color, ry));
  }
  cyl(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number) {
    this.cyls.push(this.mk(lx, ly, lz, sx, sy, sz, color));
  }
  sphere(lx: number, ly: number, lz: number, r: number, color: number) {
    this.spheres.push(this.mk(lx, ly, lz, r * 2, r * 2, r * 2, color));
  }
}

const PAL = [0xff2bd6, 0x9b30ff, 0x22e83a, 0xffe600, 0xff1a1a, 0x00e5ff, 0xff8c00, 0x1f4bff];

function buildDecor(b: DecorBuilder, r: Rng, density: number) {
  // Helper structures that echo the reference screenshots.
  const orangeTower = () => {
    b.box(0, 40, 0, 22, 80, 22, 0xc77300);
    b.box(0, 95, 0, 22, 30, 22, 0xb36500);
    b.box(0, 10, 12, 14, 30, 2, 0xf2f2f2);
    b.box(0, 2, 14, 24, 4, 8, 0xff1a1a);
    for (let i = 0; i < 7; i++) b.box(13, 20 + i * 9, 0, 3, 5, 14, PAL[i % 8]);
  };
  const checkerSlab = (w: number, l: number) => {
    const n = 12;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) b.box(-w / 2 + (i + 0.5) * (w / n), 0, -l / 2 + (j + 0.5) * (l / n), w / n, 3, l / n, (i + j) % 2 ? 0xff55f0 : 0xb43cf0);
    b.box(0, -3, 0, w * 0.98, 3, l * 0.98, 0x7a1fc4);
  };
  const greenStairs = (n: number) => {
    for (let i = 0; i < n; i++) b.box(i * 6, i * 3.2, 0, 8, 10 + i * 3, 14, i % 2 ? 0x22e83a : 0x3dff55);
  };
  const redSpheres = (n: number) => {
    b.box(0, 0, 0, n * 30 + 20, 3, 34, 0x24182c);
    for (let i = 0; i < n; i++) {
      b.sphere(-n * 15 + i * 30 + 15, 11, (i % 2 ? 1 : -1) * 6, 8 + (i % 3), 0xff1a1a);
      b.cyl(-n * 15 + i * 30 + 15, 2, (i % 2 ? 1 : -1) * 6, 2, 4, 2, 0x8a1111);
    }
  };
  const roadStrip = (len: number) => {
    b.box(0, 0, 0, len, 4, 22, 0x2b2230);
    for (let i = 0; i < len / 14; i++) b.glowBox(-len / 2 + 7 + i * 14, 2.2, 0, 8, 0.4, 3, 0xffffff);
    b.box(0, 3, 12.5, len, 2, 2, 0xff1a1a);
  };
  const colorTowers = () => {
    for (let i = 0; i < 8; i++) {
      b.box(i * 14, 24 + (i % 3) * 8, 0, 11, 48 + (i % 3) * 16, 11, PAL[i % 8]);
      for (let k = 0; k < 4; k++) b.box(i * 14, 6 + k * 14, 5.8, 11, 2, 1, 0xffffff);
    }
  };
  const smallRainbowLine = (n: number) => {
    for (let i = 0; i < n; i++) b.box(i * 9, (i % 2) * 1.5, Math.sin(i * 0.9) * 6, 6 + (i % 3), 1.6, 3.5, PAL[i % 8]);
  };
  const purpleTier = () => {
    for (let i = 0; i < 8; i++) b.box(i * 1.5, i * 10, 0, 50 - i * 4, 3, 40 - i * 3, i % 2 ? 0xb43cf0 : 0x8e1fe0);
    b.box(0, 40, 0, 20, 90, 20, 0x9b30ff);
  };
  const ringOfBlocks = () => {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      b.box(Math.cos(a) * 36, i * 1.2, Math.sin(a) * 36, 10, 2, 8, PAL[i % 8], -a);
    }
  };
  const frames = () => {
    for (let i = 0; i < 6; i++) {
      const x = i * 12;
      b.box(x, 0, 0, 1.6, 12, 1.6, 0xffe600);
      b.box(x, 12, 0, 10, 1.6, 1.6, 0xffe600);
      b.box(x + 10, 0, 0, 1.6, 12, 1.6, 0xffe600);
    }
  };
  const hangingSlab = () => {
    b.box(0, 0, 0, 160, 3, 36, 0x7a1fc4);
    b.box(0, 3, 0, 150, 2, 24, 0xff2bd6);
    b.box(0, 3, 0, 100, 1, 6, 0x111111);
    for (let i = 0; i < 8; i++) b.sphere(-60 + i * 16, 8, 0, 4, 0xff1a1a);
  };
  const skyline = () => {
    for (let i = 0; i < 16; i++) {
      const h = 40 + r.next() * 120;
      b.box((r.next() - 0.5) * 120, h / 2, (r.next() - 0.5) * 60, 8 + r.next() * 14, h, 8 + r.next() * 14, r.pick([0x8f98a6, 0xb4bcc8, 0x6f7886, 0xcad2dd]));
    }
  };
  const island = () => {
    b.box(0, 0, 0, 520, 2, 160, 0xe8d8a8);
    b.box(-120, 1.4, 20, 260, 1, 40, 0x8c929b);
    b.box(100, 1.4, -30, 200, 1, 30, 0xb9bec6);
    for (let i = 0; i < 20; i++) b.box(-200 + i * 18, 1.4, 60, 10, 1, 6, r.pick([0xffffff, 0xd9534f, 0x3d9970]));
  };
  const redBars = () => {
    for (let i = 0; i < 5; i++) b.box(i * 18, 12, 0, 3, 28 + (i % 2) * 8, 3, 0xff1a1a);
    b.box(40, 0, 0, 120, 3, 12, 0x15121a);
  };

  const kinds = [orangeTower, () => checkerSlab(110, 70), () => greenStairs(14), () => redSpheres(6), () => roadStrip(180), colorTowers, () => smallRainbowLine(18), purpleTier, ringOfBlocks, frames, hangingSlab, redBars, () => roadStrip(130), () => checkerSlab(70, 70), () => greenStairs(10)];
  const count = Math.round(34 * density);
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + r.range(-0.08, 0.08);
    const radius = r.range(760, 1500);
    const y = r.range(-45, 90) + (i % 5 === 0 ? 60 : 0);
    b.begin(Math.cos(ang) * radius, y, Math.sin(ang) * radius, r.range(0, Math.PI * 2), r.range(1.4, 2.4));
    kinds[i % kinds.length]();
  }
  // always-present hero pieces (like the large pink platform & tower in the screenshots)
  b.begin(-640, 30, -800, 0.6, 2.2);
  orangeTower();
  b.begin(800, 40, -740, 2.1, 1.8);
  hangingSlab();
  b.begin(-860, 10, 640, 0.3, 2.0);
  checkerSlab(130, 90);
  b.begin(480, -10, 1000, 1.0, 1.6);
  skyline();
  b.begin(-1300, -64, 40, 0.2, 1.4);
  island();
  b.begin(1250, -64, 700, 0.9, 1.2);
  island();
}

export class Scenery {
  group = new THREE.Group();
  private sky: THREE.Mesh;
  private ocean: THREE.Mesh;
  private oceanMat: THREE.ShaderMaterial;
  private clouds = new THREE.Group();
  private decorGroup = new THREE.Group();
  private cloudSprites: THREE.Sprite[] = [];
  private cloudTex: THREE.CanvasTexture;

  constructor() {
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: { uHorizon: { value: HORIZON }, uTop: { value: SKY_TOP }, uSun: { value: SUN_DIR } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: seaVert,
      fragmentShader: seaFrag,
      uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR }, uHorizon: { value: HORIZON }, uTop: { value: SKY_TOP } },
    });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), this.oceanMat);
    this.ocean.position.y = OCEAN_Y;
    this.ocean.frustumCulled = false;
    this.group.add(this.ocean);

    this.cloudTex = cloudTexture();
    this.group.add(this.clouds);
    this.group.add(this.decorGroup);
    this.setCloudCount(60);
    this.buildDecor(1);
  }

  setCloudCount(n: number) {
    for (const s of this.cloudSprites) {
      this.clouds.remove(s);
      s.material.dispose();
    }
    this.cloudSprites = [];
    const r = makeRng(99);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false, opacity: r.range(0.55, 0.95) });
      const s = new THREE.Sprite(mat);
      const az = r.range(0, Math.PI * 2);
      const el = r.range(0.04, 0.85);
      const rad = 2400;
      s.position.set(Math.cos(az) * Math.cos(el) * rad, Math.sin(el) * rad + 40, Math.sin(az) * Math.cos(el) * rad);
      const w = r.range(500, 1300);
      s.scale.set(w, w * 0.4, 1);
      s.renderOrder = -5;
      this.clouds.add(s);
      this.cloudSprites.push(s);
    }
  }

  buildDecor(density: number) {
    for (const ch of [...this.decorGroup.children]) {
      this.decorGroup.remove(ch);
      const m = ch as THREE.InstancedMesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
      m.dispose?.();
    }
    if (density <= 0) return;
    const b = new DecorBuilder();
    buildDecor(b, makeRng(2024), density);
    const make = (list: Inst[], geo: THREE.BufferGeometry, mat: THREE.Material) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const col = new THREE.Color();
      list.forEach((o, i) => {
        e.set(0, o.ry, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(o.x, o.y, o.z), q, new THREE.Vector3(o.sx, o.sy, o.sz));
        im.setMatrixAt(i, m);
        im.setColorAt(i, col.setHex(o.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      this.decorGroup.add(im);
    };
    const std = () => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.0 });
    make(b.boxes, new THREE.BoxGeometry(1, 1, 1), std());
    make(b.glow, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    make(b.cyls, new THREE.CylinderGeometry(0.5, 0.5, 1, 16), std());
    make(b.spheres, new THREE.SphereGeometry(0.5, 20, 14), std());
  }

  update(dt: number, time: number, camPos: THREE.Vector3) {
    this.oceanMat.uniforms.uTime.value = time;
    this.sky.position.copy(camPos);
    this.ocean.position.x = camPos.x;
    this.ocean.position.z = camPos.z;
    this.clouds.position.set(camPos.x, 0, camPos.z);
    this.clouds.rotation.y += dt * 0.002;
  }
}
