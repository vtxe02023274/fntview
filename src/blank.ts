/**
 * A TrueType font with one empty glyph mapped to every code point. Used as
 * the fallback after a face whose coverage we want to know: the browser
 * only reaches it for characters the face lacks, and its fixed advance
 * shows up in measureText where a system fallback font would not.
 */
export function blankFont(advance: number): ArrayBuffer {
  const unitsPerEm = 1000;
  const tables: Record<string, Uint8Array> = {};
  const table = (tag: string, size: number, fill: (v: DataView) => void) => {
    const bytes = new Uint8Array(size);
    fill(new DataView(bytes.buffer));
    tables[tag] = bytes;
  };

  // Surrogates are not characters, everything else goes to glyph 1.
  const groups = [
    [0, 0xd7ff],
    [0xe000, 0x10ffff],
  ];
  table('cmap', 4 + 8 + 16 + groups.length * 12, (v) => {
    v.setUint16(2, 1);
    v.setUint16(4, 3);
    v.setUint16(6, 10);
    v.setUint32(8, 12);
    v.setUint16(12, 13);
    v.setUint32(16, 16 + groups.length * 12);
    v.setUint32(24, groups.length);
    groups.forEach(([start, end], i) => {
      v.setUint32(28 + i * 12, start!);
      v.setUint32(32 + i * 12, end!);
      v.setUint32(36 + i * 12, 1);
    });
  });
  // Browsers reject an empty glyf table, both glyphs are empty all the same.
  table('glyf', 4, () => {});
  table('head', 54, (v) => {
    v.setUint32(0, 0x10000);
    v.setUint32(4, 0x10000);
    v.setUint32(12, 0x5f0f3cf5);
    v.setUint16(16, 0x000b);
    v.setUint16(18, unitsPerEm);
    v.setUint16(46, 8);
    v.setInt16(48, 2);
  });
  table('hhea', 36, (v) => {
    v.setUint32(0, 0x10000);
    v.setInt16(4, 800);
    v.setInt16(6, -200);
    v.setUint16(10, advance);
    v.setInt16(18, 1);
    v.setUint16(34, 2);
  });
  table('hmtx', 8, (v) => {
    v.setUint16(0, advance);
    v.setUint16(4, advance);
  });
  table('loca', 6, () => {});
  table('maxp', 32, (v) => {
    v.setUint32(0, 0x10000);
    v.setUint16(4, 2);
    v.setUint16(14, 2);
  });
  table('name', 6, (v) => v.setUint16(4, 6));
  table('OS/2', 96, (v) => {
    v.setUint16(0, 3);
    v.setInt16(2, advance);
    v.setUint16(4, 400);
    v.setUint16(6, 5);
    v.setUint16(62, 0x40);
    v.setUint16(66, 0xffff);
    v.setInt16(68, 800);
    v.setInt16(70, -200);
    v.setUint16(74, 800);
    v.setUint16(76, 200);
  });
  table('post', 32, (v) => v.setUint32(0, 0x30000));

  const tags = Object.keys(tables).sort();
  const header = 12 + tags.length * 16;
  const padded = (n: number) => (n + 3) & ~3;
  const size = tags.reduce((n, tag) => n + padded(tables[tag]!.length), header);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const log2 = Math.floor(Math.log2(tags.length));
  v.setUint32(0, 0x10000);
  v.setUint16(4, tags.length);
  v.setUint16(6, 16 << log2);
  v.setUint16(8, log2);
  v.setUint16(10, tags.length * 16 - (16 << log2));
  let offset = header;
  tags.forEach((tag, i) => {
    const data = tables[tag]!;
    out.set(data, offset);
    let sum = 0;
    for (let p = 0; p < data.length; p += 4) sum = (sum + v.getUint32(offset + p)) >>> 0;
    const entry = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[entry + k] = tag.charCodeAt(k);
    v.setUint32(entry + 4, sum);
    v.setUint32(entry + 8, offset);
    v.setUint32(entry + 12, data.length);
    offset += padded(data.length);
  });
  return out.buffer;
}
