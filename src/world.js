// Endless procedurally generated scenery: sky, terrain strip, far mountains, clouds,
// plus per-map features (sea, lava, weather, lightning, searchlights, volcano plumes).
import * as THREE from 'three';
import { fbm1, fbm2, noise1, noise2, hash1, rng } from './noise.js';
import {
  part, merge, MAT, treeParts, buildingParts, rockParts, cloudGeometry, palmParts, hoodooParts,
  deadTreeParts, skyscraperParts, lighthouseParts, shipDecorParts, streetlightParts, volcanoParts,
} from './models.js';
import { MAPS, getMap } from './maps.js';
import { Weather } from './weather.js';

export { MAPS };

export const SEA = -20;
const LAVA = -21.8;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (list, i) => list[((i % list.length) + list.length) % list.length];
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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
    this.theme = MAPS[0];
    this.fx = null;
    this.onLightning = null;
    this.t = 0;

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
    this.weather = new Weather(scene);

    // Animated sea surface (ocean maps).
    const wg = new THREE.PlaneGeometry(900, 480, 90, 32);
    wg.rotateX(-Math.PI / 2);
    wg.translate(0, 0, -200);
    this.waterBase = Float32Array.from(wg.attributes.position.array);
    this.water = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({
      color: 0x1f76a8, flatShading: true, shininess: 90, specular: 0x9ec8e0, transparent: true, opacity: 0.9,
    }));
    this.water.position.y = SEA;
    this.water.frustumCulled = false;
    this.water.visible = false;
    scene.add(this.water);

    // Lava lake surface (volcano maps): terrain dips below it to form pools and rivers.
    const lg = new THREE.PlaneGeometry(900, 140);
    lg.rotateX(-Math.PI / 2);
    lg.translate(0, 0, -40);
    this.lava = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0xff5a1a }));
    this.lava.position.y = LAVA;
    this.lava.frustumCulled = false;
    this.lava.visible = false;
    scene.add(this.lava);

    // Lightning bolt (storm maps).
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xf2f6ff, fog: false }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    scene.add(this.bolt);
    this.flashT = 0;
    this.lightningT = 4;

    // Searchlight beams (night maps).
    const sg = new THREE.ConeGeometry(7, 90, 20, 1, true);
    sg.rotateX(Math.PI);
    sg.translate(0, 45, 0);
    const smat = new THREE.MeshBasicMaterial({
      color: 0xfff1c4, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.searchlights = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(sg, smat);
      m.visible = false;
      m.userData = { x: 0, z: -20, phase: Math.random() * 6, speed: 0.3 + Math.random() * 0.4 };
      scene.add(m);
      this.searchlights.push(m);
    }
  }

  setup(mapIndex, seed) {
    for (const l of this.layers) l.dispose();
    this.layers = [];
    const t = getMap(mapIndex);
    this.theme = t;
    this.seed = seed;
    this.t = 0;

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
    this.sunDisc.visible = this.sunHalo.visible = !t.noSun;

    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars = null;
    }
    if (t.night) this._makeStars();

    // Per-map features
    this.water.visible = t.terrain === 'ocean';
    if (t.water) this.water.material.color.set(t.water);
    this.lava.visible = t.terrain === 'volcano';
    if (t.lava) this.lava.material.color.set(t.lava);
    this.weather.setup(t.weather);
    this.bolt.visible = false;
    this.flashT = 0;
    this.lightningT = 3;
    for (const s of this.searchlights) s.visible = false;
    this.searchlightsPlaced = false;
    if (this.fx) this.fx.water = t.terrain === 'ocean';

    const palette = (list) => list.map((c) => new THREE.Color(c));
    this.cols = {
      ground: palette(t.ground),
      strata: palette(t.strata || t.ground),
      rock: new THREE.Color(t.rock),
      high: new THREE.Color(t.high),
      sand: new THREE.Color(t.sand || t.ground[0]),
      seabed: new THREE.Color(t.seabed || t.rock),
      road: new THREE.Color(t.road || t.rock),
      stripe: new THREE.Color('#d9d2b8'),
    };

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

  // ------------------------------------------------------------ terrain shape

  // Height of the gameplay line (z = 0). Everything that "lands" uses this.
  groundY(x) {
    const s = this.seed;
    switch (this.theme.terrain) {
      case 'ocean':
        return SEA;
      case 'city':
        return -20 + (noise1(x * 0.01, s) - 0.5) * 2;
      case 'canyon':
        return clamp(-20 + (fbm1(x * 0.01, s, 3) - 0.5) * 7 + (noise1(x * 0.08, s + 5) - 0.5) * 1.2, -23, -14);
      case 'volcano':
        return clamp(-19 + (fbm1(x * 0.015, s, 4) - 0.5) * 11 + (noise1(x * 0.1, s + 5) - 0.5) * 2.2, -21.2, -12);
      default: {
        const h = -19.5 + (fbm1(x * 0.012, s, 3) - 0.5) * 10 + (noise1(x * 0.07, s + 5) - 0.5) * 1.6;
        return clamp(h, -23, -12.5);
      }
    }
  }

  groundSlope(x) {
    return Math.atan2(this.groundY(x + 1) - this.groundY(x - 1), 2);
  }

  // Rooftops of the near row of city buildings currently within `range` of camX.
  roofsNear(camX, range) {
    const out = [];
    const ground = this.layers[0];
    if (!ground) return out;
    for (const obj of ground.chunks.values()) {
      for (const r of obj.userData.roofs || []) if (Math.abs(r[0] - camX) < range) out.push(r);
    }
    return out;
  }

  isWater() {
    return this.theme.terrain === 'ocean';
  }

  heightAt(x, z) {
    const T = this.theme.terrain;
    const s = this.seed;
    if (T === 'ocean') {
      if (z > 30) return -160;
      if (z > -6) return SEA - 5;
      const t = -z - 6;
      const m = fbm2(x * 0.014, z * 0.022, s + 11, 4);
      const isl = smoothstep(0.5, 0.62, m);
      return SEA - 5 + isl * (6.5 + m * 6 + t * 0.06);
    }
    let y = this.groundY(x);
    if (z > 4) {
      y -= (z - 4) * 0.2;
      // Steep skirt in front so tall portrait views never see under the world.
      if (z > 30) y -= 140;
      return y;
    }
    if (z >= -4) return y;
    const t = -z - 4;
    switch (T) {
      case 'canyon': {
        const m = fbm2(x * 0.02, z * 0.03, s + 11, 3);
        let lift = t < 8 ? 0 : smoothstep(0.52, 0.6, m) * (3 + t * 0.22);
        if (t > 55) lift = Math.max(lift, (t - 55) * 0.8 + fbm2(x * 0.03, z * 0.05, s + 3, 2) * 8);
        lift = Math.floor(lift / 3.2) * 3.2;
        return y + lift + t * 0.02;
      }
      case 'volcano': {
        const channel = smoothstep(0.42, 0.28, noise2(x * 0.025, z * 0.04, s + 9)) * 5;
        return y + fbm2(x * 0.02, z * 0.035, s + 11) * t * 0.35 + t * 0.02 - channel;
      }
      case 'city':
        return y + t * 0.01;
      default:
        return y + fbm2(x * 0.018, z * 0.035, s + 11) * t * 0.3 + t * 0.03;
    }
  }

  _triColor(out, avgY, avgZ, slope, h) {
    const t = this.theme;
    const c = this.cols;
    switch (t.terrain) {
      case 'canyon': {
        if (slope > 0.9) {
          out.copy(c.ground[Math.floor(h * c.ground.length)]);
        } else {
          const band = Math.floor((avgY + 60) / 2.3);
          out.copy(wrap(c.strata, band)).multiplyScalar(0.9 + h * 0.2);
        }
        return;
      }
      case 'ocean':
        if (avgY < SEA - 0.8) out.copy(c.seabed);
        else if (avgY < SEA + 1.0) out.copy(c.sand).multiplyScalar(0.95 + h * 0.1);
        else if (slope < 0.72) out.copy(c.rock);
        else out.copy(c.ground[Math.floor(h * c.ground.length)]);
        return;
      case 'city':
        if (Math.abs(avgZ) < 5) out.copy(c.road).multiplyScalar(0.92 + h * 0.16);
        else out.copy(c.ground[Math.floor(h * c.ground.length)]);
        return;
      default:
        out.copy(c.ground[Math.floor(h * c.ground.length)]);
        if (avgY > -8) out.lerp(c.high, Math.min(1, (avgY + 8) / 25));
        if (slope < 0.72) out.lerp(c.rock, 0.75);
    }
  }

  // ------------------------------------------------------------ chunks

  _groundChunk(index, x0) {
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
    const tris = nx * (Z.length - 1) * 2;
    const pos = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const tmp = new THREE.Color();
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    let p = 0;
    let tri = 0;
    const put = (x, y, z) => {
      pos[p] = x;
      pos[p + 1] = y;
      pos[p + 2] = z;
      p += 3;
    };
    const colorTri = (ax, ay, az, bx, by, bz, cx, cy, cz, seedI) => {
      va.set(bx - ax, by - ay, bz - az);
      vb.set(cx - ax, cy - ay, cz - az);
      vc.crossVectors(va, vb).normalize();
      this._triColor(tmp, (ay + by + cy) / 3, (az + bz + cz) / 3, Math.abs(vc.y), hash1(seedI, this.seed));
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

    const parts = [terrain];
    const roofs = [];
    this._scenery(parts, index, x0, W, roofs);
    const geo = merge(parts);
    const m = new THREE.Mesh(geo, MAT.body);
    m.matrixAutoUpdate = false;
    m.userData.roofs = roofs;
    return m;
  }

  // Scenery is baked into the same geometry as the terrain chunk.
  _scenery(parts, index, x0, W, roofs = []) {
    const t = this.theme;
    const r = rng(index * 7919 + this.seed * 31);
    const at = (x, z) => this.heightAt(x, z);
    switch (t.scenery) {
      case 'desert': {
        for (let i = 0; i < 6; i++) {
          const x = x0 + r() * W;
          const z = -6 - r() * 40;
          parts.push(...treeParts(x, at(x, z) - 0.2, z, 0.7 + r() * 0.6, t, r()));
        }
        for (let i = 0; i < 5; i++) {
          const x = x0 + r() * W;
          const z = -4 - r() * 40;
          parts.push(...rockParts(x, at(x, z), z, 0.6 + r() * 1.4, t.strata[i % t.strata.length]));
        }
        if (r() < 0.6) {
          const x = x0 + r() * W;
          const z = -9 - r() * 22;
          parts.push(...hoodooParts(x, at(x, z) - 0.3, z, 0.8 + r() * 0.6, t));
        }
        break;
      }
      case 'island': {
        for (let i = 0; i < 26; i++) {
          const x = x0 + r() * W;
          const z = -10 - r() * 70;
          const y = at(x, z);
          if (y > SEA + 0.8) parts.push(...palmParts(x, y - 0.2, z, 0.8 + r() * 0.5, t, r()));
        }
        if (r() < 0.35) {
          for (let k = 0; k < 8; k++) {
            const x = x0 + r() * W;
            const z = -14 - r() * 40;
            if (at(x, z) > SEA + 1.2) {
              parts.push(...lighthouseParts(x, at(x, z) - 0.3, z, 0.9));
              break;
            }
          }
        }
        if (r() < 0.4) {
          const x = x0 + r() * W;
          const z = -40 - r() * 60;
          if (at(x, z) < SEA - 1) parts.push(...shipDecorParts(x, SEA - 0.4, z, 0.9 + r() * 0.4, r()));
        }
        for (let i = 0; i < 3; i++) {
          const x = x0 + r() * W;
          const z = -8 - r() * 30;
          parts.push(...rockParts(x, SEA - 0.6, z, 0.6 + r() * 0.9, t.rock));
        }
        break;
      }
      case 'volcanic': {
        for (let i = 0; i < 7; i++) {
          const x = x0 + r() * W;
          const z = -6 - r() * 50;
          const y = at(x, z);
          if (y > LAVA + 0.4) parts.push(...deadTreeParts(x, y - 0.2, z, 0.8 + r() * 0.6, t.trunk, r()));
        }
        for (let i = 0; i < 6; i++) {
          const x = x0 + r() * W;
          const z = -4 - r() * 45;
          parts.push(...rockParts(x, Math.max(at(x, z), LAVA), z, 0.6 + r() * 1.6, t.rock));
        }
        break;
      }
      case 'city': {
        for (let x = Math.ceil(x0 / 6) * 6; x < x0 + W; x += 6) {
          parts.push(part(new THREE.BoxGeometry(2.2, 0.05, 0.35), '#e8e2c8', [x, at(x, 0) + 0.04, 0]));
        }
        for (let x = Math.ceil(x0 / 12) * 12; x < x0 + W; x += 12) {
          parts.push(...streetlightParts(x, at(x, -5.5), -5.5, t.lit));
        }
        // Near row of mid-rise buildings, far row of towers.
        for (let i = 0; i < 5; i++) {
          const x = x0 + (i + 0.2 + r() * 0.6) * (W / 5);
          const z = -12 - r() * 12;
          const w = 4 + r() * 3;
          const h = 6 + r() * 12;
          const d = 4 + r() * 3;
          parts.push(...skyscraperParts(x, at(x, z), z, w, h, d, t, r(), t.lit));
          // Front edge of the roof: vigilante launch points.
          roofs.push([x, at(x, z) + h - 0.3, z + d / 2]);
        }
        for (let i = 0; i < 5; i++) {
          const x = x0 + (i + 0.1 + r() * 0.8) * (W / 5);
          const z = -38 - r() * 45;
          const w = 5 + r() * 5;
          parts.push(...skyscraperParts(x, at(x, z), z, w, 14 + r() * 22 + (-z - 38) * 0.25, 5 + r() * 4, t, r(), t.lit));
        }
        for (let i = 0; i < 3; i++) {
          const x = x0 + r() * W;
          const z = -6.5 - r() * 3;
          parts.push(...treeParts(x, at(x, z) - 0.2, z, 0.6 + r() * 0.3, t, 0.9));
        }
        break;
      }
      default: {
        // forest / snow
        const trees = 14;
        for (let i = 0; i < trees; i++) {
          const x = x0 + r() * W;
          const z = -7 - r() * 55;
          const s = 0.7 + r() * 0.8 + (-z) * 0.01;
          parts.push(...treeParts(x, at(x, z) - 0.2, z, s, t, r()));
        }
        for (let i = 0; i < 3; i++) {
          const x = x0 + r() * W;
          const z = -4 - r() * 40;
          parts.push(...rockParts(x, at(x, z), z, 0.5 + r() * 1.2, t.rock));
        }
        if (r() < (t.town || 0)) {
          const cx = x0 + 8 + r() * (W - 16);
          const n = 3 + Math.floor(r() * 4);
          for (let i = 0; i < n; i++) {
            const x = cx + (i - n / 2) * 4.2 + r();
            const z = -9 - r() * 10;
            parts.push(...buildingParts(x, at(x, z), z, 2.5 + r() * 2, 2.5 + r() * 5, 2.5 + r() * 2, t, r()));
          }
        }
      }
    }
  }

  _mountainChunk(index, x0) {
    const t = this.theme;
    const W = 192;
    const step = 12;
    const nx = W / step;
    const Z = MOUNTAIN_Z;
    const s = this.seed + 101;
    const amp = { ocean: 0.4, city: 0.55, volcano: 0.7 }[t.terrain] ?? 1;
    const H = (x, z, iz) => {
      const ridge = 1 - Math.abs(fbm2(x * 0.006, z * 0.01, s, 4) * 2 - 1);
      const lift = iz / (Z.length - 1);
      let y = -25 + (ridge * (35 + lift * 55) + lift * 10) * amp;
      if (t.terrain === 'canyon') y = Math.floor(y / 7) * 7;
      return y;
    };
    const base = new THREE.Color(t.mountain);
    const snow = new THREE.Color(t.snowcap);
    const strata = t.strata ? t.strata.map((c) => new THREE.Color(c)) : null;
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
          if (strata) tmp.copy(wrap(strata, Math.floor((avg + 60) / 7)));
          else tmp.copy(base);
          tmp.multiplyScalar(0.85 + hash1(ix * 13 + iz * 7 + a + index * 997, s) * 0.3);
          if (!strata && avg > 38) tmp.lerp(snow, 0.85);
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
    let geo = g;
    const craters = [];
    if (t.terrain === 'volcano') {
      const r = rng(index * 131 + this.seed);
      const x = x0 + 40 + r() * (W - 80);
      const z = -215 - r() * 40;
      const h = 70 + r() * 25;
      craters.push([x, -25 + h, z]);
      geo = merge([g, ...volcanoParts(x, -25, z, 55 + r() * 15, h, t)]);
    }
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, MAT.body);
    m.matrixAutoUpdate = false;
    m.userData.craters = craters;
    return m;
  }

  _cloudChunk(index, x0) {
    const t = this.theme;
    const r = rng(index * 4513 + this.seed * 17 + 3);
    const parts = [];
    const n = Math.max(1, Math.round((t.clouds ?? 2) * (0.4 + r())));
    const low = t.weather === 'rain' ? 0.5 : 1;
    for (let i = 0; i < n; i++) {
      const g = cloudGeometry(r, t.cloud);
      const s = 0.8 + r() * 1.2 + (t.clouds > 3 ? 0.8 : 0);
      g.scale(s, s, s);
      g.translate(x0 + r() * 110, 6 + r() * 38 * low + (low < 1 ? 14 : 0), -25 - r() * 140);
      parts.push(g);
    }
    const geo = merge(parts);
    const m = new THREE.Mesh(geo, this.cloudMat);
    m.matrixAutoUpdate = false;
    return m;
  }

  // ------------------------------------------------------------ per-frame

  update(dt, camX, camDist, halfWidthAt, halfW, halfH) {
    const t = this.theme;
    this.t += dt;
    for (const l of this.layers) l.update(camX, halfWidthAt, this.warm ? Infinity : 2);
    this.warm = false;
    // Keep sun and stars parked in the sky relative to the camera.
    const sunX = camX - halfWidthAt(-450) * 0.35;
    this.sunDisc.position.set(sunX, 95, -450);
    this.sunHalo.position.set(sunX, 95, -451);
    if (this.stars) this.stars.position.x = camX * 0.98;
    const fog = this.scene.fog;
    if (fog) {
      fog.near = camDist + (t.fogNear ?? 70);
      fog.far = camDist + (t.fogFar ?? 430);
    }

    if (this.water.visible) this._updateWater(camX);
    if (this.lava.visible) {
      this.lava.position.x = camX;
      const k = 0.85 + Math.sin(this.t * 2.2) * 0.1 + Math.sin(this.t * 5.3) * 0.05;
      this.lava.material.color.set(t.lava).multiplyScalar(k);
      this._updatePlumes(dt, camX, halfWidthAt);
    }
    this.weather.update(dt, camX, halfW, halfH);
    if (t.lightning) this._updateLightning(dt, camX, halfWidthAt);
    if (t.searchlights) this._updateSearchlights(camX, halfWidthAt);
  }

  _updateWater(camX) {
    const w = this.water;
    w.position.x = Math.round(camX / 10) * 10;
    const pos = w.geometry.attributes.position;
    const a = pos.array;
    const b = this.waterBase;
    const t = this.t;
    const ox = w.position.x;
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i] + ox;
      const z = b[i + 2];
      a[i + 1] = Math.sin(x * 0.12 + t * 1.6) * 0.3 + Math.sin(z * 0.18 + x * 0.05 + t * 1.1) * 0.35;
    }
    pos.needsUpdate = true;
  }

  _updatePlumes(dt, camX, halfWidthAt) {
    if (!this.fx) return;
    for (const obj of this.layers[1].chunks.values()) {
      for (const [x, y, z] of obj.userData.craters) {
        if (Math.abs(x - camX) > halfWidthAt(z) + 40) continue;
        if (Math.random() < dt * 5) this.fx.plume(x, y + 1, z, 3);
      }
    }
  }

  _updateLightning(dt, camX, halfWidthAt) {
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = 3 + Math.random() * 6;
      const z = -60 - Math.random() * 100;
      let x = camX + (Math.random() * 2 - 1) * halfWidthAt(z) * 0.8;
      const ground = this.heightAt(x, z);
      const arr = this.bolt.geometry.attributes.position.array;
      const n = arr.length / 3;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        arr[i * 3] = x;
        arr[i * 3 + 1] = 75 + (ground - 75) * k;
        arr[i * 3 + 2] = z;
        x += (Math.random() - 0.5) * 7;
      }
      this.bolt.geometry.attributes.position.needsUpdate = true;
      this.flashT = 0.35;
      if (this.onLightning) this.onLightning();
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const f = this.flashT;
      this.bolt.visible = f > 0.22 || (f > 0.08 && f < 0.15);
      this.hemi.intensity = this.theme.hemiIntensity + Math.max(0, f) * 7;
    } else {
      this.bolt.visible = false;
      this.hemi.intensity = this.theme.hemiIntensity;
    }
  }

  _updateSearchlights(camX, halfWidthAt) {
    const spacing = 55;
    const lights = this.searchlights;
    if (!this.searchlightsPlaced) {
      lights.forEach((m, i) => {
        m.userData.x = camX - halfWidthAt(-20) + i * spacing + Math.random() * 20;
        m.userData.z = -14 - Math.random() * 30;
        m.visible = true;
      });
      this.searchlightsPlaced = true;
    }
    for (const m of lights) {
      const u = m.userData;
      if (u.x < camX - halfWidthAt(u.z) - 30) {
        u.x += lights.length * spacing;
        u.z = -14 - Math.random() * 30;
      }
      m.position.set(u.x, this.heightAt(u.x, u.z), u.z);
      m.rotation.z = Math.sin(this.t * u.speed + u.phase) * 0.6;
      m.rotation.x = Math.sin(this.t * u.speed * 0.7 + u.phase) * 0.15;
    }
  }
}
