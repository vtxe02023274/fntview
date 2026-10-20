import { describe, expect, it } from 'vitest';
import { blankFont } from '../src/blank.js';

function tables(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  const out = new Map<string, DataView>();
  for (let i = 0; i < v.getUint16(4); i++) {
    const entry = 12 + i * 16;
    const tag = String.fromCharCode(...new Uint8Array(buffer, entry, 4));
    out.set(tag, new DataView(buffer, v.getUint32(entry + 8), v.getUint32(entry + 12)));
  }
  return out;
}

describe('blankFont', () => {
  it('maps every character to one empty glyph with the given advance', () => {
    const t = tables(blankFont(1000));
    expect([...t.keys()]).toEqual([...t.keys()].sort());
    expect(t.get('maxp')!.getUint16(4)).toBe(2);
    expect(t.get('hmtx')!.getUint16(4)).toBe(1000);

    const cmap = t.get('cmap')!;
    expect([cmap.getUint16(4), cmap.getUint16(6), cmap.getUint16(12)]).toEqual([3, 10, 13]);
    const glyphFor = (code: number) => {
      for (let g = 0; g < cmap.getUint32(24); g++) {
        const p = 28 + g * 12;
        if (code >= cmap.getUint32(p) && code <= cmap.getUint32(p + 4))
          return cmap.getUint32(p + 8);
      }
      return 0;
    };
    expect([0x41, 0x4e2d, 0x3042, 0x1f600, 0x10ffff].map(glyphFor)).toEqual([1, 1, 1, 1, 1]);
    expect(glyphFor(0xd800)).toBe(0);
  });
});
