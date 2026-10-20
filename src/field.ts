import type { DistanceField } from './font.js';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

const median = (a: number, b: number, c: number) =>
  Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/**
 * The signed distance stored in one RGBA sample, 0 to 1 with 0.5 on the edge.
 * Multi-channel fields take the median of RGB. Single-channel fields are
 * written either into RGB (msdfgen) or into alpha with white RGB (Hiero), and
 * the smaller of the two picks whichever one holds the distance.
 */
export function sampleDistance(field: DistanceField, r: number, g: number, b: number, a: number) {
  const value =
    field.fieldType === 'msdf' || field.fieldType === 'mtsdf'
      ? median(r, g, b)
      : Math.min(median(r, g, b), a);
  return value / 255;
}

/**
 * Renders the glyph at `rect` of a distance field page `scale` times its atlas
 * size, the same way the usual MSDF shader does: bilinear samples, then the
 * distance in screen pixels turned into coverage. Returns one alpha value per
 * output pixel.
 */
export function decodeGlyph(
  page: Pixels,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
  field: DistanceField,
): { width: number; height: number; alpha: Uint8ClampedArray } {
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const alpha = new Uint8ClampedArray(width * height);
  const screenRange = field.distanceRange * scale;
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = Math.min(page.width, rect.x + rect.width) - 1;
  const y1 = Math.min(page.height, rect.y + rect.height) - 1;
  const at = (x: number, y: number, c: number) => page.data[(y * page.width + x) * 4 + c]!;

  for (let oy = 0; oy < height; oy++) {
    const sy = Math.min(y1, Math.max(y0, y0 + (oy + 0.5) / scale - 0.5));
    const ya = Math.floor(sy);
    const yb = Math.min(y1, ya + 1);
    const fy = sy - ya;
    for (let ox = 0; ox < width; ox++) {
      const sx = Math.min(x1, Math.max(x0, x0 + (ox + 0.5) / scale - 0.5));
      const xa = Math.floor(sx);
      const xb = Math.min(x1, xa + 1);
      const fx = sx - xa;
      const lerp = (c: number) =>
        (at(xa, ya, c) * (1 - fx) + at(xb, ya, c) * fx) * (1 - fy) +
        (at(xa, yb, c) * (1 - fx) + at(xb, yb, c) * fx) * fy;
      const d = sampleDistance(field, lerp(0), lerp(1), lerp(2), lerp(3));
      const coverage = Math.min(1, Math.max(0, (d - 0.5) * screenRange + 0.5));
      alpha[oy * width + ox] = Math.round(coverage * 255);
    }
  }
  return { width, height, alpha };
}
