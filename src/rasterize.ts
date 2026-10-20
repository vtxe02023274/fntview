import { blankFont } from './blank.js';
import type { BMFont, Kerning } from './font.js';
import { buildFont, codePoints, packGlyphs, pageHeightFor, type GlyphMetrics } from './generate.js';

export interface MakeOptions {
  size: number;
  text: string;
  padding: number;
  pageWidth: number;
}

/** Kerning is measured for every pair, so only for character lists up to this size. */
const MAX_KERNED_CHARS = 200;

/**
 * Rasterizes a font file with the browser's text renderer into one white
 * page and a BMFont descriptor for it. Metrics come from measureText, so
 * the result lines up with how the browser itself draws the font.
 * Characters the font does not have are left out and listed in missing.
 */
export async function makeFont(
  file: File,
  options: MakeOptions,
): Promise<{ font: BMFont; page: HTMLCanvasElement; missing: number[] }> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const family = `fntview ${name} ${Date.now()}`;
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);

  const { size, padding: p } = options;
  const css = `${size}px "${family}"`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = css;
  const line = measure.measureText('Hg');
  const ascent = Math.ceil(line.fontBoundingBoxAscent);
  const lineHeight = ascent + Math.ceil(line.fontBoundingBoxDescent);

  // measureText cannot tell a glyph of the face from one of a system
  // fallback font. Two blank fallbacks with different advances can: only a
  // character the face lacks measures differently between them.
  const blanks = await Promise.all(
    [0, 1000].map(async (advance) => {
      const blank = new FontFace(`${family} blank ${advance}`, blankFont(advance));
      await blank.load();
      document.fonts.add(blank);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${size}px "${family}", "${blank.family}"`;
      return { blank, ctx };
    }),
  );
  const missing: number[] = [];
  const codes = codePoints(options.text).filter((id) => {
    const [a, b] = blanks.map(({ ctx }) => ctx.measureText(String.fromCodePoint(id)).width);
    if (a === b) return true;
    missing.push(id);
    return false;
  });
  for (const { blank } of blanks) document.fonts.delete(blank);
  const advances = new Map<number, number>();
  const draws: { left: number; top: number }[] = [];
  const glyphs: GlyphMetrics[] = codes.map((id) => {
    const m = measure.measureText(String.fromCodePoint(id));
    advances.set(id, m.width);
    const left = Math.ceil(m.actualBoundingBoxLeft);
    const top = Math.ceil(m.actualBoundingBoxAscent);
    const width = left + Math.ceil(m.actualBoundingBoxRight);
    const height = top + Math.ceil(m.actualBoundingBoxDescent);
    draws.push({ left, top });
    if (width <= 0 || height <= 0) {
      return { id, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: Math.round(m.width) };
    }
    return {
      id,
      width: width + 2 * p,
      height: height + 2 * p,
      xoffset: -left - p,
      yoffset: ascent - top - p,
      xadvance: Math.round(m.width),
    };
  });

  const packed = packGlyphs(glyphs, options.pageWidth);
  const page = document.createElement('canvas');
  page.width = options.pageWidth;
  page.height = pageHeightFor(packed.height);
  const ctx = page.getContext('2d')!;
  ctx.font = css;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  glyphs.forEach((g, i) => {
    if (!g.width) return;
    const { x, y } = packed.positions[i]!;
    ctx.fillText(String.fromCodePoint(g.id), x + p + draws[i]!.left, y + p + draws[i]!.top);
  });

  const kernings: Kerning[] = [];
  if (codes.length <= MAX_KERNED_CHARS) {
    for (const first of codes) {
      for (const second of codes) {
        const pair = measure.measureText(String.fromCodePoint(first, second)).width;
        const amount = Math.round(pair - advances.get(first)! - advances.get(second)!);
        if (amount) kernings.push({ first, second, amount });
      }
    }
  }

  const font = buildFont(
    {
      face: name,
      size,
      lineHeight,
      base: ascent,
      padding: p,
      pageWidth: page.width,
      pageHeight: page.height,
      page: `${name}_0.png`,
    },
    glyphs,
    packed,
    kernings,
  );
  return { font, page, missing };
}
