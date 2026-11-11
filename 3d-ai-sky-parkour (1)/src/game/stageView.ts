import * as THREE from "three";
import { Stage, Platform, Hazard, movePos, spherePos, barAngle, Pattern } from "@/lib/stage/types";

const texCache = new Map<string, THREE.CanvasTexture>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

function patternTexture(pattern: Pattern, c1: number, c2: number): THREE.CanvasTexture {
  const key = `${pattern}-${c1}-${c2}`;
  let t = texCache.get(key);
  if (t) return t;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext("2d")!;
  if (pattern === "checker") {
    g.fillStyle = hex(c1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = hex(c2);
    g.fillRect(0, 0, 32, 32);
    g.fillRect(32, 32, 32, 32);
  } else if (pattern === "tiles") {
    g.fillStyle = hex(c1);
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = "rgba(255,255,255,0.65)";
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 60);
  } else if (pattern === "stripes") {
    g.fillStyle = hex(c1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = hex(c2);
    g.fillRect(0, 0, 64, 20);
  } else if (pattern === "road") {
    g.fillStyle = hex(c1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = hex(c2);
    g.fillRect(29, 6, 6, 28);
    g.fillRect(2, 0, 3, 64);
    g.fillRect(59, 0, 3, 64);
  }
  t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.NearestFilter;
  texCache.set(key, t);
  return t;
}

function platformMaterial(p: Platform): THREE.MeshStandardMaterial {
  const pat: Pattern = p.shape === "ell" && p.pattern !== "solid" ? "solid" : p.pattern;
  const key = `${pat}-${p.color}-${p.color2}-${p.glow ? 1 : 0}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: pat === "solid" ? p.color : 0xffffff,
    map: pat === "solid" ? null : patternTexture(pat, p.color, p.color2),
    roughness: 0.55,
    metalness: 0.02,
    emissive: p.glow ? p.color : 0x000000,
    emissiveIntensity: p.glow ? 0.28 : 0,
  });
  matCache.set(key, m);
  return m;
}

function scaleUV(geo: THREE.BoxGeometry, sx: number, sy: number, sz: number, pattern: Pattern) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const tile = pattern === "checker" ? 4 : pattern === "tiles" ? 2 : pattern === "stripes" ? 3 : 8;
  const faces: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      let u = uv.getX(i);
      let w = uv.getY(i);
      if (pattern === "road") {
        if (f === 2 || f === 3) {
          w *= faces[f][1] / tile;
        } else {
          u = 0.2 + u * 0.1;
          w = 0.6 + w * 0.1;
        }
      } else if (pattern === "stripes") {
        u *= 1;
        w *= faces[f][1] / tile;
      } else {
        u *= faces[f][0] / tile;
        w *= faces[f][1] / tile;
      }
      uv.setXY(i, u, w);
    }
  }
}

export class StageView {
  group = new THREE.Group();
  private movers: { mesh: THREE.Object3D; p: Platform }[] = [];
  private spheres: { mesh: THREE.Object3D; h: Hazard }[] = [];
  private bars: { mesh: THREE.Object3D; h: Hazard }[] = [];
  private flags: THREE.Mesh[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  finishRing: THREE.Object3D | null = null;
  finishPos = new THREE.Vector3();

  constructor(public stage: Stage) {
    for (const p of stage.platforms) {
      let mesh: THREE.Mesh;
      const mat = platformMaterial(p);
      if (p.shape === "ell") {
        const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 36);
        this.geos.push(g);
        mesh = new THREE.Mesh(g, mat);
        mesh.scale.set(p.sx, p.sy, p.sz);
      } else {
        const g = new THREE.BoxGeometry(p.sx, p.sy, p.sz);
        if (p.pattern !== "solid") scaleUV(g, p.sx, p.sy, p.sz, p.pattern);
        this.geos.push(g);
        mesh = new THREE.Mesh(g, mat);
      }
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (p.move) this.movers.push({ mesh, p });
    }

    const sphereMat = new THREE.MeshStandardMaterial({ color: 0xff1a1a, roughness: 0.25, metalness: 0.1, emissive: 0x550000, emissiveIntensity: 0.4 });
    this.mats.push(sphereMat);
    for (const h of stage.hazards) {
      if (h.kind === "sphere") {
        const g = new THREE.SphereGeometry(h.len, 28, 18);
        this.geos.push(g);
        const m = new THREE.Mesh(g, sphereMat);
        m.castShadow = true;
        const s = spherePos(h, 0);
        m.position.set(s.x, s.y, s.z);
        this.group.add(m);
        this.spheres.push({ mesh: m, h });
      } else {
        const g = new THREE.BoxGeometry(h.len * 2, h.height, h.thick);
        this.geos.push(g);
        const mat = new THREE.MeshStandardMaterial({ color: h.color, roughness: 0.4, emissive: h.color, emissiveIntensity: 0.25 });
        this.mats.push(mat);
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.position.set(h.x, h.y, h.z);
        this.group.add(m);
        this.bars.push({ mesh: m, h });
      }
    }

    const boxG = new THREE.BoxGeometry(1, 1, 1);
    const cylG = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    this.geos.push(boxG, cylG);
    for (const d of stage.decor) {
      const mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.5 });
      this.mats.push(mat);
      const m = new THREE.Mesh(d.kind === "cyl" ? cylG : boxG, mat);
      m.position.set(d.x, d.y, d.z);
      m.scale.set(d.sx, d.sy, d.sz);
      m.rotation.y = d.rotY;
      m.castShadow = true;
      this.group.add(m);
    }

    // checkpoint flags + finish portal
    stage.checkpoints.forEach((cp, i) => {
      const plat = stage.platforms.find((p) => p.id === cp.platform);
      if (plat?.role === "finish") {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.2, 12, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ring.position.set(cp.x, cp.y + 3.2, cp.z);
        this.group.add(ring);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffee55, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        beam.position.set(cp.x, cp.y + 20, cp.z);
        this.group.add(beam);
        this.finishRing = ring;
        this.finishPos.set(cp.x, cp.y, cp.z);
        this.geos.push(ring.geometry, beam.geometry);
        this.mats.push(ring.material as THREE.Material, beam.material as THREE.Material);
        return;
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      pole.position.set(cp.x + 2.2, cp.y + 1.6, cp.z + 2.2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: i === 0 ? 0x22e83a : 0xff3355, side: THREE.DoubleSide }));
      flag.position.set(0.7, 1.1, 0);
      pole.add(flag);
      this.group.add(pole);
      this.flags[i] = flag;
      this.geos.push(pole.geometry, flag.geometry);
      this.mats.push(pole.material as THREE.Material, flag.material as THREE.Material);
    });
  }

  setActiveCheckpoint(idx: number) {
    this.flags.forEach((f, i) => {
      if (f) (f.material as THREE.MeshBasicMaterial).color.setHex(i <= idx ? 0x22e83a : 0xff3355);
    });
  }

  update(t: number) {
    for (const m of this.movers) {
      const p = movePos(m.p, t);
      m.mesh.position.set(p.x, p.y, p.z);
    }
    for (const s of this.spheres) {
      const p = spherePos(s.h, t);
      s.mesh.position.set(p.x, p.y, p.z);
      s.mesh.rotation.x = t * 1.5;
    }
    for (const b of this.bars) b.mesh.rotation.y = -barAngle(b.h, t);
    if (this.finishRing) {
      this.finishRing.rotation.y = t * 1.2;
      this.finishRing.position.y = this.finishPos.y + 3.2 + Math.sin(t * 2) * 0.25;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.group.clear();
  }
}
