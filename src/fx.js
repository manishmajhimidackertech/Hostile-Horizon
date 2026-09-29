// GPU point-sprite particle systems (one draw call each) and effect presets.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pcolor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = mix(1.0 - step(0.5, d), smoothstep(0.5, 0.0, d), uSoft) * vAlpha;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

class ParticleSystem {
  constructor(max, blending, soft = 1) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(this.pos, 3));
    geo.setAttribute('pcolor', attr(this.col, 3));
    geo.setAttribute('alpha', attr(this.alpha, 1));
    geo.setAttribute('size', attr(this.size, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    // Simulation state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uSoft: { value: soft } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0 = 1, drag = 0, grav = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.c0[i3] = c0.r;
    this.c0[i3 + 1] = c0.g;
    this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r;
    this.c1[i3 + 1] = c1.g;
    this.c1[i3 + 2] = c1.b;
    this.a0[i] = a0;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  _copy(from, to) {
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k];
      this.c1[t3 + k] = this.c1[f3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) this._copy(this.count, i);
        continue;
      }
      const i3 = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k + this.grav[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, (1 - t) * 4);
      for (let c = 0; c < 3; c++) this.col[i3 + c] = this.c0[i3 + c] + (this.c1[i3 + c] - this.c0[i3 + c]) * t;
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.count);
    for (const name of ['position', 'pcolor', 'alpha', 'size']) {
      const a = g.attributes[name];
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
  }
}

const C = (hex) => new THREE.Color(hex);
const COL = {
  white: C('#fff7e0'),
  yellow: C('#ffd35a'),
  orange: C('#ff7a1a'),
  red: C('#b3200a'),
  dark: C('#2a1a12'),
  smoke: C('#6f6a66'),
  smokeLight: C('#b9b4ad'),
  smokeDark: C('#2d2926'),
  dirt: C('#6b5433'),
  spark: C('#ffe9a8'),
  blue: C('#8fd8ff'),
  green: C('#8dffc8'),
  teal: C('#1d8a9a'),
  splash: C('#e8f6ff'),
  foam: C('#b9dcea'),
  lava: C('#ff7a1a'),
  flak: C('#3b3632'),
};

const rnd = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor(scene) {
    this.glow = new ParticleSystem(2500, THREE.AdditiveBlending, 1);
    this.smoke = new ParticleSystem(2000, THREE.NormalBlending, 1);
    this.smoke.points.renderOrder = 1;
    this.glow.points.renderOrder = 2;
    scene.add(this.smoke.points, this.glow.points);
    this.quality = 1;
    this.water = false;
  }

  setScale(v) {
    this.glow.material.uniforms.uScale.value = v;
    this.smoke.material.uniforms.uScale.value = v;
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  clear() {
    this.glow.clear();
    this.smoke.clear();
  }

  n(count) {
    return Math.max(1, Math.round(count * this.quality));
  }

  explosion(x, y, s = 1, vx = 0, z = 0) {
    const g = this.glow;
    g.spawn(x, y, z + 0.5, vx, 0, 0, 0.18, 5 * s, 11 * s, COL.white, COL.yellow, 1);
    for (let i = this.n(14 * s); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(4, 13) * Math.sqrt(s);
      g.spawn(x, y, z, vx + Math.cos(a) * v, Math.sin(a) * v, rnd(-3, 3), rnd(0.35, 0.8), rnd(2, 3.5) * s, 0.6 * s, COL.yellow, COL.red, 1, 3.5, 2);
    }
    for (let i = this.n(10 * Math.sqrt(s)); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(12, 26);
      g.spawn(x, y, z, vx + Math.cos(a) * v, Math.sin(a) * v, 0, rnd(0.3, 0.7), 0.5, 0.2, COL.spark, COL.orange, 1, 2, -25);
    }
    const sm = this.smoke;
    for (let i = this.n(9 * s); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(1, 5) * Math.sqrt(s);
      sm.spawn(x + rnd(-1, 1) * s, y + rnd(-1, 1) * s, z - 0.5, vx * 0.5 + Math.cos(a) * v, Math.sin(a) * v + 2, 0, rnd(0.9, 1.9), rnd(2, 3) * s, rnd(4.5, 6.5) * s, COL.smokeDark, COL.smoke, 0.75, 1.2, 1.5);
    }
    for (let i = this.n(6 * s); i-- > 0;) {
      const a = rnd(0.3, Math.PI - 0.3);
      const v = rnd(8, 18);
      sm.spawn(x, y, z + 0.3, vx + Math.cos(a) * v, Math.sin(a) * v, 0, rnd(0.6, 1.2), 0.45, 0.35, COL.dark, COL.dark, 1, 0.5, -30);
    }
  }

  groundBlast(x, y, s = 1, vx = 0) {
    if (this.water) {
      this.explosion(x, y + 0.8, s * 0.8, vx);
      this.splash(x, y, s, vx);
      return;
    }
    this.explosion(x, y + 0.5, s, vx);
    const sm = this.smoke;
    for (let i = this.n(12 * s); i-- > 0;) {
      const a = rnd(0.4, Math.PI - 0.4);
      const v = rnd(6, 16);
      sm.spawn(x, y, 0.5, vx + Math.cos(a) * v, Math.sin(a) * v, rnd(-2, 2), rnd(0.6, 1.1), rnd(0.8, 1.4) * s, rnd(1.5, 2.5) * s, COL.dirt, COL.dirt, 1, 1, -28);
    }
  }

  flakBurst(x, y) {
    this.glow.spawn(x, y, 0.4, 0, 0, 0, 0.12, 3, 5, COL.white, COL.orange, 1);
    for (let i = this.n(6); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x, y, 0, Math.cos(a) * 3, Math.sin(a) * 3, 0, rnd(0.8, 1.4), 1.6, 3.8, COL.flak, COL.smokeDark, 0.85, 2, 0.5);
    }
    for (let i = this.n(8); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(10, 20);
      this.glow.spawn(x, y, 0, Math.cos(a) * v, Math.sin(a) * v, 0, 0.25, 0.35, 0.2, COL.spark, COL.orange, 1, 3, 0);
    }
  }

  sparks(x, y, n = 4, vx = 0) {
    for (let i = this.n(n); i-- > 0;) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(6, 16);
      this.glow.spawn(x, y, 0.5, vx + Math.cos(a) * v, Math.sin(a) * v, 0, rnd(0.12, 0.3), 0.5, 0.2, COL.spark, COL.orange, 1, 4, 0);
    }
  }

  dirt(x, y, vx = 0) {
    if (this.water) {
      for (let i = this.n(3); i-- > 0;) {
        this.smoke.spawn(x, y, 0.3, vx + rnd(-2, 2), rnd(4, 9), 0, rnd(0.3, 0.6), 0.4, 0.9, COL.splash, COL.foam, 0.9, 1, -22);
      }
      return;
    }
    for (let i = this.n(3); i-- > 0;) {
      this.smoke.spawn(x, y, 0.3, vx + rnd(-3, 3), rnd(3, 8), 0, rnd(0.3, 0.6), 0.5, 1.1, COL.dirt, COL.dirt, 0.9, 1, -20);
    }
  }

  muzzle(x, y, vx) {
    this.glow.spawn(x, y, 0.4, vx, 0, 0, 0.05, 1.3, 0.6, COL.white, COL.yellow, 1);
  }

  exhaust(x, y, vx, vy, s = 1, kind = 'orange') {
    const c0 = kind === 'blue' ? COL.blue : kind === 'green' ? COL.green : COL.yellow;
    const c1 = kind === 'green' ? COL.teal : COL.red;
    this.glow.spawn(x, y, 0, vx, vy, 0, rnd(0.08, 0.16), 0.9 * s, 0.25 * s, c0, c1, 0.8);
  }

  splash(x, y, s = 1, vx = 0) {
    const sm = this.smoke;
    for (let i = this.n(16 * s); i-- > 0;) {
      const a = rnd(0.35, Math.PI - 0.35);
      const v = rnd(6, 18) * Math.sqrt(s);
      sm.spawn(x + rnd(-0.6, 0.6) * s, y, 0.5, vx + Math.cos(a) * v * 0.5, Math.sin(a) * v, rnd(-2, 2), rnd(0.6, 1.2), rnd(0.6, 1.1) * s, rnd(1.6, 2.6) * s, COL.splash, COL.foam, 0.95, 0.8, -26);
    }
    for (let i = this.n(5 * s); i-- > 0;) {
      sm.spawn(x + rnd(-2, 2) * s, y + 0.2, 0.2, vx * 0.3, rnd(0.5, 1.5), 0, rnd(1, 1.8), 2 * s, 5 * s, COL.foam, COL.splash, 0.6, 1, 0);
    }
  }

  wake(x, y, vx) {
    this.smoke.spawn(x, y + 0.1, 0.4, vx + rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1), rnd(0.8, 1.4), 0.8, 2.4, COL.splash, COL.foam, 0.7, 1, 0);
  }

  fireTrail(x, y, vx, vy, s = 1) {
    this.glow.spawn(x, y, 0.2, vx + rnd(-1, 1), vy + rnd(-1, 1), 0, rnd(0.2, 0.4), 1.6 * s, 0.5 * s, COL.yellow, COL.red, 1, 2, 0);
    if (Math.random() < 0.6) this.smoke.spawn(x, y, -0.2, vx * 0.8, vy * 0.2 + 1, 0, rnd(0.8, 1.4), 1 * s, 3 * s, COL.smokeDark, COL.smoke, 0.6, 1, 1);
  }

  beacon(x, y, z = 0.6) {
    this.glow.spawn(x, y, z, 0, 0, 0, 0.12, 2.2, 1.2, COL.red, COL.red, 1);
    this.glow.spawn(x, y, z + 0.1, 0, 0, 0, 0.1, 0.9, 0.5, COL.white, COL.red, 1);
  }

  plume(x, y, z, s) {
    this.smoke.spawn(x + rnd(-2, 2) * s, y, z, rnd(-1, 1) * s, rnd(3, 6) * s, 0, rnd(5, 8), 6 * s, 22 * s, COL.smokeDark, COL.smoke, 0.55, 0.05, 0.4);
    if (Math.random() < 0.3) this.glow.spawn(x, y + 1, z + 1, rnd(-3, 3) * s, rnd(4, 10) * s, 0, rnd(0.8, 1.6), 5 * s, 2 * s, COL.lava, COL.red, 1, 0.2, -6);
  }

  trail(x, y, vx, vy, s = 1, dark = false) {
    this.smoke.spawn(x, y, -0.2, vx + rnd(-0.5, 0.5), vy + rnd(-0.5, 0.5), 0, rnd(0.5, 0.9), 0.45 * s, 1.8 * s, dark ? COL.smokeDark : COL.smokeLight, COL.smoke, dark ? 0.7 : 0.45, 1.5, 1);
  }

  damageSmoke(x, y, vx, heavy = false) {
    this.smoke.spawn(x, y, -0.3, vx + rnd(-1, 1), rnd(1, 3), 0, rnd(0.8, 1.4), 1, heavy ? 3.2 : 2.2, COL.smokeDark, COL.smoke, 0.7, 1, 2);
    if (heavy && Math.random() < 0.5) this.glow.spawn(x, y, 0, vx, rnd(1, 3), 0, 0.3, 1.2, 0.4, COL.yellow, COL.red, 0.9);
  }

  pickupSparkle(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.glow.spawn(x, y, 0.5, Math.cos(a) * 9, Math.sin(a) * 9, 0, 0.35, 0.8, 0.2, COL.spark, COL.yellow, 1, 4, 0);
    }
  }
}
