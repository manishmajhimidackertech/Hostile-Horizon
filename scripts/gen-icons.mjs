// Generates the PWA icons (PNG + SVG) without any image dependencies.
// Usage: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = '#0b1522';
const GROUND = '#14283c';
const RIDGE = '#1d3a55';
const SUN_TOP = '#ffd36b';
const SUN_BOTTOM = '#f07a1c';
const JET = '#eef3f8';
const JET_SHADE = '#9fb2c4';

// Shapes are defined on a 512x512 canvas.
const JET_PARTS = [
  { color: JET, pts: [[432, 252], [372, 238], [332, 225], [292, 229], [140, 240], [116, 246], [116, 263], [140, 267], [372, 266]] },
  { color: JET, pts: [[204, 242], [162, 166], [132, 166], [150, 244]] },
  { color: JET_SHADE, pts: [[304, 258], [204, 340], [166, 340], [214, 258]] },
  { color: JET_SHADE, pts: [[162, 258], [122, 294], [100, 294], [126, 258]] },
  { color: '#2a4863', pts: [[364, 240], [332, 228], [296, 232], [300, 244]] },
];
const HORIZON = 330;
const RIDGE_PTS = [[0, 512], [0, 342], [70, 318], [140, 336], [230, 306], [320, 334], [400, 312], [512, 336], [512, 512]];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function transformJet(scale, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return JET_PARTS.map((p) => ({
    color: p.color,
    pts: p.pts.map(([x, y]) => {
      const dx = (x - 270) * scale;
      const dy = (y - 252) * scale;
      return [256 + dx * c - dy * s, 236 + dx * s + dy * c];
    }),
  }));
}

function sample(x, y, jet, rounded) {
  if (rounded) {
    const r = 96;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  let col = hex(BG);
  const sunR = 150;
  if (y < HORIZON && (x - 256) ** 2 + (y - HORIZON) ** 2 < sunR * sunR) {
    col = lerp(hex(SUN_TOP), hex(SUN_BOTTOM), (y - (HORIZON - sunR)) / sunR);
  }
  if (y >= HORIZON) col = hex(GROUND);
  if (inPoly(x, y, RIDGE_PTS)) col = hex(RIDGE);
  if (y > 400 && inPoly(x, y, RIDGE_PTS)) col = hex(GROUND);
  for (const p of jet) if (inPoly(x, y, p.pts)) col = hex(p.color);
  return [...col, 255];
}

function render(size, { rounded = false, jetScale = 1 } = {}) {
  const jet = transformJet(jetScale, -12);
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  const k = 512 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((i + (sx + 0.5) / ss) * k, (j + (sy + 0.5) / ss) * k, jet, rounded);
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const o = (j * size + i) * 4;
      const a = acc[3];
      px[o] = a ? Math.round(acc[0] / a) : 0;
      px[o + 1] = a ? Math.round(acc[1] / a) : 0;
      px[o + 2] = a ? Math.round(acc[2] / a) : 0;
      px[o + 3] = Math.round(a / (ss * ss));
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
  const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const jet = transformJet(1, -12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SUN_TOP}"/><stop offset="1" stop-color="${SUN_BOTTOM}"/></linearGradient>
<clipPath id="c"><rect width="512" height="512" rx="96"/></clipPath><clipPath id="h"><rect width="512" height="${HORIZON}"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="512" height="512" fill="${BG}"/>
<circle cx="256" cy="${HORIZON}" r="150" fill="url(#s)" clip-path="url(#h)"/>
<rect y="${HORIZON}" width="512" height="${512 - HORIZON}" fill="${GROUND}"/>
<polygon points="${poly(RIDGE_PTS)}" fill="${RIDGE}"/><rect y="400" width="512" height="112" fill="${GROUND}"/>
${jet.map((p) => `<polygon points="${poly(p.pts)}" fill="${p.color}"/>`).join('\n')}</g></svg>
`;
}

const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  'icon-maskable-512.png': render(512, { jetScale: 0.78 }),
  'apple-touch-icon.png': render(180),
  'favicon.svg': svg(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), data);
  console.log('wrote', name);
}
