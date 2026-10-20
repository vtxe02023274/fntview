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
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) pixels.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  new URL('../public/demo.png', import.meta.url),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`public/demo.fnt: ${chars.length} chars, public/demo.png: ${W}x${H}`);
