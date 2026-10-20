import type { BMFont, Glyph } from './font.js';

export interface PlacedGlyph {
  glyph: Glyph;
  /** Top left of the glyph image, relative to the top of the first line. */
  x: number;
  y: number;
}

export interface TextLayout {
  glyphs: PlacedGlyph[];
  width: number;
  height: number;
  /** Code points that have no glyph in the font. */
  missing: number[];
}

const ZERO_WIDTH = /^[\p{M}\p{Cf}]$/u;

/**
 * Places text the way BMFont describes it: each glyph is drawn at the pen
 * position plus its offsets, the pen moves by xadvance plus the kerning
 * amount for the pair, and a newline moves down by lineHeight.
 */
export function layoutText(font: BMFont, text: string): TextLayout {
  const byId = new Map(font.chars.map((g) => [g.id, g]));
  const kerning = new Map(font.kernings.map((k) => [`${k.first},${k.second}`, k.amount]));
  const fallback = byId.get(0xfffd) ?? byId.get(0x3f);

  const glyphs: PlacedGlyph[] = [];
  const missing = new Set<number>();
  let x = 0;
  let y = 0;
  let width = 0;
  let previous: number | undefined;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 10) {
      x = 0;
      y += font.common.lineHeight;
      previous = undefined;
      continue;
    }
    let glyph = byId.get(code);
    if (!glyph) {
      // Combining marks, variation selectors and joiners take no room, a
      // fallback box for them would only get in the way.
      if (ZERO_WIDTH.test(ch)) continue;
      missing.add(code);
      glyph = fallback;
      if (!glyph) {
        previous = undefined;
        continue;
      }
    }
    if (previous !== undefined) x += kerning.get(`${previous},${glyph.id}`) ?? 0;
    glyphs.push({ glyph, x: x + glyph.xoffset, y: y + glyph.yoffset });
    x += glyph.xadvance;
    width = Math.max(width, x, x - glyph.xadvance + glyph.xoffset + glyph.width);
    previous = glyph.id;
  }
  return { glyphs, width, height: y + font.common.lineHeight, missing: [...missing] };
}
