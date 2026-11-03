// Procedural low-poly models. Every static part is baked into one merged,
// vertex-coloured geometry per model so each aircraft is only a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const PI = Math.PI;
const HALF = PI / 2;

export const MAT = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  glow: new THREE.MeshBasicMaterial({
    color: 0xffa347,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  burnt: new THREE.MeshLambertMaterial({ color: 0x1c1a18 }),
  glowBlue: new THREE.MeshBasicMaterial({
    color: 0x7fd4ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
};

// Bake a primitive into a non-indexed, flat-shaded, vertex-coloured geometry.
export function part(geo, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.clearGroups();
  _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(_m);
  g.computeVertexNormals();
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// Extruded flat shape centred on z; points are [x, y].
export function slab(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// A shape lying in the XZ plane (points are [x, z]) - used for wings.
function wing(points, depth, color, y = 0) {
  return part(slab(points, depth), color, [0, y, 0], [HALF, 0, 0]);
}

const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sphere = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const ALONG_X = [0, 0, -HALF]; // cylinder/cone axis +Y -> +X
const ALONG_NX = [0, 0, HALF]; // cylinder/cone axis +Y -> -X

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

export function mesh(geo, mat = MAT.body) {
  const m = new THREE.Mesh(geo, mat);
  m.matrixAutoUpdate = true;
  return m;
}

// ---------------------------------------------------------------- aircraft

const PALETTES = {
  player: { body: '#a9bccb', dark: '#34465a', wing: '#8aa0b3', glass: '#1f3346', accent: '#e8a33d' },
  fighter: { body: '#8a4b43', dark: '#3a2522', wing: '#6d3a34', glass: '#221a1a', accent: '#d9d1b8' },
  dart: { body: '#2e2f33', dark: '#141517', wing: '#3b3d42', glass: '#b23a2a', accent: '#e6c229' },
  ace: { body: '#9c1f1f', dark: '#151515', wing: '#7a1616', glass: '#e0b020', accent: '#f2f2f2' },
};

function jetGeometry(pal) {
  const P = [];
  P.push(part(cyl(0.42, 0.6, 3.8), pal.body, [0, 0, 0], ALONG_X));
  P.push(part(cone(0.42, 1.4), pal.body, [2.6, 0, 0], ALONG_X));
  P.push(part(cone(0.16, 0.5), pal.dark, [3.35, 0, 0], ALONG_X));
  P.push(part(sphere(0.5), pal.glass, [1.05, 0.38, 0], [0, 0, 0], [1.7, 0.75, 0.72]));
  P.push(wing([[0.9, 0], [-1.1, 2.9], [-1.8, 2.9], [-1.5, 0], [-1.8, -2.9], [-1.1, -2.9]], 0.14, pal.wing, -0.18));
  P.push(wing([[-1.4, 0], [-2.3, 1.35], [-2.75, 1.35], [-2.5, 0], [-2.75, -1.35], [-2.3, -1.35]], 0.1, pal.wing, 0.05));
  P.push(part(slab([[-0.8, 0.3], [-1.95, 1.9], [-2.5, 1.9], [-2.3, 0.3]], 0.12), pal.dark));
  P.push(part(box(0.35, 0.12, 0.13), pal.accent, [-2.2, 1.75, 0]));
  P.push(part(cyl(0.45, 0.5, 0.35), pal.dark, [-2.05, 0, 0], ALONG_X));
  P.push(part(box(1.3, 0.42, 0.28), pal.dark, [0.25, -0.12, 0.5]));
  P.push(part(box(1.3, 0.42, 0.28), pal.dark, [0.25, -0.12, -0.5]));
  P.push(part(box(0.9, 0.08, 0.9), pal.accent, [-0.6, 0.02, 0], [0, 0, 0], [1, 1, 1.25]));
  return merge(P);
}

// Aircraft built facing +X. `facing` -1 rotates the model to face -X.
function buildJet(pal, facing, scale = 1) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(scale);
  if (facing < 0) model.rotation.y = PI;
  root.add(model);
  const body = mesh(cached('jet:' + pal.body, () => jetGeometry(pal)));
  model.add(body);
  const flame = new THREE.Mesh(flameGeometry(), MAT.glow);
  flame.position.x = -2.2;
  model.add(flame);
  root.userData.flame = flame;
  root.userData.meshes = [body];
  return root;
}

// ---------------------------------------------------------------- player aircraft

const FLAME_MATS = { orange: MAT.glow, blue: MAT.glowBlue };
MAT.glowGreen = new THREE.MeshBasicMaterial({
  color: 0x6dffc0,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
FLAME_MATS.green = MAT.glowGreen;

function flameGeometry() {
  return cached('flame', () => {
    const g = cone(0.36, 1.6, 8);
    g.rotateZ(HALF);
    g.translate(-0.8, 0, 0);
    return g;
  });
}

const PLANE_BUILDERS = {
  hawk: () => ({ geo: jetGeometry(PALETTES.player), flames: [[-2.2, 0, 0, 1]] }),

  viper: () => {
    const c = { body: '#dfe3e8', dark: '#2b2f36', wing: '#c9ced6', glass: '#1d2c3c', red: '#c8352b' };
    const P = [];
    P.push(part(cyl(0.36, 0.5, 4.4), c.body, [0, 0, 0], ALONG_X));
    P.push(part(cone(0.36, 1.9), c.body, [3.15, 0, 0], ALONG_X));
    P.push(part(cone(0.12, 0.5), c.dark, [4.2, 0, 0], ALONG_X));
    P.push(part(sphere(0.45), c.glass, [1.7, 0.36, 0], [0, 0, 0], [2.0, 0.8, 0.75]));
    P.push(part(box(1.6, 0.45, 0.7), c.dark, [0.6, -0.42, 0]));
    P.push(wing([[0.9, 0], [-1.3, 2.7], [-1.8, 2.7], [-1.7, 0], [-1.8, -2.7], [-1.3, -2.7]], 0.12, c.wing, -0.1));
    P.push(wing([[2.3, 0], [1.6, 0.9], [1.3, 0.9], [1.4, 0], [1.3, -0.9], [1.6, -0.9]], 0.08, c.red, 0.0));
    P.push(wing([[-1.7, 0], [-2.5, 1.4], [-2.9, 1.4], [-2.7, 0], [-2.9, -1.4], [-2.5, -1.4]], 0.1, c.wing, 0));
    P.push(part(slab([[-0.9, 0.3], [-2.2, 2.2], [-2.75, 2.2], [-2.5, 0.3]], 0.12), c.body));
    P.push(part(slab([[-1.4, 1.2], [-2.35, 2.2], [-2.75, 2.2], [-2.55, 1.2]], 0.14), c.red));
    P.push(part(box(2.2, 0.1, 0.15), c.red, [0.3, 0.05, 0.4]));
    P.push(part(box(2.2, 0.1, 0.15), c.red, [0.3, 0.05, -0.4]));
    P.push(part(cyl(0.4, 0.46, 0.35), c.dark, [-2.35, 0, 0], ALONG_X));
    return { geo: merge(P), flames: [[-2.5, 0, 0, 1]] };
  },

  thunder: () => {
    const c = { body: '#7b8671', dark: '#3b4236', wing: '#6f7a66', glass: '#1f2a2a', nose: '#2a2d28', stripe: '#d9b44a' };
    const P = [];
    P.push(part(cyl(0.55, 0.62, 4.8, 10), c.body, [0, 0, 0], ALONG_X));
    P.push(part(sphere(0.55, 10, 8), c.body, [2.4, 0, 0], [0, 0, 0], [1.3, 1, 1]));
    P.push(part(cyl(0.12, 0.12, 0.9, 6), c.nose, [3.35, -0.15, 0], ALONG_X));
    P.push(part(sphere(0.45), c.glass, [1.9, 0.5, 0], [0, 0, 0], [1.3, 0.75, 0.8]));
    P.push(wing([[0.6, 0], [0.3, 4.4], [-0.8, 4.4], [-0.8, 0], [-0.8, -4.4], [0.3, -4.4]], 0.18, c.wing, -0.35));
    for (const z of [-2.2, -1.2, 1.2, 2.2]) P.push(part(cyl(0.16, 0.16, 1.1, 6), c.dark, [0.1, -0.7, z], ALONG_X));
    for (const z of [-0.95, 0.95]) {
      P.push(part(cyl(0.42, 0.42, 1.8, 10), c.dark, [-1.3, 0.75, z], ALONG_X));
      P.push(part(box(0.6, 0.35, 0.18), c.dark, [-1.2, 0.45, z * 0.7]));
    }
    P.push(wing([[-2.2, 0], [-2.35, 1.8], [-3.1, 1.8], [-3.1, 0], [-3.1, -1.8], [-2.35, -1.8]], 0.12, c.wing, 0.2));
    for (const z of [-1.75, 1.75]) P.push(part(slab([[-2.5, -0.3], [-2.6, 1.6], [-3.3, 1.6], [-3.2, -0.3]], 0.12), c.body, [0, 0.2, z]));
    P.push(part(box(1.2, 0.08, 1.14), c.stripe, [0.8, 0.02, 0]));
    return { geo: merge(P), flames: [[-2.2, 0.75, 0.95, 0.85], [-2.2, 0.75, -0.95, 0.85]] };
  },

  raptor: () => {
    const c = { body: '#66717c', dark: '#3a424b', wing: '#5d6873', glass: '#b8922a' };
    const P = [];
    P.push(part(cyl(0.45, 0.62, 4.2, 6), c.body, [0, 0, 0], ALONG_X, [1, 1, 1.35]));
    P.push(part(cone(0.45, 1.8, 6), c.body, [3.0, 0, 0], ALONG_X, [1, 1, 1.35]));
    P.push(part(sphere(0.46, 8, 6), c.glass, [1.8, 0.42, 0], [0, 0, 0], [1.9, 0.7, 0.8]));
    P.push(wing([[1.2, 0], [-1.2, 3.1], [-2.0, 3.1], [-1.7, 1.0], [-2.3, 0], [-1.7, -1.0], [-2.0, -3.1], [-1.2, -3.1]], 0.14, c.wing, -0.08));
    P.push(wing([[-2.0, 0], [-2.8, 1.7], [-3.4, 1.7], [-3.1, 0], [-3.4, -1.7], [-2.8, -1.7]], 0.1, c.wing, 0));
    for (const z of [-0.75, 0.75]) {
      P.push(part(slab([[-1.4, 0.2], [-2.4, 1.7], [-3.0, 1.7], [-2.8, 0.2]], 0.1), c.dark, [0, 0.1, z], [z > 0 ? 0.35 : -0.35, 0, 0]));
      P.push(part(box(0.8, 0.26, 0.4), c.dark, [-2.35, 0, z * 0.6]));
    }
    P.push(part(box(1.4, 0.38, 0.4), c.dark, [0.9, -0.2, 0.55]));
    P.push(part(box(1.4, 0.38, 0.4), c.dark, [0.9, -0.2, -0.55]));
    return { geo: merge(P), flames: [[-2.7, 0, 0.45, 0.8], [-2.7, 0, -0.45, 0.8]] };
  },

  specter: () => {
    const c = { body: '#2d3f63', dark: '#161f33', wing: '#34497a', glass: '#35d6ff', glow: '#35d6ff' };
    const P = [];
    P.push(part(cyl(0.4, 0.62, 4.6, 8), c.body, [0, 0, 0], ALONG_X));
    P.push(part(cone(0.4, 2.0, 8), c.body, [3.3, 0, 0], ALONG_X));
    P.push(part(sphere(0.45), c.glass, [2.0, 0.4, 0], [0, 0, 0], [2.0, 0.72, 0.75]));
    // Forward-swept main wing
    P.push(wing([[-0.3, 0], [1.0, 3.4], [0.35, 3.5], [-2.0, 0.7], [-2.0, -0.7], [0.35, -3.5], [1.0, -3.4]], 0.14, c.wing, -0.1));
    P.push(wing([[2.5, 0], [1.9, 1.2], [1.5, 1.2], [1.6, 0], [1.5, -1.2], [1.9, -1.2]], 0.08, c.wing, 0.05));
    P.push(wing([[-2.1, 0], [-2.9, 1.6], [-3.4, 1.6], [-3.1, 0], [-3.4, -1.6], [-2.9, -1.6]], 0.1, c.wing, 0));
    for (const z of [-0.7, 0.7]) P.push(part(slab([[-1.3, 0.25], [-2.5, 1.9], [-3.1, 1.9], [-2.8, 0.25]], 0.1), c.dark, [0, 0.1, z], [z > 0 ? 0.3 : -0.3, 0, 0]));
    P.push(part(box(3.4, 0.07, 0.08), c.glow, [0.5, 0.2, 0.52]));
    P.push(part(box(3.4, 0.07, 0.08), c.glow, [0.5, 0.2, -0.52]));
    for (const z of [-0.42, 0.42]) P.push(part(cyl(0.34, 0.4, 0.4, 8), c.dark, [-2.45, 0, z], ALONG_X));
    return { geo: merge(P), flames: [[-2.65, 0, 0.42, 0.85], [-2.65, 0, -0.42, 0.85]] };
  },

  nova: () => {
    const c = { body: '#eef2f5', dark: '#2a2f38', wing: '#dde3ea', glass: '#1a2b3a', gold: '#e3b341', glow: '#6dffc0' };
    const P = [];
    P.push(part(cyl(0.32, 0.55, 5.0, 10), c.body, [0, 0, 0], ALONG_X));
    P.push(part(cone(0.32, 2.4, 10), c.body, [3.7, 0, 0], ALONG_X));
    P.push(part(cone(0.1, 0.6, 6), c.gold, [5.1, 0, 0], ALONG_X));
    P.push(part(sphere(0.42), c.glass, [2.3, 0.33, 0], [0, 0, 0], [2.3, 0.7, 0.7]));
    P.push(wing([[1.8, 0], [-0.6, 1.6], [-1.6, 3.6], [-2.4, 3.6], [-2.3, 0], [-2.4, -3.6], [-1.6, -3.6], [-0.6, -1.6]], 0.12, c.wing, -0.12));
    for (const z of [-1.35, 1.35]) {
      P.push(part(cyl(0.34, 0.4, 3.0, 10), c.dark, [-1.1, -0.1, z], ALONG_X));
      P.push(part(cone(0.34, 0.8, 10), c.gold, [0.8, -0.1, z], ALONG_X));
      P.push(part(slab([[-1.7, 0.2], [-2.3, 1.4], [-2.8, 1.4], [-2.6, 0.2]], 0.08), c.gold, [0, 0, z]));
      P.push(part(box(2.6, 0.06, 0.06), c.glow, [-1.1, -0.1, z + (z > 0 ? 0.36 : -0.36)]));
    }
    P.push(part(box(2.8, 0.06, 0.08), c.glow, [0.8, 0.28, 0]));
    P.push(part(cyl(0.44, 0.5, 0.35, 10), c.dark, [-2.55, 0, 0], ALONG_X));
    return { geo: merge(P), flames: [[-2.7, 0, 0, 1], [-2.6, -0.1, 1.35, 0.9], [-2.6, -0.1, -1.35, 0.9]] };
  },
};

// Player aircraft facing +X. userData.flames holds the afterburner meshes.
export function createPlaneModel(id, flameType = 'orange') {
  const build = PLANE_BUILDERS[id] || PLANE_BUILDERS.hawk;
  const spec = cached('plane:' + id, build);
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const body = mesh(spec.geo);
  model.add(body);
  const flames = spec.flames.map(([x, y, z, s]) => {
    const f = new THREE.Mesh(flameGeometry(), FLAME_MATS[flameType] || MAT.glow);
    f.position.set(x, y, z);
    f.scale.setScalar(s);
    f.userData.baseScale = s;
    model.add(f);
    return f;
  });
  root.userData.flames = flames;
  root.userData.flame = flames[0];
  root.userData.meshes = [body];
  return root;
}

export function createFighter(facing = -1) {
  return buildJet(PALETTES.fighter, facing, 0.95);
}

export function createDart() {
  const g = buildJet(PALETTES.dart, 1, 0.8);
  g.children[0].scale.set(0.88, 0.62, 0.62);
  return g;
}

export function createHelicopter() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI;
  root.add(model);
  const olive = '#56643a';
  const dark = '#2d3420';
  const geo = cached('heli', () => {
    const P = [];
    P.push(part(sphere(1.2, 10, 8), olive, [0, 0, 0], [0, 0, 0], [1.55, 1, 0.95]));
    P.push(part(sphere(0.8), '#1d2b36', [1.25, 0.15, 0], [0, 0, 0], [1, 0.85, 0.8]));
    P.push(part(cyl(0.18, 0.45, 3.8, 6), olive, [-3.0, 0.25, 0], ALONG_NX));
    P.push(part(slab([[-4.4, 0], [-5.0, 1.4], [-5.35, 1.4], [-5.0, 0]], 0.12), dark, [0, 0.2, 0]));
    P.push(part(box(0.9, 0.08, 1.4), dark, [-4.6, 0.35, 0]));
    P.push(part(box(3.3, 0.12, 0.12), dark, [0, -1.45, 0.75]));
    P.push(part(box(3.3, 0.12, 0.12), dark, [0, -1.45, -0.75]));
    for (const x of [-0.8, 0.8]) for (const z of [-0.75, 0.75]) P.push(part(box(0.1, 0.5, 0.1), dark, [x, -1.2, z]));
    P.push(part(cyl(0.14, 0.16, 0.5, 6), dark, [0, 1.3, 0]));
    P.push(part(box(0.6, 0.12, 3.0), olive, [0, -0.35, 0]));
    for (const z of [-1.45, 1.45]) P.push(part(cyl(0.2, 0.2, 1.3, 6), dark, [0.1, -0.5, z], ALONG_X));
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  const rotor = mesh(cached('heli:rotor', () => merge([
    part(box(7, 0.05, 0.32), '#1c1f16'),
    part(box(0.32, 0.05, 7), '#1c1f16'),
  ])));
  rotor.position.set(0, 1.55, 0);
  model.add(rotor);
  const tail = mesh(cached('heli:tail', () => merge([
    part(box(0.12, 1.5, 0.08), '#1c1f16'),
    part(box(1.5, 0.12, 0.08), '#1c1f16'),
  ])));
  tail.position.set(-5.05, 0.9, 0.2);
  model.add(tail);
  root.userData.model = model;
  root.userData.rotor = rotor;
  root.userData.tailRotor = tail;
  root.userData.meshes = [body, rotor, tail];
  return root;
}

export function createBomber() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = 0.3;
  root.add(model);
  const hull = '#59614e';
  const dark = '#2c3127';
  const geo = cached('bomber', () => {
    const P = [];
    P.push(part(cyl(0.75, 1.35, 11, 10), hull, [0, 0, 0], ALONG_NX));
    P.push(part(sphere(1.35, 10, 8), hull, [5.4, 0, 0], [0, 0, 0], [1.5, 1, 1]));
    P.push(part(sphere(0.9, 8, 6), '#1e2c38', [6.6, 0.35, 0], [0, 0, 0], [1, 0.7, 0.9]));
    P.push(wing([[1.8, 0], [-0.6, 8.5], [-2.2, 8.5], [-2.4, 0], [-2.2, -8.5], [-0.6, -8.5]], 0.3, hull, -0.3));
    for (const z of [-5.2, -2.8, 2.8, 5.2]) {
      P.push(part(cyl(0.45, 0.55, 2.6, 8), dark, [0.6, -0.55, z], ALONG_X));
      P.push(part(cone(0.3, 0.6, 8), '#8b7a55', [2.1, -0.55, z], ALONG_X));
    }
    P.push(part(slab([[-3.6, 0.6], [-5.6, 3.9], [-6.7, 3.9], [-6.3, 0.6]], 0.2), hull));
    P.push(wing([[-4.8, 0], [-5.9, 3.2], [-6.7, 3.2], [-6.5, 0], [-6.7, -3.2], [-5.9, -3.2]], 0.16, hull, 0.4));
    P.push(part(box(3, 0.2, 2.8), '#c9b87a', [1, 0.05, 0], [0, 0, 0], [1, 1, 1]));
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  // Belly bomb bay: lit red while the doors are open.
  const bayLight = new THREE.Mesh(cached('bomber:bay', () => new THREE.BoxGeometry(3.4, 0.3, 1.3)), glowMat(0xff3020, 0));
  bayLight.position.set(1.0, -1.15, 0);
  model.add(bayLight);
  root.userData.bayLight = bayLight;
  root.userData.meshes = [body];
  root.userData.turrets = [
    makeTurret(model, [1.6, 1.3, 0], 0.6),
    makeTurret(model, [-1.8, -1.35, 0], 0.6),
  ];
  return root;
}

function turretGeometry() {
  return cached('turret', () => merge([
    part(sphere(1, 8, 5), '#3a3f35', [0, 0, 0], [0, 0, 0], [1, 0.8, 1]),
  ]));
}

function barrelGeometry(twin) {
  return cached('barrel:' + twin, () => {
    const P = [];
    if (twin) {
      P.push(part(cyl(0.1, 0.12, 2.4, 6), '#1c1e1a', [1.2, 0, 0.22], ALONG_X));
      P.push(part(cyl(0.1, 0.12, 2.4, 6), '#1c1e1a', [1.2, 0, -0.22], ALONG_X));
    } else {
      P.push(part(cyl(0.13, 0.15, 2.2, 6), '#1c1e1a', [1.1, 0, 0], ALONG_X));
    }
    return merge(P);
  });
}

// Turret with an aimable barrel pivot. Barrel angle is in world space.
function makeTurret(parent, pos, scale, twin = true) {
  const t = new THREE.Group();
  t.position.set(pos[0], pos[1], pos[2]);
  t.scale.setScalar(scale);
  const base = mesh(turretGeometry());
  t.add(base);
  const pivot = new THREE.Group();
  const barrel = mesh(barrelGeometry(twin));
  pivot.add(barrel);
  t.add(pivot);
  parent.add(t);
  return { group: t, pivot, meshes: [base, barrel] };
}

export function createAirship() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI;
  model.rotation.x = -0.12;
  root.add(model);
  const skin = '#7c7564';
  const band = '#4a463c';
  const dark = '#2b2a26';
  const geo = cached('airship', () => {
    const P = [];
    P.push(part(sphere(1, 22, 12), skin, [0, 0, 0], [0, 0, 0], [15, 4.6, 4.6]));
    for (const x of [-9, -3, 3, 9]) {
      const rx = 4.6 * Math.sqrt(Math.max(0, 1 - (x / 15) ** 2));
      P.push(part(new THREE.TorusGeometry(rx + 0.05, 0.16, 5, 22), band, [x, 0, 0], [0, HALF, 0]));
    }
    P.push(part(sphere(1.2, 8, 6), '#9a2f25', [-14.8, 0, 0], [0, 0, 0], [0.6, 1, 1]));
    P.push(part(box(10, 1.9, 2.6), dark, [-1, -5.4, 0]));
    P.push(part(box(8.4, 0.45, 2.7), '#e3b24a', [-1.2, -5.1, 0]));
    P.push(part(cone(1.3, 2.2, 6), dark, [-7.1, -5.4, 0], ALONG_NX, [1, 1, 1.3]));
    for (const x of [-4, 2]) P.push(part(box(0.35, 1.4, 0.35), dark, [x, -4.2, 0]));
    P.push(part(slab([[9, 1.8], [14.6, 6.8], [16.3, 6.8], [15.2, 1.8]], 0.4), band));
    P.push(part(slab([[9, -1.8], [15.2, -1.8], [16.3, -6.8], [14.6, -6.8]], 0.4), band));
    P.push(wing([[9, 0], [14.6, 6.4], [16.3, 6.4], [15.2, 0], [16.3, -6.4], [14.6, -6.4]], 0.4, band));
    for (const z of [-4.6, 4.6]) P.push(part(cyl(0.7, 0.9, 3.2, 8), dark, [4, -2.6, z], ALONG_X));
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  const propGeo = cached('prop', () => merge([
    part(box(0.12, 4.2, 0.4), '#1b1a17'),
    part(box(0.12, 0.4, 4.2), '#1b1a17'),
  ]));
  const props = [];
  for (const z of [-4.6, 4.6]) {
    const p = mesh(propGeo);
    p.position.set(5.8, -2.6, z);
    model.add(p);
    props.push(p);
  }
  const turrets = [
    makeTurret(model, [-4.5, -6.5, -0.4], 0.8),
    makeTurret(model, [2.5, -6.5, -0.4], 0.8),
    makeTurret(model, [-7, 4.1, -0.6], 0.9),
    makeTurret(model, [5, 4.1, -0.6], 0.9),
  ];
  // Hangar under the gondola: lit while the bay is open to launch interceptors.
  const hangarLight = new THREE.Mesh(cached('airship:hangar', () => new THREE.BoxGeometry(5, 0.4, 2.2)), glowMat(0xffa040, 0));
  hangarLight.position.set(-1.2, -6.45, 0);
  model.add(hangarLight);
  root.userData.hangarLight = hangarLight;
  root.userData.props = props;
  root.userData.turrets = turrets;
  root.userData.meshes = [body, ...props, ...turrets.flatMap((t) => t.meshes)];
  return root;
}

// ---------------------------------------------------------------- ground

export function createTank() {
  const root = new THREE.Group();
  const hull = '#5d6340';
  const dark = '#2a2d1f';
  const geo = cached('tank', () => merge([
    part(box(3.6, 0.8, 2.1), hull, [0, 0.85, 0]),
    part(box(0.9, 0.6, 2.1), hull, [-1.9, 0.75, 0], [0, 0, 0.6]),
    part(box(3.9, 0.7, 0.55), dark, [0, 0.4, 1.0]),
    part(box(3.9, 0.7, 0.55), dark, [0, 0.4, -1.0]),
    part(cyl(0.85, 1.0, 0.6, 8), hull, [0.2, 1.55, 0]),
    part(box(0.5, 0.25, 0.5), dark, [0.5, 1.95, 0.3]),
  ]));
  const body = mesh(geo);
  root.add(body);
  const pivot = new THREE.Group();
  pivot.position.set(0.2, 1.6, 0);
  const barrel = mesh(barrelGeometry(false));
  barrel.scale.setScalar(1.1);
  pivot.add(barrel);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.meshes = [body, barrel];
  return root;
}

export function createFlak() {
  const root = new THREE.Group();
  const geo = cached('flak', () => merge([
    part(cyl(1.6, 1.9, 0.7, 8), '#8f8158', [0, 0.35, 0]),
    part(cyl(0.6, 0.8, 1.0, 8), '#3d4233', [0, 1.1, 0]),
    part(box(1.2, 1.1, 0.25), '#4a503d', [0, 1.5, 0.85]),
  ]));
  const body = mesh(geo);
  root.add(body);
  const pivot = new THREE.Group();
  pivot.position.set(0, 1.6, 0);
  const barrel = mesh(barrelGeometry(true));
  barrel.scale.set(1.4, 1.1, 1.1);
  pivot.add(barrel);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.meshes = [body, barrel];
  return root;
}

// ---------------------------------------------------------------- ordnance

export function createMissile(enemy = false) {
  const geo = cached('missile:' + enemy, () => merge([
    part(cyl(0.13, 0.13, 1.3, 6), enemy ? '#5a2320' : '#e6e6e0', [0, 0, 0], ALONG_X),
    part(cone(0.13, 0.4, 6), enemy ? '#1c1c1c' : '#c0392b', [0.85, 0, 0], ALONG_X),
    part(box(0.35, 0.5, 0.05), '#555', [-0.5, 0, 0]),
    part(box(0.35, 0.05, 0.5), '#555', [-0.5, 0, 0]),
  ]));
  const g = new THREE.Group();
  g.add(mesh(geo));
  const flame = new THREE.Mesh(cached('mflame', () => {
    const c = cone(0.12, 0.7, 6);
    c.rotateZ(HALF);
    c.translate(-1.0, 0, 0);
    return c;
  }), MAT.glow);
  g.add(flame);
  return g;
}

// Player bombs are olive with a yellow band; enemy bombs are gunmetal with a red band
// (each boss scales them to its own size).
export function createBomb(enemy = false) {
  const geo = cached('bomb:' + enemy, () => merge([
    part(sphere(0.35, 8, 6), enemy ? '#33363a' : '#3e4a2c', [0, 0, 0], [0, 0, 0], [2, 1, 1]),
    part(box(0.35, 0.6, 0.06), enemy ? '#1b1c1e' : '#2a3120', [-0.75, 0, 0]),
    part(box(0.35, 0.06, 0.6), enemy ? '#1b1c1e' : '#2a3120', [-0.75, 0, 0]),
    part(box(0.12, 0.72, 0.72), enemy ? '#c0392b' : '#d0b050', [0.1, 0, 0]),
  ]));
  const g = new THREE.Group();
  g.add(mesh(geo));
  return g;
}

// ---------------------------------------------------------------- pickups

export function createPickup(kind) {
  const geo = cached('pickup:' + kind, () => {
    if (kind === 'coin') {
      return merge([
        part(cyl(0.85, 0.85, 0.22, 12), '#e7b93b', [0, 0, 0], [HALF, 0, 0]),
        part(cyl(0.55, 0.55, 0.26, 12), '#f6d56b', [0, 0, 0], [HALF, 0, 0]),
      ]);
    }
    if (kind === 'health') {
      return merge([
        part(box(1.5, 1.5, 1.5), '#2f9e55'),
        part(box(0.95, 0.3, 1.56), '#ffffff'),
        part(box(0.3, 0.95, 1.56), '#ffffff'),
        part(box(1.56, 0.3, 0.95), '#ffffff'),
        part(box(1.56, 0.95, 0.3), '#ffffff'),
      ]);
    }
    return merge([
      part(box(1.6, 1.2, 1.2), '#5e6b35'),
      part(box(1.66, 0.3, 1.26), '#e8c440'),
      part(box(0.2, 1.26, 1.26), '#3c4422', [0.5, 0, 0]),
      part(box(0.2, 1.26, 1.26), '#3c4422', [-0.5, 0, 0]),
    ]);
  });
  const g = new THREE.Group();
  g.add(mesh(geo));
  return g;
}

// ---------------------------------------------------------------- scenery parts

export function treeParts(x, y, z, s, theme, variant) {
  if (theme.scenery === 'desert') {
    const c = theme.tree;
    return [
      part(cyl(0.3, 0.35, 3.2, 6), c, [x, y + 1.6 * s, z], [0, 0, 0], [s, s, s]),
      part(cyl(0.2, 0.22, 1.2, 6), c, [x + 0.55 * s, y + 2.0 * s, z], [0, 0, -0.9], [s, s, s]),
      part(cyl(0.2, 0.22, 1.0, 6), c, [x - 0.5 * s, y + 1.5 * s, z], [0, 0, 0.9], [s, s, s]),
    ];
  }
  const trunk = part(cyl(0.2, 0.28, 1.2, 5), theme.trunk, [x, y + 0.6 * s, z], [0, 0, 0], [s, s, s]);
  if (variant < 0.5 || theme.scenery === 'snow') {
    const parts = [trunk, part(cone(1.3, 3.2, 6), theme.tree, [x, y + 2.6 * s, z], [0, variant * 3, 0], [s, s, s])];
    if (theme.scenery === 'snow') parts.push(part(cone(0.7, 1.3, 6), '#f2f6fa', [x, y + 3.6 * s, z], [0, variant * 3, 0], [s, s, s]));
    return parts;
  }
  return [trunk, part(new THREE.IcosahedronGeometry(1.4, 0), theme.tree2 || theme.tree, [x, y + 2.2 * s, z], [variant, variant * 2, 0], [s, s * 0.9, s])];
}

export function buildingParts(x, y, z, w, h, d, theme, v) {
  const walls = theme.buildings[Math.floor(v * theme.buildings.length) % theme.buildings.length];
  const parts = [
    part(box(w, h, d), walls, [x, y + h / 2 - 0.5, z]),
    part(box(w + 0.3, 0.35, d + 0.3), '#3b3a38', [x, y + h - 0.35, z]),
  ];
  const rows = Math.max(1, Math.floor(h / 1.6));
  for (let r = 0; r < rows; r++) {
    parts.push(part(box(w * 0.8, 0.35, 0.05), theme.windows, [x, y + 0.6 + r * 1.5, z + d / 2 + 0.03]));
  }
  return parts;
}

export function rockParts(x, y, z, s, color) {
  return [part(new THREE.DodecahedronGeometry(1, 0), color, [x, y + 0.3 * s, z], [s, s * 2, 0], [s * 1.3, s * 0.8, s])];
}

export function cloudGeometry(seedFn, color) {
  const P = [];
  const n = 4 + Math.floor(seedFn() * 4);
  const len = 6 + seedFn() * 10;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const r = 2.2 + seedFn() * 2.8 * Math.sin(t * PI + 0.3);
    P.push(part(new THREE.IcosahedronGeometry(r, 1), color, [(t - 0.5) * len, (seedFn() - 0.3) * 1.5, (seedFn() - 0.5) * 3], [seedFn(), seedFn(), 0], [1.2, 0.75, 1]));
  }
  return merge(P);
}

// ---------------------------------------------------------------- naval & hazards

// Gunboat facing -X. Waterline at y = 0.
export function createGunboat() {
  const root = new THREE.Group();
  const hull = '#6d7a86';
  const dark = '#343c44';
  const geo = cached('gunboat', () => merge([
    part(box(4.6, 1.0, 1.7), hull, [0.3, 0.2, 0]),
    part(cone(0.85, 1.6, 4), hull, [-2.8, 0.2, 0], [HALF, 0, HALF], [1, 1, 0.75]),
    part(box(4.8, 0.2, 1.8), '#8a3a32', [0.2, -0.25, 0]),
    part(box(1.6, 0.9, 1.2), '#aab4bc', [0.9, 1.1, 0]),
    part(box(1.0, 0.25, 1.25), dark, [0.9, 1.45, 0]),
    part(cyl(0.06, 0.06, 1.6, 4), dark, [1.3, 2.1, 0]),
    part(cyl(0.45, 0.55, 0.4, 8), dark, [-1.2, 0.9, 0]),
  ]));
  const body = mesh(geo);
  root.add(body);
  const pivot = new THREE.Group();
  pivot.position.set(-1.2, 1.1, 0);
  const barrel = mesh(barrelGeometry(false));
  barrel.scale.set(0.9, 0.8, 0.8);
  pivot.add(barrel);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.meshes = [body, barrel];
  return root;
}

// Anti-aircraft corvette facing -X.
export function createAAShip() {
  const root = new THREE.Group();
  const hull = '#5f6b75';
  const dark = '#2e353c';
  const geo = cached('aaship', () => merge([
    part(box(6.4, 1.1, 2.0), hull, [0.4, 0.25, 0]),
    part(cone(1.0, 2.0, 4), hull, [-3.9, 0.25, 0], [HALF, 0, HALF], [1, 1, 0.75]),
    part(box(6.6, 0.22, 2.1), '#7a3029', [0.3, -0.25, 0]),
    part(box(2.2, 1.3, 1.5), '#9aa5ae', [1.4, 1.4, 0]),
    part(box(1.4, 0.35, 1.55), dark, [1.4, 1.9, 0]),
    part(cyl(0.08, 0.1, 2.6, 4), dark, [1.9, 3.0, 0]),
    part(box(0.12, 0.12, 1.4), dark, [1.9, 3.6, 0]),
    part(cyl(0.3, 0.4, 0.8, 8), dark, [3.1, 1.2, 0]),
    part(cyl(0.7, 0.8, 0.5, 8), dark, [-1.4, 1.0, 0]),
  ]));
  const body = mesh(geo);
  root.add(body);
  const pivot = new THREE.Group();
  pivot.position.set(-1.4, 1.35, 0);
  const barrel = mesh(barrelGeometry(true));
  barrel.scale.set(1.2, 1, 1);
  pivot.add(barrel);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.meshes = [body, barrel];
  return root;
}

export function createMeteor() {
  const root = new THREE.Group();
  const geo = cached('meteor', () => merge([
    part(new THREE.IcosahedronGeometry(1.1, 0), '#3a2a22'),
    part(new THREE.IcosahedronGeometry(0.5, 0), '#ff7a1a', [0.6, 0.5, 0.4]),
    part(new THREE.IcosahedronGeometry(0.45, 0), '#ffb040', [-0.5, -0.4, 0.5]),
  ]));
  const body = mesh(geo);
  root.add(body);
  const glow = new THREE.Mesh(cached('meteorGlow', () => new THREE.IcosahedronGeometry(1.5, 1)), MAT.glow);
  glow.scale.setScalar(1);
  root.add(glow);
  root.userData.meshes = [body];
  return root;
}

// ---------------------------------------------------------------- extra scenery parts

export function palmParts(x, y, z, s, theme, v) {
  const lean = (v - 0.5) * 0.5;
  const parts = [part(cyl(0.16, 0.24, 3.6, 5), theme.trunk, [x + lean * 1.8 * s, y + 1.8 * s, z], [0, 0, -lean], [s, s, s])];
  const tx = x + lean * 3.6 * s;
  const ty = y + 3.6 * s;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + v * 3;
    parts.push(part(box(2.4, 0.08, 0.5), theme.tree, [tx + Math.cos(a) * 1.0 * s, ty - 0.25 * s, z + Math.sin(a) * 1.0 * s], [0, -a, -0.35], [s, s, s]));
  }
  return parts;
}

export function hoodooParts(x, y, z, s, theme) {
  const cols = theme.strata || [theme.rock];
  const parts = [];
  let h = y;
  for (let i = 0; i < 3; i++) {
    const r = (1.2 - i * 0.25) * s;
    const hh = (2.2 + i * 0.4) * s;
    parts.push(part(cyl(r * 0.85, r, hh, 6), cols[i % cols.length], [x, h + hh / 2, z]));
    h += hh;
  }
  parts.push(part(cyl(1.3 * s, 1.1 * s, 0.6 * s, 6), cols[3 % cols.length], [x, h + 0.3 * s, z]));
  return parts;
}

export function deadTreeParts(x, y, z, s, color, v) {
  return [
    part(cyl(0.12, 0.22, 3.2, 5), color, [x, y + 1.6 * s, z], [0, 0, (v - 0.5) * 0.3], [s, s, s]),
    part(cyl(0.06, 0.1, 1.4, 4), color, [x + 0.45 * s, y + 2.4 * s, z], [0, 0, -0.8], [s, s, s]),
    part(cyl(0.06, 0.1, 1.2, 4), color, [x - 0.4 * s, y + 2.0 * s, z], [0, 0, 0.9], [s, s, s]),
  ];
}

export function skyscraperParts(x, y, z, w, h, d, theme, v, lit) {
  const walls = theme.buildings[Math.floor(v * theme.buildings.length) % theme.buildings.length];
  const parts = [part(box(w, h, d), walls, [x, y + h / 2 - 0.5, z])];
  const floors = Math.min(16, Math.floor(h / 2.6));
  for (let f = 0; f < floors; f++) {
    const on = !lit || hashLit(x, f) > 0.25;
    parts.push(part(box(w * 0.86, 0.55, 0.06), on ? theme.windows : theme.windowsOff || '#2a2f3a', [x, y + 1.2 + f * 2.6, z + d / 2 + 0.03]));
  }
  if (v > 0.6) parts.push(part(cyl(0.05, 0.08, 4, 4), '#2a2a2a', [x + w * 0.2, y + h + 1.5, z]));
  else parts.push(part(box(w * 0.5, 1.2, d * 0.5), walls, [x, y + h + 0.1, z]));
  return parts;
}

function hashLit(x, f) {
  const n = Math.sin(x * 12.9898 + f * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function lighthouseParts(x, y, z, s) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push(part(cyl((0.9 - i * 0.1) * s, (1.0 - i * 0.1) * s, 1.6 * s, 8), i % 2 ? '#c8352b' : '#f2f2ee', [x, y + (0.8 + i * 1.6) * s, z]));
  }
  parts.push(part(cyl(0.7 * s, 0.7 * s, 0.9 * s, 8), '#ffe38a', [x, y + 6.9 * s, z]));
  parts.push(part(cone(0.85 * s, 0.9 * s, 8), '#2a2a2a', [x, y + 7.8 * s, z]));
  return parts;
}

export function shipDecorParts(x, y, z, s, v) {
  const hull = v > 0.5 ? '#5f6b75' : '#6d5a4a';
  return [
    part(box(9 * s, 1.4 * s, 2.2 * s), hull, [x, y + 0.3 * s, z]),
    part(box(3 * s, 1.6 * s, 1.8 * s), '#c9ced3', [x + 2 * s, y + 1.8 * s, z]),
    part(cyl(0.3 * s, 0.35 * s, 1.6 * s, 6), '#2e2e2e', [x + 2.6 * s, y + 3.2 * s, z]),
  ];
}

export function streetlightParts(x, y, z, lit) {
  return [
    part(cyl(0.07, 0.09, 3.2, 4), '#2a2d33', [x, y + 1.6, z]),
    part(box(0.8, 0.12, 0.2), '#2a2d33', [x + 0.35, y + 3.2, z]),
    part(box(0.35, 0.14, 0.3), lit ? '#ffe7a0' : '#c9ccd1', [x + 0.65, y + 3.1, z]),
  ];
}

export function volcanoParts(x, y, z, r, h, theme) {
  return [
    part(cyl(r * 0.12, r, h, 14, 1), theme.mountain, [x, y + h / 2, z]),
    part(cyl(r * 0.1, r * 0.12, 1.5, 14, 1), theme.lava, [x, y + h + 0.2, z]),
  ];
}

// ---------------------------------------------------------------- extra bosses

// Side-profile extrusion: `points` are [x, y], extruded `depth` along z and centred on `z`.
const prof = (points, depth, color, z = 0) => part(slab(points, depth), color, [0, 0, z]);
// Plan-view extrusion: `points` are [x, z], `h` thick and centred on height `y`.
const plan = (points, h, color, y = 0) => wing(points, h, color, y);
const scalePts = (pts, k) => pts.map(([a, b]) => [a * k, b * k]);
// A disc facing the camera (axis along z).
const disc = (r, depth, color, p, seg = 12) => part(cyl(r, r, depth, seg), color, p, [HALF, 0, 0]);

// Per-instance additive glow (heat, charge, bay lights) so each boss can fade its own.
function glowMat(color, opacity = 0) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
}

// Charge-up glow at a gun muzzle: hidden (scale 0) until a boss telegraphs a shot.
function muzzleGlow(pivot, x, r = 0.7) {
  const m = new THREE.Mesh(cached('glowBall', () => new THREE.IcosahedronGeometry(1, 1)), glowMat(0xffb347, 0.9));
  m.position.set(x, 0, 0);
  m.scale.setScalar(0.001);
  m.userData.r = r;
  pivot.add(m);
  return m;
}

// Six-barrel rotary cannon along +X with its heat glow overlay.
function minigunGeometry() {
  return cached('minigun', () => {
    const P = [part(cyl(0.24, 0.26, 0.7, 8), '#22251d', [0.3, 0, 0], ALONG_X)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      P.push(part(cyl(0.055, 0.055, 1.9, 5), '#15170f', [1.5, Math.cos(a) * 0.14, Math.sin(a) * 0.14], ALONG_X));
    }
    P.push(part(cyl(0.21, 0.21, 0.12, 8), '#22251d', [1.2, 0, 0], ALONG_X));
    P.push(part(cyl(0.21, 0.21, 0.12, 8), '#22251d', [2.35, 0, 0], ALONG_X));
    return merge(P);
  });
}

// Heavy tank cannon along +X: long tube, fume extractor and a slotted muzzle brake.
function heavyBarrelGeometry() {
  return cached('heavyBarrel', () => merge([
    part(cyl(0.24, 0.3, 7.2, 8), '#2b2e22', [3.6, 0, 0], ALONG_X),
    part(cyl(0.4, 0.4, 1.1, 8), '#3a3d2c', [3.3, 0, 0], ALONG_X),
    part(cyl(0.5, 0.5, 0.9, 8), '#3a3d2c', [0.45, 0, 0], ALONG_X),
    part(box(0.95, 0.56, 0.66), '#23251b', [7.35, 0, 0]),
    part(box(0.3, 0.6, 0.72), '#16170f', [7.25, 0, 0]),
  ]));
}

// Three naval guns side by side along +X, with canvas blast bags at the roots.
function tripleBarrelGeometry() {
  return cached('tripleBarrel', () => {
    const P = [];
    for (const z of [-0.46, 0, 0.46]) {
      P.push(part(cyl(0.13, 0.18, 4.4, 7), '#20262b', [2.4, 0, z], ALONG_X));
      P.push(part(cyl(0.2, 0.2, 0.5, 7), '#c9c2a8', [0.35, 0, z], ALONG_X));
    }
    return merge(P);
  });
}

// Twin light AA guns with a small gun shield.
function twinAAGeometry() {
  return cached('twinAA', () => merge([
    part(box(0.7, 0.75, 1.1), '#59636b', [0.1, 0, 0]),
    part(cyl(0.07, 0.09, 2.0, 5), '#1b1f23', [1.2, 0.12, 0.25], ALONG_X),
    part(cyl(0.07, 0.09, 2.0, 5), '#1b1f23', [1.2, 0.12, -0.25], ALONG_X),
    part(cyl(0.12, 0.12, 0.3, 6), '#1b1f23', [2.2, 0.12, 0.25], ALONG_X),
    part(cyl(0.12, 0.12, 0.3, 6), '#1b1f23', [2.2, 0.12, -0.25], ALONG_X),
  ]));
}

// Aimable gun: returns { pivot, pos, type, len, mesh, glow } and adds it to `parent`.
// `len` is the distance from the pivot to the muzzle (where rounds appear).
function bossGun(parent, pos, type, geo, len, glowR = 0) {
  const pivot = new THREE.Group();
  pivot.position.set(pos[0], pos[1], pos[2] || 0);
  const barrel = mesh(geo);
  pivot.add(barrel);
  parent.add(pivot);
  const gun = { pivot, pos: [pos[0], pos[1]], type, len, mesh: barrel };
  if (glowR) gun.glow = muzzleGlow(pivot, len, glowR);
  return gun;
}

// Heavy tandem-rotor gunship (built facing -X, mirrored to fly facing +X).
// Armoured cabin, glazed nose with a chin minigun, stub wings with rocket pods, twin
// turboshaft engines on the tall rear pylon (the weak spot) and two three-blade rotors.
export function createTitan() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI; // built facing -X, flies facing +X
  root.add(model);
  const olive = '#56603f';
  const shade = '#465036';
  const belly = '#3d4530';
  const dark = '#1d2016';
  const glass = '#1f3140';
  const geo = cached('titan', () => {
    const P = [];
    // Cabin with an upswept rear loading ramp.
    P.push(prof([[-4.6, -1.3], [4.3, -1.3], [5.7, -0.35], [5.9, 1.25], [-4.6, 1.25]], 2.6, olive));
    P.push(part(box(9.0, 0.16, 2.64), belly, [-0.1, -1.24, 0]));
    // Nose and wrap-around glazing.
    P.push(prof([[-4.6, -1.3], [-6.0, -1.15], [-7.1, -0.55], [-7.35, 0.1], [-7.0, 0.55], [-6.0, 1.15], [-4.6, 1.25]], 2.4, olive));
    P.push(prof([[-5.95, 0.22], [-7.2, 0.42], [-6.12, 1.2], [-4.9, 1.27], [-4.9, 0.28]], 2.46, glass));
    P.push(part(box(0.12, 1.0, 2.5), olive, [-6.0, 0.72, 0]));
    P.push(part(box(0.12, 1.0, 2.5), olive, [-5.35, 0.75, 0]));
    P.push(prof([[-6.6, -0.75], [-7.15, -0.5], [-7.32, 0.0], [-6.6, -0.1]], 2.2, glass)); // chin window
    // Cabin windows, door and armour panel seams.
    for (let x = -3.0; x <= 3.0; x += 1.2) P.push(part(box(0.55, 0.5, 2.66), glass, [x, 0.5, 0]));
    P.push(part(box(1.2, 1.95, 2.63), shade, [-3.9, -0.25, 0]));
    P.push(part(box(0.75, 0.55, 2.66), glass, [-3.9, 0.3, 0]));
    for (const x of [-2.4, 0.6, 3.6]) P.push(part(box(0.07, 2.5, 2.63), belly, [x, 0, 0]));
    P.push(part(box(9.4, 0.07, 2.63), belly, [0, -0.35, 0]));
    // Roundel and tail band.
    P.push(part(box(0.35, 1.95, 2.64), '#d2b23a', [4.85, 0.27, 0]));
    // Drive-shaft tunnel along the roof.
    P.push(part(box(7.6, 0.55, 1.1), shade, [-0.7, 1.5, 0]));
    // Forward rotor pylon and hub.
    P.push(prof([[-5.9, 1.2], [-3.0, 1.2], [-3.4, 2.05], [-4.3, 2.6], [-5.4, 2.4]], 1.6, olive));
    P.push(part(cyl(0.32, 0.45, 0.6, 8), dark, [-4.45, 2.85, 0]));
    // Tall rear pylon.
    P.push(prof([[1.9, 1.2], [5.9, 1.2], [6.6, 3.4], [6.3, 4.4], [3.9, 4.55], [2.8, 3.0]], 1.7, olive));
    P.push(part(cyl(0.32, 0.45, 0.6, 8), dark, [5.0, 4.8, 0]));
    P.push(part(box(0.06, 2.8, 1.74), belly, [4.2, 2.9, 0]));
    P.push(disc(0.42, 1.76, '#1b1d16', [3.55, 1.95, 0]));
    P.push(disc(0.27, 1.78, '#b8382d', [3.55, 1.95, 0]));
    // Twin turboshaft engines on the pylon sides: intakes, cowlings and hot exhausts.
    for (const z of [-1.3, 1.3]) {
      P.push(part(cyl(0.55, 0.62, 3.2, 10), shade, [4.8, 3.05, z], ALONG_X));
      P.push(part(cyl(0.42, 0.55, 0.5, 10), dark, [3.0, 3.05, z], ALONG_X));
      P.push(part(cyl(0.5, 0.4, 0.55, 10), '#2a2a26', [6.6, 3.05, z], ALONG_X));
      P.push(part(cyl(0.3, 0.3, 0.12, 10), '#c46a2a', [6.9, 3.05, z], ALONG_X));
      P.push(part(box(2.0, 0.12, 0.3), '#c46a2a', [4.9, 3.05, z * 1.46]));
    }
    // Fuel sponsons, rear gear in them.
    for (const z of [-1.45, 1.45]) {
      P.push(part(sphere(1, 10, 6), shade, [0.6, -0.8, z], [0, 0, 0], [3.2, 0.62, 0.5]));
      P.push(part(box(0.18, 0.8, 0.18), dark, [3.2, -1.55, z]));
      P.push(part(cyl(0.45, 0.45, 0.32, 10), dark, [3.2, -1.95, z], [HALF, 0, 0]));
      P.push(part(cyl(0.2, 0.2, 0.36, 8), '#5a5d52', [3.2, -1.95, z], [HALF, 0, 0]));
    }
    // Nose gear.
    for (const z of [-0.75, 0.75]) {
      P.push(part(box(0.16, 0.7, 0.16), dark, [-5.1, -1.6, z]));
      P.push(part(cyl(0.38, 0.38, 0.28, 10), dark, [-5.1, -1.95, z], [HALF, 0, 0]));
    }
    // Stub wings with seven-tube rocket pods.
    P.push(part(box(1.7, 0.18, 6.4), olive, [-1.6, -0.25, 0], [0, 0, 0.05]));
    for (const z of [-2.75, 2.75]) {
      P.push(part(box(0.5, 0.45, 0.2), dark, [-1.6, -0.55, z]));
      P.push(part(cyl(0.5, 0.5, 2.3, 10), shade, [-1.6, -0.95, z], ALONG_X));
      P.push(part(cyl(0.42, 0.5, 0.25, 10), dark, [-2.8, -0.95, z], ALONG_X));
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * PI * 2;
        const rr = i === 6 ? 0 : 0.26;
        P.push(part(cyl(0.08, 0.08, 0.06, 6), '#8a2a22', [-2.95, -0.95 + Math.cos(a) * rr, z + Math.sin(a) * rr], ALONG_X));
      }
    }
    // Chin turret ball.
    P.push(part(sphere(0.55, 8, 6), dark, [-6.0, -1.35, 0]));
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  // Three-blade rotors with drooping blades, yellow tips and a faint blur disc.
  const rotorGeo = cached('titan:rotor', () => {
    const P = [part(cone(0.35, 0.5, 8), '#16180f', [0, 0.25, 0])];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      const blade = merge([
        part(box(6.4, 0.08, 0.52), '#16180f', [3.4, 0, 0]),
        part(box(0.45, 0.09, 0.54), '#d2b23a', [6.4, 0, 0]),
      ]);
      blade.rotateZ(-0.035);
      blade.rotateY(a);
      P.push(blade);
    }
    return merge(P);
  });
  const blurMat = new THREE.MeshBasicMaterial({ color: 0x1a1c15, transparent: true, opacity: 0.12, depthWrite: false });
  const rotors = [[-4.45, 3.2], [5.0, 5.15]].map(([x, y]) => {
    const r = mesh(rotorGeo);
    r.position.set(x, y, 0);
    model.add(r);
    const blur = new THREE.Mesh(cached('rotorBlur', () => new THREE.CylinderGeometry(6.6, 6.6, 0.02, 28)), blurMat);
    blur.position.set(x, y, 0);
    model.add(blur);
    return r;
  });
  const chin = bossGun(model, [-6.0, -1.45, 0], 'minigun', minigunGeometry(), 2.4);
  const heat = new THREE.Mesh(cached('minigunHeat', () => {
    const g = new THREE.CylinderGeometry(0.3, 0.3, 1.9, 8);
    g.rotateZ(-HALF);
    g.translate(1.45, 0, 0);
    return g;
  }), glowMat(0xff3a10));
  chin.pivot.add(heat);
  chin.heat = heat;
  const door = bossGun(model, [-3.9, -0.1, -1.45], 'door', barrelGeometry(false), 2.2);
  door.mesh.scale.set(0.8, 0.8, 0.8);
  root.userData.rotors = rotors;
  root.userData.guns = [chin, door];
  root.userData.meshes = [body, ...rotors, chin.mesh, door.mesh];
  return root;
}

// Land fortress super-tank (built facing -X, mirrored to drive facing +X). Base at y = 0.
// Twin tracks behind armoured skirts, a sloped casemate, a heavy main gun that cannot
// elevate past ~65 degrees, two flak turrets, an elevating missile rack and a hot
// rear engine deck (the weak spot).
export function createBehemoth() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI; // built facing -X, travels facing +X
  root.add(model);
  const hull = '#5d6342';
  const shade = '#4b5035';
  const dark = '#24261b';
  const track = '#22231c';
  const sand = '#8a7f55';
  const green = '#3f4a2c';
  const geo = cached('behemoth', () => {
    const P = [];
    // Tracks, road wheels, sprockets and idlers on both sides.
    for (const s of [-1, 1]) {
      P.push(prof([[-8.3, 1.0], [-7.4, 0.05], [6.9, 0.05], [7.9, 1.0], [7.6, 1.95], [-8.0, 1.95]], 1.3, track, s * 2.45));
      for (let i = 0; i < 8; i++) {
        const x = -6.2 + i * 1.75;
        P.push(part(cyl(0.62, 0.62, 0.2, 10), '#3b3e2e', [x, 0.72, s * 3.12], [HALF, 0, 0]));
        P.push(part(cyl(0.24, 0.24, 0.24, 8), '#5a5c4a', [x, 0.72, s * 3.16], [HALF, 0, 0]));
      }
      P.push(part(cyl(0.78, 0.78, 0.22, 10), dark, [7.2, 1.08, s * 3.1], [HALF, 0, 0]));
      P.push(part(cyl(0.7, 0.7, 0.22, 10), '#3b3e2e', [-7.6, 1.15, s * 3.1], [HALF, 0, 0]));
      // Armoured side skirts in panels, hiding the top of the running gear.
      P.push(prof([[-7.7, 1.55], [7.0, 1.55], [7.6, 2.75], [-7.3, 2.75]], 0.16, shade, s * 3.28));
      for (let i = 0; i < 6; i++) P.push(part(box(0.07, 1.15, 0.2), dark, [-5.2 + i * 2.4, 2.15, s * 3.3]));
      // Headlights, tow hooks and stowage.
      P.push(part(box(0.25, 0.35, 0.5), '#f2e7b0', [-8.55, 2.55, s * 1.6]));
      P.push(part(box(0.4, 0.3, 0.3), dark, [-8.6, 1.75, s * 1.2]));
      P.push(part(box(0.9, 0.7, 0.5), green, [7.85, 2.5, s * 1.4]));
    }
    // Lower hull with a sloped glacis.
    P.push(prof([[-8.6, 1.6], [-7.0, 1.0], [7.0, 1.0], [7.8, 1.6], [7.8, 3.1], [-6.2, 3.25], [-8.6, 2.3]], 4.6, hull));
    for (let i = 0; i < 4; i++) P.push(part(box(0.5, 0.2, 3.6), dark, [-7.95 + i * 0.6, 2.42 + i * 0.25, 0], [0, 0, 0.38])); // spare track links
    // Casemate.
    P.push(prof([[-5.6, 3.1], [6.6, 3.1], [7.1, 4.3], [-4.6, 4.5]], 3.9, hull));
    P.push(prof([[-3.8, 3.2], [-1.2, 3.2], [-2.0, 4.4], [-4.0, 4.45]], 3.94, sand));
    P.push(prof([[1.0, 3.2], [3.6, 3.2], [2.9, 4.36], [0.2, 4.4]], 3.94, green));
    // Rear engine deck: grille slats over glowing vents, two exhaust stacks.
    P.push(part(box(3.4, 0.08, 2.9), '#d0702c', [5.1, 4.32, 0]));
    for (let i = 0; i < 6; i++) P.push(part(box(0.22, 0.16, 3.0), dark, [3.65 + i * 0.58, 4.42, 0]));
    for (const z of [-1.45, 1.45]) {
      P.push(part(cyl(0.3, 0.38, 1.7, 8), dark, [6.4, 5.0, z]));
      P.push(part(cyl(0.34, 0.3, 0.2, 8), '#3a2a20', [6.4, 5.9, z]));
    }
    // Main turret with rear bustle, cupola, periscopes, smoke dischargers and antenna.
    P.push(prof([[-3.9, 4.4], [1.9, 4.4], [2.5, 5.4], [1.8, 6.5], [-3.1, 6.5], [-4.2, 5.5]], 3.6, hull));
    P.push(prof([[1.6, 4.9], [3.3, 5.05], [3.3, 6.25], [1.6, 6.4]], 3.0, shade));
    P.push(prof([[-2.6, 4.5], [-0.6, 4.5], [-1.2, 6.45], [-2.9, 6.45]], 3.64, sand));
    P.push(part(cyl(0.55, 0.65, 0.6, 8), shade, [-0.9, 6.8, -0.75]));
    P.push(part(cyl(0.6, 0.6, 0.12, 8), dark, [-0.9, 7.15, -0.75]));
    P.push(part(box(0.4, 0.3, 0.3), dark, [-2.3, 6.65, 0.9]));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) P.push(part(cyl(0.12, 0.12, 0.55, 6), dark, [-2.8 + i * 0.3, 6.1, s * 1.9], [s * 0.5, 0, -0.4]));
    }
    P.push(part(cyl(0.03, 0.05, 3.6, 4), dark, [2.6, 8.1, -1.0], [0, 0, -0.25]));
    P.push(part(box(1.1, 1.5, 1.8), '#3b3e2c', [-4.4, 5.45, 0])); // gun mantlet
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  const flakGeo = cached('behemoth:flakBase', () => merge([
    part(cyl(0.75, 0.9, 0.55, 8), shade),
    part(box(0.9, 0.9, 1.3), hull, [0.1, 0.55, 0]),
  ]));
  const guns = [bossGun(model, [-4.6, 5.45, 0], 'main', heavyBarrelGeometry(), 7.6, 1.1)];
  for (const [x, y, z] of [[-5.0, 4.6, -1.5], [-5.0, 4.6, 1.5]]) {
    const base = mesh(flakGeo);
    base.position.set(x, y - 0.25, z);
    model.add(base);
    const gun = bossGun(model, [x, y + 0.45, z], 'flak', barrelGeometry(true), 2.4);
    gun.mesh.scale.set(1.2, 1, 1);
    gun.base = base;
    guns.push(gun);
  }
  // Missile rack on an elevating mount: launches over the rear deck.
  const rack = new THREE.Group();
  rack.position.set(0.0, 6.5, 0.85);
  const rackMesh = mesh(cached('behemoth:rack', () => {
    const P = [part(box(2.6, 1.0, 1.4), green, [1.2, 0.5, 0])];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      P.push(part(cyl(0.18, 0.18, 0.08, 8), dark, [2.52, 0.27 + r * 0.46, -0.42 + c * 0.42], ALONG_X));
      P.push(part(cone(0.12, 0.28, 6), '#a3302a', [2.62, 0.27 + r * 0.46, -0.42 + c * 0.42], ALONG_X));
    }
    P.push(part(box(2.62, 0.16, 1.42), '#c9b24a', [1.2, 0.92, 0]));
    P.push(part(box(0.5, 0.5, 0.5), dark, [0.2, -0.15, 0]));
    return merge(P);
  }));
  rack.add(rackMesh);
  model.add(rack);
  // Hot engine deck: the vents glow and pulse, the giveaway for its weak spot.
  const vents = new THREE.Mesh(cached('behemoth:vents', () => new THREE.BoxGeometry(3.3, 0.1, 2.8)), glowMat(0xff7a2a, 0.5));
  vents.position.set(5.1, 4.4, 0);
  model.add(vents);
  root.userData.vents = vents;
  root.userData.guns = guns;
  root.userData.rack = rack;
  root.userData.meshes = [body, rackMesh, ...guns.map((g) => g.mesh), ...guns.filter((g) => g.base).map((g) => g.base)];
  return root;
}

// Lofted hull: `stations` run bow to stern, each a list of [x, y, halfWidth] points from
// the deck edge down to the keel. Each band between two consecutive rows gets its own
// colour (`bands`), the deck between the two deck edges gets `deckColor`, and the stern
// is closed with a transom. Built directly as a flat-shaded, vertex-coloured geometry.
function loftHull(stations, bands, deckColor, transomColor) {
  const pos = [];
  const col = [];
  const tri = (a, b, c, color) => {
    _c.set(color);
    for (const v of [a, c, b]) {
      pos.push(v[0], v[1], v[2]);
      col.push(_c.r, _c.g, _c.b);
    }
  };
  const quad = (a, b, c, d, color) => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };
  const R = (st, j) => [st[j][0], st[j][1], st[j][2]];
  const L = (st, j) => [st[j][0], st[j][1], -st[j][2]];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    for (let j = 0; j < a.length - 1; j++) {
      quad(R(a, j), R(b, j), R(b, j + 1), R(a, j + 1), bands[j]);
      quad(L(a, j), L(a, j + 1), L(b, j + 1), L(b, j), bands[j]);
    }
    const k = a.length - 1;
    quad(L(a, 0), L(b, 0), R(b, 0), R(a, 0), deckColor);
    quad(R(a, k), R(b, k), L(b, k), L(a, k), bands[k - 1]);
  }
  const t = stations[stations.length - 1];
  for (let j = 0; j < t.length - 1; j++) quad(L(t, j), L(t, j + 1), R(t, j + 1), R(t, j), transomColor);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Battleship hull lines: raked stem, sheer rising to the bow, flared sides, red boot
// topping below the waterline and a flat transom stern.
const DREAD_STATIONS = [
  // [x, y, half-width] from deck edge, boot top, waterline, bilge to keel.
  [[-13.7, 3.15, 0.04], [-12.9, 0.3, 0.04], [-12.6, -0.05, 0.04], [-12.2, -0.6, 0.04], [-11.8, -0.9, 0.04]],
  [[-11.2, 3.0, 1.45], [-11.0, 0.3, 1.0], [-11.0, -0.05, 0.9], [-11.0, -0.6, 0.7], [-11.0, -0.9, 0.25]],
  [[-8.0, 2.72, 2.15], [-8.0, 0.3, 1.95], [-8.0, -0.05, 1.85], [-8.0, -0.6, 1.6], [-8.0, -0.9, 0.8]],
  [[-4.2, 2.2, 2.42], [-4.2, 0.3, 2.38], [-4.2, -0.05, 2.32], [-4.2, -0.6, 2.05], [-4.2, -0.9, 1.05]],
  [[0, 2.05, 2.45], [0, 0.3, 2.42], [0, -0.05, 2.38], [0, -0.6, 2.1], [0, -0.9, 1.1]],
  [[9.0, 2.05, 2.45], [9.0, 0.3, 2.42], [9.0, -0.05, 2.38], [9.0, -0.6, 2.1], [9.0, -0.9, 1.1]],
  [[11.4, 2.1, 2.05], [11.4, 0.3, 1.9], [11.3, -0.05, 1.75], [11.1, -0.6, 1.35], [10.8, -0.9, 0.55]],
  [[12.7, 2.18, 1.4], [12.55, 0.3, 1.2], [12.35, -0.05, 1.0], [11.9, -0.6, 0.55], [11.3, -0.9, 0.2]],
];
// Deck height along the hull (for placing fittings on the sheer).
function dreadDeckY(x) {
  const s = DREAD_STATIONS;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i][0];
    const b = s[i + 1][0];
    if (x <= b[0]) return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return s[s.length - 1][0][1];
}

// Battleship (built facing -X, mirrored to sail facing +X). Waterline at y = 0.
// A raked bow with a raised forecastle, three triple turrets (two forward, superfiring,
// one aft), a stepped superstructure with bridge, tripod mast and two raked funnels,
// twin AA mounts, and vertical launch cells on the quarterdeck.
export function createDreadnought() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI; // built facing -X, travels facing +X
  root.add(model);
  const hull = '#5f6a73';
  const upper = '#8b959d';
  const dark = '#262c31';
  const deck = '#a6926a';
  const geo = cached('dreadnought', () => {
    const P = [];
    P.push(loftHull(DREAD_STATIONS, [hull, '#1d2226', '#7a2e27', '#7a2e27'], deck, hull));
    // Portholes along the hull and the anchors.
    for (let x = -7.5; x <= 8.5; x += 1.25) for (const z of [-2.44, 2.44]) P.push(part(box(0.28, 0.28, 0.06), dark, [x, 1.3, z]));
    for (const z of [-1, 1]) P.push(part(box(0.8, 0.55, 0.3), dark, [-11.0, 2.0, z * 1.25], [z * 0.5, 0, 0]));
    // Breakwater on the forecastle and guard rails.
    P.push(prof([[-0.3, 0], [0.3, 0], [0.1, 0.6], [-0.2, 0.6]], 3.6, hull).translate(-10.2, dreadDeckY(-10.2) - 0.05, 0));
    // Superstructure: stepped decks, bridge with windows, bridge wings and rangefinder.
    P.push(part(box(9.0, 1.4, 3.6), upper, [0.6, 2.75, 0]));
    P.push(part(box(5.6, 1.3, 3.0), upper, [-0.6, 4.1, 0]));
    P.push(part(box(3.2, 1.25, 2.7), upper, [-1.5, 5.35, 0]));
    P.push(part(box(3.25, 0.32, 2.75), '#14191d', [-1.5, 5.5, 0]));
    P.push(part(box(0.9, 0.15, 4.2), upper, [-2.6, 5.9, 0]));
    P.push(part(box(1.1, 0.65, 1.1), dark, [-1.5, 6.3, 0]));
    P.push(part(cyl(0.12, 0.12, 3.4, 6), dark, [-1.5, 6.4, 0], [HALF, 0, 0]));
    for (let x = -3.4; x <= 4.4; x += 0.9) P.push(part(box(0.35, 0.3, 3.62), '#14191d', [x, 3.0, 0]));
    // Tripod mast with radar and yard.
    P.push(part(cyl(0.12, 0.18, 5.4, 6), dark, [-0.4, 9.0, 0]));
    P.push(part(cyl(0.08, 0.1, 4.0, 5), dark, [0.4, 8.0, 0.6], [0.15, 0, 0.22]));
    P.push(part(cyl(0.08, 0.1, 4.0, 5), dark, [0.4, 8.0, -0.6], [-0.15, 0, 0.22]));
    P.push(part(box(0.12, 0.12, 3.2), dark, [-0.4, 10.0, 0]));
    P.push(part(box(0.25, 0.8, 2.0), '#3d464d', [-0.4, 10.9, 0]));
    // Two raked funnels with black caps.
    for (const [x, y, h] of [[2.3, 4.7, 3.2], [4.6, 4.3, 2.6]]) {
      P.push(part(cyl(0.85, 1.05, h, 10), upper, [x, y, 0], [0, 0, -0.14]));
      P.push(part(cyl(0.92, 0.9, 0.4, 10), '#15181b', [x + Math.sin(0.14) * h * 0.5, y + h * 0.5, 0], [0, 0, -0.14]));
    }
    // Lifeboats.
    for (const z of [-1.95, 1.95]) for (const x of [3.0, 5.0]) P.push(part(sphere(0.5, 8, 4), '#e6e3d6', [x, 3.6, z], [0, 0, 0], [1.6, 0.6, 0.6]));
    // Aft deckhouse, vertical launch cells and the ensign.
    P.push(part(box(2.6, 1.2, 2.6), upper, [6.4, 2.65, 0]));
    for (let i = 0; i < 3; i++) for (const z of [-0.5, 0.5]) P.push(part(box(0.6, 0.12, 0.6), dark, [10.6 + i * 0.75, 2.12, z]));
    P.push(part(cyl(0.05, 0.05, 2.4, 4), dark, [12.1, 3.2, 0]));
    P.push(prof([[12.1, 3.6], [13.5, 3.75], [13.5, 4.35], [12.1, 4.4]], 0.06, '#b8382d'));
    // Turret barbettes and housings: two forward (facing the bow), one aft.
    P.push(part(cyl(1.35, 1.5, 0.5, 12), dark, [-8.4, 2.95, 0]));
    P.push(part(cyl(1.35, 1.5, 1.5, 12), dark, [-5.1, 3.0, 0]));
    P.push(part(cyl(1.35, 1.5, 0.4, 12), dark, [8.7, 2.25, 0]));
    const fwd = [[-1.8, 0], [1.6, 0], [1.8, 0.9], [-1.1, 1.2], [-1.95, 0.65]];
    const aft = fwd.map(([x, y]) => [-x, y]);
    P.push(part(slab(fwd, 2.6), upper, [-8.4, 3.15, 0]));
    P.push(part(slab(fwd, 2.6), upper, [-5.1, 3.7, 0]));
    P.push(part(slab(aft, 2.6), upper, [8.7, 2.4, 0]));
    return merge(P);
  });
  const body = mesh(geo);
  model.add(body);
  const guns = [
    bossGun(model, [-8.1, 3.75, 0], 'main', tripleBarrelGeometry(), 4.6, 1.2),
    bossGun(model, [-4.8, 4.3, 0], 'main', tripleBarrelGeometry(), 4.6, 1.2),
    bossGun(model, [8.4, 3.0, 0], 'main', tripleBarrelGeometry(), 4.6, 1.2),
    bossGun(model, [-3.4, 3.85, -1.95], 'flak', twinAAGeometry(), 2.3),
    bossGun(model, [3.7, 3.85, -1.95], 'flak', twinAAGeometry(), 2.3),
  ];
  root.userData.guns = guns;
  root.userData.funnels = [[2.3 + 0.22, 6.3], [4.6 + 0.18, 5.6]];
  root.userData.meshes = [body, ...guns.map((g) => g.mesh)];
  return root;
}

// Enemy ace: oversized crimson fighter built facing +X (steered by heading), carrying a
// heat-seeker under each wing and a bomb on the centreline.
export function createAce() {
  const root = buildJet(PALETTES.ace, 1, 1.35);
  const model = root.children[0];
  const stores = mesh(cached('ace:stores', () => {
    const P = [];
    for (const z of [-1.9, 1.9]) {
      P.push(part(box(0.7, 0.3, 0.08), '#151515', [-0.5, -0.32, z]));
      P.push(part(cyl(0.12, 0.12, 1.6, 6), '#e8e4da', [-0.5, -0.55, z], ALONG_X));
      P.push(part(cone(0.12, 0.35, 6), '#9c1f1f', [0.47, -0.55, z], ALONG_X));
      P.push(part(box(0.3, 0.35, 0.04), '#555', [-1.2, -0.55, z]));
    }
    P.push(part(box(0.6, 0.3, 0.1), '#151515', [0.1, -0.62, 0]));
    P.push(part(sphere(0.3, 8, 6), '#33363a', [0.1, -0.95, 0], [0, 0, 0], [2.2, 1, 1]));
    P.push(part(box(0.1, 0.62, 0.62), '#c0392b', [0.25, -0.95, 0]));
    return merge(P);
  }));
  model.add(stores);
  root.userData.meshes.push(stores);
  return root;
}

// Stealth flying wing, facing -X, tilted to show its chevron planform. The bomb bay doors
// on the centre body slide open (showing a red-lit bay) for every bombing run, and two
// missile hatches sit behind the cockpit.
export function createNightwing() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = 1.05;
  root.add(model);
  const skin = '#2a2e38';
  const geo = cached('nightwing', () => merge([
    wing([[-5.5, 0], [3, 10.5], [5.8, 10.5], [4.2, 7.2], [5.8, 4.2], [3.6, 1.8], [5.2, 0], [3.6, -1.8], [5.8, -4.2], [4.2, -7.2], [5.8, -10.5], [3, -10.5]], 0.5, skin),
    part(sphere(1, 12, 8), '#343947', [-0.6, 0.35, 0], [0, 0, 0], [4.6, 0.9, 2.6]),
    part(box(1.4, 0.2, 1.8), '#101218', [-3.4, 0.7, 0]),
    ...[-2.2, 2.2].map((z) => part(box(2.6, 0.5, 1.1), '#1d2029', [0.8, 0.55, z])),
    ...[-0.55, 0.55].map((z) => part(box(0.7, 0.12, 0.45), '#15171d', [-2.2, 1.12, z])),
    part(box(3.0, 0.06, 1.9), '#14161c', [0.6, 1.1, 0]),
  ]));
  const body = mesh(geo);
  model.add(body);
  const glows = [-2.2, 2.2].map((z) => {
    const f = new THREE.Mesh(flameGeometry(), MAT.glowBlue);
    f.position.set(2.2, 0.55, z);
    f.scale.set(0.8, 0.9, 1.4);
    model.add(f);
    return f;
  });
  // Red-lit bay interior and two doors hinged on their outer edges.
  const bayLight = new THREE.Mesh(cached('nightwing:bay', () => new THREE.BoxGeometry(2.8, 0.05, 1.7)), glowMat(0xff3020, 0));
  bayLight.position.set(0.6, 1.16, 0);
  model.add(bayLight);
  // Bay doors slide outward to open: position.z = side * (0.46 + 0.9 * open).
  const doorGeo = cached('nightwing:door', () => merge([part(box(2.9, 0.08, 0.92), '#3b404e')]));
  const doors = [-1, 1].map((side) => {
    const d = mesh(doorGeo);
    d.position.set(0.6, 1.21, side * 0.46);
    model.add(d);
    return { mesh: d, side };
  });
  root.userData.glows = glows;
  root.userData.bayLight = bayLight;
  root.userData.doors = doors;
  root.userData.meshes = [body, ...doors.map((d) => d.mesh)];
  return root;
}

// Night-map watchtower with a sweeping searchlight. The beam pivot sits at the lamp
// and the beam points along +Y; each tower gets its own beam material so it can turn red.
export function createWatchtower() {
  const root = new THREE.Group();
  const steel = '#3a4048';
  const dark = '#1d2126';
  const geo = cached('watchtower', () => {
    const P = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      P.push(part(box(0.25, 8.6, 0.25), steel, [x * 0.95, 4.2, z * 0.95 - 1.2], [z * 0.05, 0, -x * 0.05]));
    }
    P.push(part(box(2.2, 0.2, 0.15), dark, [0, 2.6, -0.25], [0, 0, 0.7]));
    P.push(part(box(2.2, 0.2, 0.15), dark, [0, 5.4, -0.25], [0, 0, -0.7]));
    P.push(part(box(3.2, 0.4, 3.2), steel, [0, 8.4, -1.2]));
    P.push(part(box(3.2, 0.9, 0.12), steel, [0, 9.05, 0.35]));
    P.push(part(box(2.4, 1.6, 2.2), dark, [0, 9.4, -1.6]));
    P.push(part(cone(1.8, 0.8, 4), dark, [0, 10.6, -1.6], [0, PI / 4, 0]));
    P.push(part(cyl(0.55, 0.65, 0.9, 10), '#2a2e33', [0, 9.3, -0.3], [HALF, 0, 0]));
    P.push(part(cyl(0.5, 0.5, 0.08, 10), '#fff4c0', [0, 9.3, 0.18], [HALF, 0, 0]));
    return merge(P);
  });
  const body = mesh(geo);
  root.add(body);
  const beamGeo = cached('beam', () => {
    const g = new THREE.ConeGeometry(6, 55, 18, 1, true);
    g.rotateX(PI);
    g.translate(0, 27.5, 0);
    return g;
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c4, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const pivot = new THREE.Group();
  pivot.position.set(0, 9.3, 0);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  pivot.add(beam);
  root.add(pivot);
  root.userData.beamPivot = pivot;
  root.userData.beamMat = beamMat;
  root.userData.meshes = [body];
  return root;
}
