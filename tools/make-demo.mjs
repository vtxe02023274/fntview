// Writes public/demo.fnt and public/demo.png: a 3x5 pixel font designed for
// this project, so the demo ships no third party font. Run with
// `node tools/make-demo.mjs`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GLYPHS = {
  A: '010 101 111 101 101',
  B: '110 101 110 101 110',
  C: '011 100 100 100 011',
  D: '110 101 101 101 110',
  E: '111 100 110 100 111',
  F: '111 100 110 100 100',
  G: '011 100 101 101 011',
  H: '101 101 111 101 101',
  I: '111 010 010 010 111',
  J: '001 001 001 101 010',
  K: '101 101 110 101 101',
  L: '100 100 100 100 111',
  M: '101 111 111 101 101',
  N: '110 101 101 101 101',
  O: '010 101 101 101 010',
  P: '110 101 110 100 100',
  Q: '010 101 101 110 011',
  R: '110 101 110 101 101',
  S: '011 100 010 001 110',
  T: '111 010 010 010 010',
  U: '101 101 101 101 111',
  V: '101 101 101 101 010',
  W: '101 101 111 111 101',
  X: '101 101 010 101 101',
  Y: '101 101 010 010 010',
  Z: '111 001 010 100 111',
  0: '111 101 101 101 111',
  1: '010 110 010 010 111',
  2: '110 001 010 100 111',
  3: '110 001 010 001 110',
  4: '101 101 111 001 001',
  5: '111 100 110 001 110',
  6: '011 100 111 101 111',
  7: '111 001 010 010 010',
  8: '111 101 111 101 111',
  9: '111 101 111 001 110',
  '!': '010 010 010 000 010',
  '?': '110 001 010 000 010',
  '.': '000 000 000 000 010',
  ',': '000 000 000 010 100',
  '-': '000 000 111 000 000',
  ':': '000 010 000 010 000',
  "'": '010 010 000 000 000',
};

const W = 64;
const H = 32;
const CELL_W = 4;
const CELL_H = 6;
const COLUMNS = W / CELL_W;
const pixels = Buffer.alloc(W * H * 4);

const chars = [];
Object.entries(GLYPHS).forEach(([ch, rows], i) => {
  const cx = (i % COLUMNS) * CELL_W;
  const cy = Math.floor(i / COLUMNS) * CELL_H;
  rows.split(' ').forEach((row, y) => {
    [...row].forEach((bit, x) => {
      if (bit === '1') pixels.set([255, 255, 255, 255], ((cy + y) * W + cx + x) * 4);
    });
  });
  const glyph = { x: cx, y: cy, width: 3, height: 5, xoffset: 0, yoffset: 1, xadvance: 4 };
  chars.push({ id: ch.charCodeAt(0), ...glyph });
  // Lowercase letters reuse the capitals.
  if (/[A-Z]/.test(ch)) chars.push({ id: ch.toLowerCase().charCodeAt(0), ...glyph });
});
chars.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 3 });
chars.sort((a, b) => a.id - b.id);

const kernings = [
  ['L', 'T', -1],
  ['T', 'A', -1],
  ['A', 'T', -1],
  ['L', 'V', -1],
];

const lines = [
  'info face="fntview 3x5" size=5 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1 outline=0',
  `common lineHeight=7 base=6 scaleW=${W} scaleH=${H} pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4`,
  'page id=0 file="demo.png"',
  `chars count=${chars.length}`,
  ...chars.map(
    (c) =>
      `char id=${c.id} x=${c.x} y=${c.y} width=${c.width} height=${c.height} xoffset=${c.xoffset} yoffset=${c.yoffset} xadvance=${c.xadvance} page=0 chnl=15`,
  ),
  `kernings count=${kernings.length * 2}`,
  ...kernings.flatMap(([a, b, n]) => [
    `kerning first=${a.charCodeAt(0)} second=${b.charCodeAt(0)} amount=${n}`,
    `kerning first=${a.toLowerCase().charCodeAt(0)} second=${b.toLowerCase().charCodeAt(0)} amount=${n}`,
  ]),
];
writeFileSync(new URL('../public/demo.fnt', import.meta.url), lines.join('\n') + '\n');

// Minimal PNG writer.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const writePng = (name, w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(
    new URL(`../public/${name}`, import.meta.url),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
};
writePng('demo.png', W, H, pixels);
console.log(`public/demo.fnt: ${chars.length} chars, public/demo.png: ${W}x${H}`);

// The same font as a signed distance field: every font pixel is UNIT atlas
// pixels, with PAD pixels of distance around each glyph, so it stays sharp
// at any zoom.
const UNIT = 8;
const PAD = 4;
const RANGE = 8;
const SW = 3 * UNIT + 2 * PAD;
const SH = 5 * UNIT + 2 * PAD;
const SDF_COLUMNS = 16;
const entries = Object.entries(GLYPHS);
const SDF_W = SDF_COLUMNS * SW;
const SDF_H = Math.ceil(entries.length / SDF_COLUMNS) * SH;
const sdf = Buffer.alloc(SDF_W * SDF_H * 4);

const boxDistance = (px, py, bx, by) => {
  const dx = Math.max(bx - px, 0, px - (bx + UNIT));
  const dy = Math.max(by - py, 0, py - (by + UNIT));
  return Math.hypot(dx, dy);
};

const sdfChars = [];
entries.forEach(([ch, rows], i) => {
  const ox = (i % SDF_COLUMNS) * SW;
  const oy = Math.floor(i / SDF_COLUMNS) * SH;
  const filled = [];
  const empty = [];
  // Empty cells reach one cell past the glyph so the outside counts too.
  for (let y = -1; y <= 5; y++) {
    for (let x = -1; x <= 3; x++) {
      const on = y >= 0 && y < 5 && x >= 0 && x < 3 && rows.split(' ')[y][x] === '1';
      (on ? filled : empty).push([PAD + x * UNIT, PAD + y * UNIT]);
    }
  }
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const outside = Math.min(...filled.map(([bx, by]) => boxDistance(px, py, bx, by)));
      const inside = Math.min(...empty.map(([bx, by]) => boxDistance(px, py, bx, by)));
      const signed = outside > 0 ? -outside : inside;
      const v = Math.round(Math.min(1, Math.max(0, 0.5 + signed / RANGE)) * 255);
      sdf.set([v, v, v, 255], ((oy + y) * SDF_W + ox + x) * 4);
    }
  }
  const glyph = {
    x: ox,
    y: oy,
    width: SW,
    height: SH,
    xoffset: -PAD,
    yoffset: UNIT - PAD,
    xadvance: 4 * UNIT,
  };
  sdfChars.push({ id: ch.charCodeAt(0), ...glyph });
  if (/[A-Z]/.test(ch)) sdfChars.push({ id: ch.toLowerCase().charCodeAt(0), ...glyph });
});
sdfChars.push({
  id: 32,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  xoffset: 0,
  yoffset: 0,
  xadvance: 3 * UNIT,
});
sdfChars.sort((a, b) => a.id - b.id);

const sdfLines = [
  `info face="fntview 3x5 sdf" size=${5 * UNIT} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=${PAD},${PAD},${PAD},${PAD} spacing=0,0 outline=0`,
  `common lineHeight=${7 * UNIT} base=${6 * UNIT} scaleW=${SDF_W} scaleH=${SDF_H} pages=1 packed=0 alphaChnl=0 redChnl=0 greenChnl=0 blueChnl=0`,
  'page id=0 file="demo-sdf.png"',
  `chars count=${sdfChars.length}`,
  ...sdfChars.map(
    (c) =>
      `char id=${c.id} x=${c.x} y=${c.y} width=${c.width} height=${c.height} xoffset=${c.xoffset} yoffset=${c.yoffset} xadvance=${c.xadvance} page=0 chnl=15`,
  ),
  `kernings count=${kernings.length * 2}`,
  ...kernings.flatMap(([a, b, n]) => [
    `kerning first=${a.charCodeAt(0)} second=${b.charCodeAt(0)} amount=${n * UNIT}`,
    `kerning first=${a.toLowerCase().charCodeAt(0)} second=${b.toLowerCase().charCodeAt(0)} amount=${n * UNIT}`,
  ]),
  `distanceField fieldType=sdf distanceRange=${RANGE}`,
];
writeFileSync(new URL('../public/demo-sdf.fnt', import.meta.url), sdfLines.join('\n') + '\n');
writePng('demo-sdf.png', SDF_W, SDF_H, sdf);
console.log(
  `public/demo-sdf.fnt: ${sdfChars.length} chars, public/demo-sdf.png: ${SDF_W}x${SDF_H}`,
);
