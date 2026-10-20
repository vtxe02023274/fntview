import { describe, expect, it } from 'vitest';
import { checkFont } from '../src/check.js';
import { parseFont, writeText } from '../src/font.js';
import { buildFont, codePoints, packGlyphs, PackError, pageHeightFor } from '../src/generate.js';

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('packGlyphs', () => {
  it('fits every glyph inside the page without overlaps', () => {
    let seed = 3;
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    const glyphs = Array.from({ length: 300 }, () => ({ width: 2 + rnd(30), height: 8 + rnd(28) }));
    const { positions, height } = packGlyphs(glyphs, 256);
    const rects = glyphs.map((g, i) => ({ ...positions[i]!, ...g }));
    for (const r of rects) {
      expect(r.x + r.width).toBeLessThanOrEqual(256);
      expect(r.y + r.height).toBeLessThanOrEqual(height);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it('says when the glyphs do not fit', () => {
    expect(() => packGlyphs([{ width: 300, height: 10 }], 256)).toThrow(PackError);
    expect(() => packGlyphs(Array(100).fill({ width: 200, height: 50 }), 256, 1, 1024)).toThrow(
      /more than 1024 high/,
    );
  });
});

describe('buildFont', () => {
  it('writes a descriptor that reads back and passes the checks', () => {
    const glyphs = [
      { id: 65, width: 12, height: 14, xoffset: -1, yoffset: 3, xadvance: 10 },
      { id: 32, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 5 },
      { id: 66, width: 11, height: 14, xoffset: 0, yoffset: 3, xadvance: 10 },
    ];
    const packed = packGlyphs(glyphs, 64);
    const font = buildFont(
      {
        face: 'Test',
        size: 16,
        lineHeight: 19,
        base: 15,
        padding: 1,
        pageWidth: 64,
        pageHeight: pageHeightFor(packed.height),
        page: 'Test_0.png',
      },
      glyphs,
      packed,
      [{ first: 65, second: 66, amount: -1 }],
    );
    expect(font.chars.map((c) => c.id)).toEqual([32, 65, 66]);
    expect(parseFont(new TextEncoder().encode(writeText(font)))).toEqual(font);
    expect(checkFont(font, [{ width: 64, height: font.common.scaleH }])).toEqual([]);
  });

  it('turns a character list into unique code points', () => {
    expect(codePoints('aba\n€😀')).toEqual([97, 98, 0x20ac, 0x1f600]);
  });
});
