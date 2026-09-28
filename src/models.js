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
  const flame = new THREE.Mesh(cached('flame', () => {
    const g = cone(0.36, 1.6, 8);
    g.rotateZ(HALF);
    g.translate(-0.8, 0, 0);
    return g;
  }), MAT.glow);
  flame.position.x = -2.2;
  model.add(flame);
  root.userData.flame = flame;
  root.userData.meshes = [body];
  return root;
}

export function createPlayerJet() {
  return buildJet(PALETTES.player, 1, 1);
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
  root.userData.rotor = rotor;
  root.userData.tailRotor = tail;
  root.userData.meshes = [body, rotor, tail];
  return root;
}

export function createBomber() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = PI;
  model.rotation.x = -0.3;
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
    makeTurret(model, [-4.5, -6.5, 0.4], 0.8),
    makeTurret(model, [2.5, -6.5, 0.4], 0.8),
    makeTurret(model, [-7, 4.1, 0.6], 0.9),
    makeTurret(model, [5, 4.1, 0.6], 0.9),
  ];
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

export function createBomb() {
  const geo = cached('bomb', () => merge([
    part(sphere(0.35, 8, 6), '#3e4a2c', [0, 0, 0], [0, 0, 0], [2, 1, 1]),
    part(box(0.35, 0.6, 0.06), '#2a3120', [-0.75, 0, 0]),
    part(box(0.35, 0.06, 0.6), '#2a3120', [-0.75, 0, 0]),
    part(box(0.12, 0.72, 0.72), '#d0b050', [0.1, 0, 0]),
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
