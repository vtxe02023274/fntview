import { describe, expect, it } from 'vitest';
import { decodeGlyph, sampleDistance } from '../src/field.js';
import { parseFont, writeJson, writeText, writeXml } from '../src/font.js';

const enc = (s: string) => new TextEncoder().encode(s);
const head = 'info face="F" size=32\ncommon lineHeight=32 base=26 scaleW=8 scaleH=1 pages=1\n';

describe('distance field fonts', () => {
  it('reads the distanceField tag from text, XML and JSON and writes it back', () => {
    const text = parseFont(enc(`${head}distanceField fieldType=msdf distanceRange=4\n`));
    expect(text.distanceField).toEqual({ fieldType: 'msdf', distanceRange: 4 });
    expect(parseFont(enc(writeText(text))).distanceField).toEqual(text.distanceField);
    expect(parseFont(enc(writeXml(text))).distanceField).toEqual(text.distanceField);
    expect(parseFont(enc(writeJson(text))).distanceField).toEqual(text.distanceField);

    const json = JSON.parse(writeJson(text));
    json.distanceField = { fieldType: 'sdf', distanceRange: 8 };
    expect(parseFont(enc(JSON.stringify(json))).distanceField).toEqual({
      fieldType: 'sdf',
      distanceRange: 8,
    });
    expect(parseFont(enc(head)).distanceField).toBeUndefined();
  });

  it('takes the median for msdf and the stored channel for sdf', () => {
    const msdf = { fieldType: 'msdf', distanceRange: 4 } as const;
    const sdf = { fieldType: 'sdf', distanceRange: 4 } as const;
    expect(sampleDistance(msdf, 255, 0, 102, 255)).toBeCloseTo(0.4);
    // msdfgen writes the distance to RGB, Hiero to alpha under white.
    expect(sampleDistance(sdf, 51, 51, 51, 255)).toBeCloseTo(0.2);
    expect(sampleDistance(sdf, 255, 255, 255, 51)).toBeCloseTo(0.2);
  });

  it('turns distances into coverage scaled with the zoom', () => {
    // A real distance field for range 4: the distance grows by 1/4 per pixel
    // and the edge is between pixels 3 and 4.
    const values = [0, 0, 32, 96, 159, 223, 255, 255];
    const data = new Uint8ClampedArray(values.flatMap((v) => [v, v, v, 255]));
    const page = { width: 8, height: 1, data };
    const field = { fieldType: 'sdf', distanceRange: 4 } as const;

    const one = decodeGlyph(page, { x: 0, y: 0, width: 8, height: 1 }, 1, field);
    expect(one.width).toBe(8);
    expect(Array.from(one.alpha)).toEqual([0, 0, 0, 1, 254, 255, 255, 255]);

    // Zoomed in the edge stays as sharp in screen pixels instead of blurring.
    const four = decodeGlyph(page, { x: 0, y: 0, width: 8, height: 1 }, 4, field);
    expect(four.width).toBe(32);
    const partial = Array.from(four.alpha.subarray(0, 32)).filter((a) => a > 0 && a < 255);
    expect(partial.length).toBeLessThanOrEqual(2);
  });
});
