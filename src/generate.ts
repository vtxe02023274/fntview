import type { BMFont, Glyph, Kerning } from './font.js';

/** Size and placement of one rasterized glyph, before it is packed. */
export interface GlyphMetrics {
  id: number;
  /** Image size including padding. */
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

export interface Packed {
  /** Top left of each glyph image, in the same order as the input. */
  positions: { x: number; y: number }[];
  height: number;
}

export class PackError extends Error {}

/**
 * Shelf packing: tallest glyphs first, left to right, a new row when the
 * current one is full. Simple and close to optimal for font glyphs, which
 * are all about the same height.
 */
export function packGlyphs(
  glyphs: { width: number; height: number }[],
  pageWidth: number,
  spacing = 1,
  maxHeight = 4096,
): Packed {
  const order = glyphs.map((_, i) => i).sort((a, b) => glyphs[b]!.height - glyphs[a]!.height);
  const positions: { x: number; y: number }[] = new Array(glyphs.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const i of order) {
    const g = glyphs[i]!;
    if (g.width > pageWidth)
      throw new PackError(`a glyph is ${g.width}px wide, the page ${pageWidth}px`);
    if (x + g.width > pageWidth) {
      x = 0;
      y += rowHeight + spacing;
      rowHeight = 0;
    }
    positions[i] = { x, y };
    x += g.width + spacing;
    rowHeight = Math.max(rowHeight, g.height);
  }
  const height = y + rowHeight;
  if (height > maxHeight) {
    throw new PackError(
      `the glyphs need a ${pageWidth}x${height} page, more than ${maxHeight} high`,
    );
  }
  return { positions, height };
}

/** Rounds up to a multiple of 4, which most GPUs and texture tools like. */
export const pageHeightFor = (height: number) => Math.max(4, Math.ceil(height / 4) * 4);

export interface FontSpec {
  face: string;
  size: number;
  lineHeight: number;
  base: number;
  padding: number;
  pageWidth: number;
  pageHeight: number;
  page: string;
}

/** The descriptor for glyphs packed onto one page. */
export function buildFont(
  spec: FontSpec,
  glyphs: GlyphMetrics[],
  packed: Packed,
  kernings: Kerning[],
): BMFont {
  const chars: Glyph[] = glyphs.map((g, i) => ({
    id: g.id,
    x: packed.positions[i]!.x,
    y: packed.positions[i]!.y,
    width: g.width,
    height: g.height,
    xoffset: g.xoffset,
    yoffset: g.yoffset,
    xadvance: g.xadvance,
    page: 0,
    chnl: 15,
  }));
  const p = spec.padding;
  return {
    info: {
      face: spec.face,
      size: spec.size,
      bold: false,
      italic: false,
      unicode: true,
      smooth: true,
      fixedHeight: false,
      charset: '',
      stretchH: 100,
      aa: 1,
      padding: [p, p, p, p],
      spacing: [1, 1],
      outline: 0,
    },
    common: {
      lineHeight: spec.lineHeight,
      base: spec.base,
      scaleW: spec.pageWidth,
      scaleH: spec.pageHeight,
      pages: 1,
      packed: false,
      alphaChnl: 0,
      redChnl: 4,
      greenChnl: 4,
      blueChnl: 4,
    },
    pages: [spec.page],
    chars: chars.sort((a, b) => a.id - b.id),
    kernings,
  };
}

/** Code points of a character list, without duplicates, in order. */
export function codePoints(text: string): number[] {
  return [...new Set([...text].map((c) => c.codePointAt(0)!))].filter((c) => c !== 10 && c !== 13);
}

export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
