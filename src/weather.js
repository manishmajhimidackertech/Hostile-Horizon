// Camera-following weather particles: rain streaks, snow, blowing sand and volcanic ash.
import * as THREE from 'three';

const CONFIG = {
  rain: { count: 800, color: '#b4c6da', opacity: 0.45, vx: -10, vy: -75, len: 0.035, lines: true },
  snow: { count: 700, color: '#ffffff', size: 1.0, opacity: 0.9, vx: -6, vy: -7, sway: 2.5 },
  sand: { count: 800, color: '#e8bf8f', size: 1.3, opacity: 0.35, vx: -48, vy: -1.5, sway: 4 },
  ash: { count: 600, color: '#8a817c', size: 0.8, opacity: 0.85, vx: -4, vy: -3.5, sway: 1.5, embers: 0.18 },
};

let dotTexture = null;
function dot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

const Z_NEAR = 24;
const Z_FAR = -30;

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.obj = null;
    this.cfg = null;
    this.t = 0;
  }

  setup(type) {
    if (this.obj) {
      this.scene.remove(this.obj);
      this.obj.geometry.dispose();
      this.obj.material.dispose();
      this.obj = null;
    }
    this.cfg = CONFIG[type] || null;
    if (!this.cfg) return;
    const c = this.cfg;
    const n = c.count;
    this.p = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    this.ember = new Uint8Array(n);
    this.seeded = false;
    const geo = new THREE.BufferGeometry();
    if (c.lines) {
      this.buf = new Float32Array(n * 6);
      geo.setAttribute('position', new THREE.BufferAttribute(this.buf, 3).setUsage(THREE.DynamicDrawUsage));
      this.obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: c.color, transparent: true, opacity: c.opacity, depthWrite: false,
      }));
    } else {
      this.buf = this.p;
      const col = new Float32Array(n * 3);
      const base = new THREE.Color(c.color);
      const hot = new THREE.Color('#ff8a3a');
      for (let i = 0; i < n; i++) {
        this.ember[i] = c.embers && Math.random() < c.embers ? 1 : 0;
        const k = this.ember[i] ? hot : base;
        col[i * 3] = k.r;
        col[i * 3 + 1] = k.g;
        col[i * 3 + 2] = k.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(this.buf, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.obj = new THREE.Points(geo, new THREE.PointsMaterial({
        size: c.size, map: dot(), vertexColors: true, transparent: true, opacity: c.opacity,
        depthWrite: false, sizeAttenuation: true,
      }));
    }
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 4;
    this.scene.add(this.obj);
  }

  update(dt, camX, halfW, halfH) {
    if (!this.obj) return;
    const c = this.cfg;
    const n = c.count;
    const p = this.p;
    const W = halfW * 1.7;
    const top = halfH + 8;
    const bottom = -halfH - 6;
    this.t += dt;
    if (!this.seeded) {
      for (let i = 0; i < n; i++) {
        p[i * 3] = camX + (Math.random() * 2 - 1) * W;
        p[i * 3 + 1] = bottom + Math.random() * (top - bottom);
        p[i * 3 + 2] = Z_FAR + Math.random() * (Z_NEAR - Z_FAR);
        this.phase[i] = Math.random() * 6.28;
      }
      this.seeded = true;
    }
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const sway = c.sway ? Math.sin(this.t * 1.3 + this.phase[i]) * c.sway : 0;
      const vy = this.ember[i] ? 3 : c.vy;
      p[i3] += (c.vx + sway) * dt;
      p[i3 + 1] += vy * dt;
      if (p[i3] < camX - W) p[i3] += 2 * W;
      else if (p[i3] > camX + W) p[i3] -= 2 * W;
      if (p[i3 + 1] < bottom) {
        p[i3 + 1] = top;
        p[i3] = camX + (Math.random() * 2 - 1) * W;
      } else if (p[i3 + 1] > top) {
        p[i3 + 1] = bottom;
      }
      if (c.lines) {
        const o = i * 6;
        this.buf[o] = p[i3];
        this.buf[o + 1] = p[i3 + 1];
        this.buf[o + 2] = p[i3 + 2];
        this.buf[o + 3] = p[i3] - c.vx * c.len;
        this.buf[o + 4] = p[i3 + 1] - c.vy * c.len;
        this.buf[o + 5] = p[i3 + 2];
      }
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
  }
}
