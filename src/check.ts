import type { BMFont } from './font.js';

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
}

const describe = (id: number) =>
  id >= 0x20 && id < 0x7f
    ? `'${String.fromCharCode(id)}' (${id})`
    : `U+${id.toString(16).toUpperCase().padStart(4, '0')}`;

/** Combining marks and format characters such as joiners are meant to take no room. */
const zeroWidth = (id: number) =>
  id <= 0x10ffff && /^[\p{M}\p{Cf}]$/u.test(String.fromCodePoint(id));

/** Problems that show up as missing or garbled text in a game. */
export function checkFont(
  font: BMFont,
  pageSizes?: ({ width: number; height: number } | undefined)[],
): Problem[] {
  const out: Problem[] = [];
  const error = (message: string) => out.push({ severity: 'error', message });
  const warning = (message: string) => out.push({ severity: 'warning', message });
  const { common } = font;

  if (common.pages !== font.pages.length) {
    warning(`common says ${common.pages} pages but ${font.pages.length} are listed`);
  }
  pageSizes?.forEach((size, i) => {
    if (size && (size.width !== common.scaleW || size.height !== common.scaleH)) {
      warning(
        `page ${i} is ${size.width}x${size.height} but the font says ${common.scaleW}x${common.scaleH}`,
      );
    }
  });

  const seen = new Set<number>();
  for (const g of font.chars) {
    const name = describe(g.id);
    if (seen.has(g.id)) error(`${name} is defined more than once`);
    seen.add(g.id);
    if (g.page >= font.pages.length) error(`${name} is on page ${g.page}, which does not exist`);
    if (g.x + g.width > common.scaleW || g.y + g.height > common.scaleH) {
      error(
        `${name} at ${g.x},${g.y} ${g.width}x${g.height} reaches outside the ${common.scaleW}x${common.scaleH} page`,
      );
    }
    if (g.xadvance < 0 || (g.xadvance === 0 && !zeroWidth(g.id)))
      warning(`${name} has xadvance ${g.xadvance}, text after it will overlap`);
  }
  if (!seen.has(32))
    warning("there is no space character (32), spaces will be skipped or drawn as '?'");
  if (font.chars.length && common.lineHeight <= 0)
    error('lineHeight is 0, every line lands on the same spot');

  const kerned = new Set<string>();
  for (const k of font.kernings) {
    if (!seen.has(k.first) || !seen.has(k.second)) {
      warning(
        `kerning ${describe(k.first)} ${describe(k.second)} refers to a character that is not in the font`,
      );
    }
    const key = `${k.first},${k.second}`;
    if (kerned.has(key))
      warning(`kerning ${describe(k.first)} ${describe(k.second)} is listed twice`);
    kerned.add(key);
  }
  return out;
}
