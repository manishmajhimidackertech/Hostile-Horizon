// Endless procedurally generated scenery: sky, terrain strip, far mountains and clouds.
import * as THREE from 'three';
import { fbm1, fbm2, noise1, hash1, rng } from './noise.js';
import { part, merge, MAT, treeParts, buildingParts, rockParts, cloudGeometry } from './models.js';

export const THEMES = [
  {
    name: 'Verdant Valley',
    skyTop: '#2f6fc4', skyBottom: '#c4e4fb', fog: '#c9e2f5',
    hemiSky: '#dff0ff', hemiGround: '#5a6b3a', sun: '#fff4c8', sunLight: '#fff3dc', sunIntensity: 2.4, hemiIntensity: 1.4,
    ground: ['#5e9442', '#6ba34a', '#57883c', '#77a852'], rock: '#7d7563', high: '#8e9a6a',
    mountain: '#7494ad', snowcap: '#eef3f8', trunk: '#5a3f26', tree: '#2f6b31', tree2: '#3f8538',
    buildings: ['#c9c1b0', '#b5a58b', '#d8d2c4'], windows: '#3b4a5a', cloud: '#ffffff',
    scenery: 'forest', town: 0.35,
  },
  {
    name: 'Desert Storm',
    skyTop: '#4d86c2', skyBottom: '#f2dcb0', fog: '#ecd7b0',
    hemiSky: '#fff1d6', hemiGround: '#a57a45', sun: '#fff0c0', sunLight: '#ffedd0', sunIntensity: 2.7, hemiIntensity: 1.3,
    ground: ['#d6b178', '#cfa76a', '#dcbb86', '#c79d5f'], rock: '#a0714a', high: '#b98857',
    mountain: '#b98b62', snowcap: '#d9b58a', trunk: '#4d7a3a', tree: '#4f8a3c',
    buildings: ['#e0cfa5', '#cdb68a', '#d9c7a0'], windows: '#5a4630', cloud: '#fff8ec',
    scenery: 'desert', town: 0.3,
  },
  {
    name: 'Frozen Front',
    skyTop: '#5d86b0', skyBottom: '#dde9f3', fog: '#dbe6ef',
    hemiSky: '#eef6ff', hemiGround: '#8aa0b3', sun: '#ffffff', sunLight: '#f2f6ff', sunIntensity: 2.0, hemiIntensity: 1.6,
    ground: ['#eef3f7', '#e2eaf1', '#f6f9fb', '#d9e3ec'], rock: '#8b949c', high: '#c9d5df',
    mountain: '#8fa6bd', snowcap: '#ffffff', trunk: '#4a3a2c', tree: '#27493a',
    buildings: ['#9b8b7a', '#7d6f63', '#b1a28f'], windows: '#f4c870', cloud: '#f5f8fb',
    scenery: 'snow', town: 0.25,
  },
  {
    name: 'Dusk Raid',
    skyTop: '#2b2d5c', skyBottom: '#f39a5d', fog: '#d98a66',
    hemiSky: '#ffc59a', hemiGround: '#40324a', sun: '#ffb070', sunLight: '#ffb58a', sunIntensity: 2.2, hemiIntensity: 1.1,
    ground: ['#556b3b', '#4c6135', '#5f7442', '#465a33'], rock: '#6e5b52', high: '#6f6a45',
    mountain: '#6c5a7a', snowcap: '#f0c9b5', trunk: '#3e2b20', tree: '#24452a', tree2: '#2f5530',
    buildings: ['#b39a8a', '#9d8575', '#c4aa94'], windows: '#ffd27a', cloud: '#ffd2b8',
    scenery: 'forest', town: 0.4,
  },
  {
    name: 'Night Siege',
    skyTop: '#060b1c', skyBottom: '#1f3456', fog: '#1b2a45',
    hemiSky: '#6f8fc4', hemiGround: '#1a2230', sun: '#e8eeff', sunLight: '#9fb6ff', sunIntensity: 1.4, hemiIntensity: 1.0,
    ground: ['#2d3f31', '#33473a', '#29392d', '#384b3c'], rock: '#434650', high: '#3b4a3e',
    mountain: '#26344f', snowcap: '#8ea2c4', trunk: '#231c17', tree: '#1b3326',
    buildings: ['#4a4f5c', '#3e4350', '#565b68'], windows: '#ffcf5c', cloud: '#56627d',
    scenery: 'forest', town: 0.45, night: true,
  },
];

// A row of chunks along X, created/destroyed as the camera moves.
class ChunkLayer {
  constructor(parent, width, farZ, build) {
    this.parent = parent;
    this.width = width;
    this.farZ = farZ;
    this.build = build;
    this.chunks = new Map();
  }

  update(camX, halfWidthAt, budget = 2) {
    const hw = halfWidthAt(this.farZ);
    const from = Math.floor((camX - hw) / this.width) - 1;
    const to = Math.floor((camX + hw) / this.width) + 1;
    for (const [i, obj] of this.chunks) {
      if (i < from || i > to) {
        this.parent.remove(obj);
        obj.geometry.dispose();
        this.chunks.delete(i);
      }
    }
    // Build a limited number of chunks per frame to avoid hitches.
    let built = 0;
    for (let i = from; i <= to && built < budget; i++) {
      if (!this.chunks.has(i)) {
        const obj = this.build(i, i * this.width);
        this.parent.add(obj);
        this.chunks.set(i, obj);
        built++;
      }
    }
  }

  dispose() {
    for (const obj of this.chunks.values()) {
      this.parent.remove(obj);
      obj.geometry.dispose();
    }
    this.chunks.clear();
  }
}

const GROUND_Z = [34, 22, 12, 5, 0, -5, -10, -17, -26, -37, -50, -66, -85];
const MOUNTAIN_Z = [-150, -185, -225, -270, -330];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.layers = [];
    this.seed = 1;
    this.theme = THEMES[0];

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sunLight.position.set(-40, 90, 70);
    scene.add(this.hemi, this.sunLight);

    this.sky = null;
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(16, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.95, depthWrite: false })
    );
    this.sunHalo = new THREE.Mesh(
      new THREE.CircleGeometry(30, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.sunDisc.renderOrder = -2;
    this.sunHalo.renderOrder = -3;
    scene.add(this.sunDisc, this.sunHalo);

    this.stars = null;
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
  }

  setup(themeIndex, seed) {
    for (const l of this.layers) l.dispose();
    this.layers = [];
    const t = THEMES[((themeIndex % THEMES.length) + THEMES.length) % THEMES.length];
    this.theme = t;
    this.seed = seed;

    // Sky gradient
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, t.skyTop);
    grad.addColorStop(0.62, t.skyBottom);
    grad.addColorStop(1, t.fog);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    if (this.sky) this.sky.dispose();
    this.sky = new THREE.CanvasTexture(canvas);
    this.sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(t.fog, 120, 500);

    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sunLight.color.set(t.sunLight);
    this.sunLight.intensity = t.sunIntensity;
    this.sunDisc.material.color.set(t.sun);
    this.sunHalo.material.color.set(t.sun);

    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars = null;
    }
    if (t.night) this._makeStars();

    this.warm = true;
    this.layers.push(new ChunkLayer(this.group, 48, GROUND_Z[GROUND_Z.length - 1], (i, x0) => this._groundChunk(i, x0)));
    this.layers.push(new ChunkLayer(this.group, 192, MOUNTAIN_Z[MOUNTAIN_Z.length - 1], (i, x0) => this._mountainChunk(i, x0)));
    this.layers.push(new ChunkLayer(this.group, 110, -170, (i, x0) => this._cloudChunk(i, x0)));
  }

  _makeStars() {
    const n = 400;
    const pos = new Float32Array(n * 3);
    const r = rng(this.seed + 99);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() - 0.5) * 1400;
      pos[i * 3 + 1] = 20 + r() * 300;
      pos[i * 3 + 2] = -420;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: true, fog: false }));
    this.stars.renderOrder = -4;
    this.scene.add(this.stars);
  }

  // Height of the gameplay line (z = 0). Everything that "lands" uses this.
  groundY(x) {
    const s = this.seed;
    const h = -19.5 + (fbm1(x * 0.012, s, 3) - 0.5) * 10 + (noise1(x * 0.07, s + 5) - 0.5) * 1.6;
    return Math.max(-23, Math.min(-12.5, h));
  }

  groundSlope(x) {
    return Math.atan2(this.groundY(x + 1) - this.groundY(x - 1), 2);
  }

  heightAt(x, z) {
    let y = this.groundY(x);
    if (z < -4) {
      const t = -z - 4;
      y += fbm2(x * 0.018, z * 0.035, this.seed + 11) * t * 0.3 + t * 0.03;
    } else if (z > 4) {
      y -= (z - 4) * 0.2;
      // Steep skirt in front so tall portrait views never see under the world.
      if (z > 30) y -= 140;
    }
    return y;
  }

  _groundChunk(index, x0) {
    const t = this.theme;
    const W = 48;
    const step = 2;
    const nx = W / step;
    const Z = GROUND_Z;
    const heights = [];
    for (let iz = 0; iz < Z.length; iz++) {
      const row = [];
      for (let ix = 0; ix <= nx; ix++) row.push(this.heightAt(x0 + ix * step, Z[iz]));
      heights.push(row);
    }
    const tris = (nx) * (Z.length - 1) * 2;
    const pos = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const palette = t.ground.map((c) => new THREE.Color(c));
    const rock = new THREE.Color(t.rock);
    const high = new THREE.Color(t.high);
    const tmp = new THREE.Color();
    let p = 0;
    const put = (x, y, z) => {
      pos[p] = x;
      pos[p + 1] = y;
      pos[p + 2] = z;
      p += 3;
    };
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    let tri = 0;
    const colorTri = (ax, ay, az, bx, by, bz, cx, cy, cz, seedI) => {
      va.set(bx - ax, by - ay, bz - az);
      vb.set(cx - ax, cy - ay, cz - az);
      vc.crossVectors(va, vb).normalize();
      const slope = Math.abs(vc.y);
      const h = hash1(seedI, this.seed);
      tmp.copy(palette[Math.floor(h * palette.length)]);
      const avgY = (ay + by + cy) / 3;
      if (avgY > -8) tmp.lerp(high, Math.min(1, (avgY + 8) / 25));
      if (slope < 0.72) tmp.lerp(rock, 0.75);
      for (let k = 0; k < 3; k++) {
        col[tri * 9 + k * 3] = tmp.r;
        col[tri * 9 + k * 3 + 1] = tmp.g;
        col[tri * 9 + k * 3 + 2] = tmp.b;
      }
      tri++;
    };
    for (let iz = 0; iz < Z.length - 1; iz++) {
      const z0 = Z[iz];
      const z1 = Z[iz + 1];
      for (let ix = 0; ix < nx; ix++) {
        const xa = x0 + ix * step;
        const xb = xa + step;
        const h00 = heights[iz][ix];
        const h10 = heights[iz][ix + 1];
        const h01 = heights[iz + 1][ix];
        const h11 = heights[iz + 1][ix + 1];
        const id = (index * 1000 + iz * 100 + ix) * 2;
        // Two triangles, counter-clockwise when seen from above (+Y).
        put(xa, h00, z0); put(xb, h10, z0); put(xb, h11, z1);
        colorTri(xa, h00, z0, xb, h10, z0, xb, h11, z1, id);
        put(xa, h00, z0); put(xb, h11, z1); put(xa, h01, z1);
        colorTri(xa, h00, z0, xb, h11, z1, xa, h01, z1, id + 1);
      }
    }
    const terrain = new THREE.BufferGeometry();
    terrain.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    terrain.setAttribute('color', new THREE.BufferAttribute(col, 3));
    terrain.computeVertexNormals();

    // Scenery baked into the same geometry.
    const r = rng(index * 7919 + this.seed * 31);
    const parts = [terrain];
    const trees = t.scenery === 'desert' ? 5 : 14;
    for (let i = 0; i < trees; i++) {
      const x = x0 + r() * W;
      const z = -7 - r() * 55;
      const s = 0.7 + r() * 0.8 + (-z) * 0.01;
      parts.push(...treeParts(x, this.heightAt(x, z) - 0.2, z, s, t, r()));
    }
    for (let i = 0; i < 3; i++) {
      const x = x0 + r() * W;
      const z = -4 - r() * 40;
      parts.push(...rockParts(x, this.heightAt(x, z), z, 0.5 + r() * 1.2, t.rock));
    }
    if (r() < t.town) {
      const cx = x0 + 8 + r() * (W - 16);
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const x = cx + (i - n / 2) * 4.2 + r();
        const z = -9 - r() * 10;
        const w = 2.5 + r() * 2;
        const h = 2.5 + r() * 5;
        parts.push(...buildingParts(x, this.heightAt(x, z), z, w, h, 2.5 + r() * 2, t, r()));
      }
    }
    const geo = merge(parts);
    const m = new THREE.Mesh(geo, MAT.body);
    m.matrixAutoUpdate = false;
    return m;
  }

  _mountainChunk(index, x0) {
    const t = this.theme;
    const W = 192;
    const step = 12;
    const nx = W / step;
    const Z = MOUNTAIN_Z;
    const s = this.seed + 101;
    const H = (x, z, iz) => {
      const ridge = 1 - Math.abs(fbm2(x * 0.006, z * 0.01, s, 4) * 2 - 1);
      const lift = iz / (Z.length - 1);
      return -25 + ridge * (35 + lift * 55) + lift * 10;
    };
    const base = new THREE.Color(t.mountain);
    const snow = new THREE.Color(t.snowcap);
    const pos = [];
    const col = [];
    const tmp = new THREE.Color();
    for (let iz = 0; iz < Z.length - 1; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const xa = x0 + ix * step;
        const xb = xa + step;
        const z0 = Z[iz];
        const z1 = Z[iz + 1];
        const v = [
          [xa, H(xa, z0, iz), z0], [xb, H(xb, z0, iz), z0],
          [xb, H(xb, z1, iz + 1), z1], [xa, H(xa, z1, iz + 1), z1],
        ];
        for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
          const avg = (v[a][1] + v[b][1] + v[c][1]) / 3;
          tmp.copy(base).multiplyScalar(0.85 + hash1(ix * 13 + iz * 7 + a + index * 997, s) * 0.3);
          if (avg > 38) tmp.lerp(snow, 0.85);
          for (const k of [a, b, c]) {
            pos.push(...v[k]);
            col.push(tmp.r, tmp.g, tmp.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, MAT.body);
    m.matrixAutoUpdate = false;
    return m;
  }

  _cloudChunk(index, x0) {
    const r = rng(index * 4513 + this.seed * 17 + 3);
    const parts = [];
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const g = cloudGeometry(r, this.theme.cloud);
      const s = 0.8 + r() * 1.2;
      g.scale(s, s, s);
      g.translate(x0 + r() * 110, 6 + r() * 38, -25 - r() * 140);
      parts.push(g);
    }
    const geo = merge(parts);
    const m = new THREE.Mesh(geo, this.cloudMat);
    m.matrixAutoUpdate = false;
    return m;
  }

  update(camX, camDist, halfWidthAt) {
    for (const l of this.layers) l.update(camX, halfWidthAt, this.warm ? Infinity : 2);
    this.warm = false;
    // Keep sun and stars parked in the sky relative to the camera.
    const sunX = camX - halfWidthAt(-450) * 0.35;
    this.sunDisc.position.set(sunX, 95, -450);
    this.sunHalo.position.set(sunX, 95, -451);
    if (this.stars) this.stars.position.x = camX * 0.98;
    const fog = this.scene.fog;
    if (fog) {
      fog.near = camDist + 70;
      fog.far = camDist + 430;
    }
  }
}
