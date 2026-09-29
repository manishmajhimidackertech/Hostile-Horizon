// Generates the PWA icons (PNG + SVG) without any image dependencies.
// Usage: npm run icons
//
// Emblem: a top-down fighter climbing out over a glowing amber horizon.
// Every layer is defined once here and drawn twice: as SVG markup and by a
// small supersampling rasterizer for the PNGs, so both always match.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const S = 512; // design canvas
const RADIUS = 104; // corner radius of the rounded variants

// Dusk sky: deep navy overhead, warming to slate violet at the horizon.
const SKY = [[0, '#0e2038'], [0.45, '#1d3a5d'], [0.72, '#46486c'], [1, '#46486c']];
// Warm glow rising off the horizon.
const GLOW = { cx: 256, cy: 392, r: 330, color: '#ffae45', stops: [[0, 0.8], [0.3, 0.38], [0.65, 0.1], [1, 0]] };
// Curved horizon: a huge planet whose rim catches the light.
const PLANET = { cx: 256, cy: 1040, r: 650 };
const PLANET_FILL = [[0, '#12253a'], [1, '#060c15']]; // top of planet -> bottom of icon
const RIM_WIDTH = 10;
const RIM = [[0, '#f07a1c', 0.1], [0.5, '#ffe29a', 1], [1, '#f07a1c', 0.1]]; // left -> right

// Top-down jet, nose up, drawn around (0, 0). Only the right half is listed;
// the left half is its mirror image. Light comes from the upper left.
const JET_HALF = [
  [0, -220], [11, -180], [20, -128], [26, -80], [40, -44], [182, 58], [182, 76], [44, 60],
  [36, 116], [108, 172], [108, 188], [42, 180], [22, 204], [0, 198],
];
const CANOPY = [[0, -182], [10, -142], [0, -100], [-10, -142]];
const JET_LIGHT = '#f5f8fb';
const JET_SHADE = '#b9c8d7';
const CANOPY_FILL = [[0, '#ffe08a'], [1, '#f08a1c']]; // nose -> tail
const SHADOW = { dx: 10, dy: 14, alpha: 0.35 };
const JET_ANGLE = 45; // degrees clockwise from straight up: climbing to the right
const JET_CENTER = [256, 232];
const JET_SCALE = 0.8; // maskable icons shrink it further to stay in the safe zone

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Piecewise-linear gradient lookup: stops are [t, color, alpha?].
function ramp(stops, t) {
  t = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0, a0 = 1] = stops[i - 1];
      const [t1, c1, a1 = 1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      const A = hex(c0);
      const B = hex(c1);
      return [...A.map((v, j) => v + (B[j] - v) * k), a0 + (a1 - a0) * k];
    }
  }
  const [, c, a = 1] = stops[stops.length - 1];
  return [...hex(c), a];
}

function over(dst, [r, g, b, a]) {
  dst[0] += (r - dst[0]) * a;
  dst[1] += (g - dst[1]) * a;
  dst[2] += (b - dst[2]) * a;
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Jet polygons placed on the canvas at the given scale.
function jetShapes(scale = JET_SCALE) {
  const a = (JET_ANGLE * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const place = (pts) => pts.map(([x, y]) => [JET_CENTER[0] + (x * c - y * s) * scale, JET_CENTER[1] + (x * s + y * c) * scale]);
  const right = JET_HALF;
  const left = JET_HALF.map(([x, y]) => [-x, y]).reverse();
  return {
    light: place(left),
    shade: place(right),
    outline: place([...right, ...left.slice(1, -1)]),
    canopy: place(CANOPY),
    // Canopy gradient runs from its front tip to its back tip.
    canopyAxis: place([CANOPY[0], CANOPY[2]]),
  };
}

function sample(x, y, jet, rounded) {
  if (rounded) {
    const cx = Math.min(Math.max(x, RADIUS), S - RADIUS);
    const cy = Math.min(Math.max(y, RADIUS), S - RADIUS);
    if ((x - cx) ** 2 + (y - cy) ** 2 > RADIUS * RADIUS) return null;
  }
  const col = ramp(SKY, y / S).slice(0, 3);

  const g = Math.hypot(x - GLOW.cx, y - GLOW.cy) / GLOW.r;
  over(col, [...hex(GLOW.color), ramp(GLOW.stops.map(([t, a]) => [t, GLOW.color, a]), g)[3]]);

  const d = Math.hypot(x - PLANET.cx, y - PLANET.cy);
  const top = PLANET.cy - PLANET.r;
  if (d < PLANET.r) over(col, ramp(PLANET_FILL, (y - top) / (S - top)));
  if (Math.abs(d - PLANET.r) < RIM_WIDTH / 2) over(col, ramp(RIM, x / S));

  if (inPoly(x - SHADOW.dx, y - SHADOW.dy, jet.outline)) over(col, [0, 0, 0, SHADOW.alpha]);
  if (inPoly(x, y, jet.light)) over(col, [...hex(JET_LIGHT), 1]);
  if (inPoly(x, y, jet.shade)) over(col, [...hex(JET_SHADE), 1]);
  if (inPoly(x, y, jet.canopy)) {
    const [[ax, ay], [bx, by]] = jet.canopyAxis;
    const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
    over(col, ramp(CANOPY_FILL, t));
  }
  return col;
}

function render(size, { rounded = false, jetScale = JET_SCALE } = {}) {
  const jet = jetShapes(jetScale);
  const px = Buffer.alloc(size * size * 4);
  const ss = 5;
  const k = S / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((i + (sx + 0.5) / ss) * k, (j + (sy + 0.5) / ss) * k, jet, rounded);
          if (!c) continue;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          hits++;
        }
      }
      const o = (j * size + i) * 4;
      px[o] = hits ? Math.round(acc[0] / hits) : 0;
      px[o + 1] = hits ? Math.round(acc[1] / hits) : 0;
      px[o + 2] = hits ? Math.round(acc[2] / hits) : 0;
      px[o + 3] = Math.round((hits / (ss * ss)) * 255);
    }
  }
  return encodePNG(size, size, px);
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const n = (v) => +v.toFixed(1);
  const poly = (pts) => pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  const stops = (list) => list.map(([t, c, a = 1]) => `<stop offset="${t}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');
  const jet = jetShapes();
  const top = PLANET.cy - PLANET.r;
  const [[ax, ay], [bx, by]] = jet.canopyAxis;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="${S}" gradientUnits="userSpaceOnUse">${stops(SKY)}</linearGradient>
<radialGradient id="glow" cx="${GLOW.cx}" cy="${GLOW.cy}" r="${GLOW.r}" gradientUnits="userSpaceOnUse">${stops(GLOW.stops.map(([t, a]) => [t, GLOW.color, a]))}</radialGradient>
<linearGradient id="planet" x1="0" y1="${top}" x2="0" y2="${S}" gradientUnits="userSpaceOnUse">${stops(PLANET_FILL)}</linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="${S}" y2="0" gradientUnits="userSpaceOnUse">${stops(RIM)}</linearGradient>
<linearGradient id="canopy" x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}" gradientUnits="userSpaceOnUse">${stops(CANOPY_FILL)}</linearGradient>
<clipPath id="r"><rect width="${S}" height="${S}" rx="${RADIUS}"/></clipPath>
</defs>
<g clip-path="url(#r)">
<rect width="${S}" height="${S}" fill="url(#sky)"/>
<rect width="${S}" height="${S}" fill="url(#glow)"/>
<circle cx="${PLANET.cx}" cy="${PLANET.cy}" r="${PLANET.r}" fill="url(#planet)"/>
<circle cx="${PLANET.cx}" cy="${PLANET.cy}" r="${PLANET.r}" fill="none" stroke="url(#rim)" stroke-width="${RIM_WIDTH}"/>
<polygon points="${poly(jet.outline)}" transform="translate(${SHADOW.dx} ${SHADOW.dy})" fill="#000" fill-opacity="${SHADOW.alpha}"/>
<polygon points="${poly(jet.light)}" fill="${JET_LIGHT}"/>
<polygon points="${poly(jet.shade)}" fill="${JET_SHADE}"/>
<polygon points="${poly(jet.canopy)}" fill="url(#canopy)"/>
</g>
</svg>
`;
}

const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  // Maskable: full bleed, emblem kept inside the central safe zone.
  'icon-maskable-512.png': render(512, { jetScale: 0.66 }),
  // iOS rounds the corners itself.
  'apple-touch-icon.png': render(180),
  'favicon.svg': svg(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), data);
  console.log('wrote', name);
}
