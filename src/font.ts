/**
 * AngelCode BMFont descriptors in all three flavours: text, XML and binary
 * (version 3). Spec: https://www.angelcode.com/products/bmfont/doc/file_format.html
 */

export interface FontInfo {
  face: string;
  size: number;
  bold: boolean;
  italic: boolean;
  unicode: boolean;
  smooth: boolean;
  fixedHeight: boolean;
  charset: string;
  stretchH: number;
  aa: number;
  /** Up, right, down, left. */
  padding: [number, number, number, number];
  /** Horizontal, vertical. */
  spacing: [number, number];
  outline: number;
}

export interface FontCommon {
  lineHeight: number;
  base: number;
  scaleW: number;
  scaleH: number;
  pages: number;
  packed: boolean;
  alphaChnl: number;
  redChnl: number;
  greenChnl: number;
  blueChnl: number;
}

export interface Glyph {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page: number;
  chnl: number;
}

export interface Kerning {
  first: number;
  second: number;
  amount: number;
}

/**
 * Signed distance field fonts from msdf-bmfont-xml and similar tools. The
 * pages hold distances instead of coverage and are decoded when drawn.
 */
export interface DistanceField {
  fieldType: 'sdf' | 'psdf' | 'msdf' | 'mtsdf';
  /** Width of the distance range in atlas pixels. */
  distanceRange: number;
}

export interface BMFont {
  info: FontInfo;
  common: FontCommon;
  pages: string[];
  chars: Glyph[];
  kernings: Kerning[];
  distanceField?: DistanceField;
}

const FIELD_TYPES = ['sdf', 'psdf', 'msdf', 'mtsdf'] as const;

function distanceField(fieldType: unknown, distanceRange: unknown): DistanceField | undefined {
  const type = String(fieldType ?? '').toLowerCase();
  const range = Number(distanceRange);
  if (!(FIELD_TYPES as readonly string[]).includes(type) || !(range > 0)) return undefined;
  return { fieldType: type as DistanceField['fieldType'], distanceRange: range };
}

export type FontFormat = 'text' | 'xml' | 'binary' | 'json';

export class FontError extends Error {}

export function detectFormat(bytes: Uint8Array): FontFormat {
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes[2] === 0x46) return 'binary';
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 256))
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('<')) return 'xml';
  if (head.startsWith('{')) return 'json';
  if (head.startsWith('info')) return 'text';
  throw new FontError('not a BMFont file (expected "info", "<font" or "BMF" at the start)');
}

export function parseFont(bytes: Uint8Array): BMFont {
  switch (detectFormat(bytes)) {
    case 'binary':
      return parseBinary(bytes);
    case 'xml':
      return parseTagged(new TextDecoder().decode(bytes), 'xml');
    case 'text':
      return parseTagged(new TextDecoder().decode(bytes), 'text');
    case 'json':
      return parseJson(new TextDecoder().decode(bytes));
  }
}

/**
 * The JSON layout written by msdf-bmfont-xml and read by three-bmfont-text,
 * PixiJS and others: the same fields as the text format, grouped by tag.
 */
function parseJson(source: string): BMFont {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(source);
  } catch (err) {
    throw new FontError(`invalid JSON: ${(err as Error).message}`);
  }
  if (!j.info || !j.common) throw new FontError('json font is missing its info or common object');
  const font = emptyFont();
  const info = j.info as Record<string, unknown>;
  const common = j.common as Record<string, unknown>;
  const n = (v: unknown, fallback = 0) =>
    typeof v === 'number' ? v : Number(v ?? fallback) || fallback;
  const pair = <T extends number[]>(v: unknown, length: number) =>
    (Array.isArray(v) ? v.map((x) => n(x)) : [])
      .concat(Array(length).fill(0))
      .slice(0, length) as T;
  font.info = {
    face: String(info.face ?? ''),
    size: n(info.size),
    bold: n(info.bold) === 1,
    italic: n(info.italic) === 1,
    unicode: n(info.unicode) === 1,
    smooth: n(info.smooth) === 1,
    fixedHeight: n(info.fixedHeight) === 1,
    charset: Array.isArray(info.charset) ? '' : String(info.charset ?? ''),
    stretchH: n(info.stretchH, 100),
    aa: n(info.aa, 1),
    padding: pair(info.padding, 4),
    spacing: pair(info.spacing, 2),
    outline: n(info.outline),
  };
  font.common = {
    lineHeight: n(common.lineHeight),
    base: n(common.base),
    scaleW: n(common.scaleW),
    scaleH: n(common.scaleH),
    pages: n(common.pages),
    packed: n(common.packed) === 1,
    alphaChnl: n(common.alphaChnl),
    redChnl: n(common.redChnl),
    greenChnl: n(common.greenChnl),
    blueChnl: n(common.blueChnl),
  };
  font.pages = Array.isArray(j.pages) ? j.pages.map(String) : [];
  font.chars = (Array.isArray(j.chars) ? j.chars : []).map((c: Record<string, unknown>) => ({
    id: n(c.id),
    x: n(c.x),
    y: n(c.y),
    width: n(c.width),
    height: n(c.height),
    xoffset: n(c.xoffset),
    yoffset: n(c.yoffset),
    xadvance: n(c.xadvance),
    page: n(c.page),
    chnl: n(c.chnl, 15),
  }));
  font.kernings = (Array.isArray(j.kernings) ? j.kernings : []).map(
    (k: Record<string, unknown>) => ({
      first: n(k.first),
      second: n(k.second),
      amount: n(k.amount),
    }),
  );
  const df = j.distanceField as Record<string, unknown> | undefined;
  const field = df && distanceField(df.fieldType, df.distanceRange);
  if (field) font.distanceField = field;
  return font;
}

// --- text and XML -------------------------------------------------------------

/** Both formats are a flat list of tags with attributes; only the syntax differs. */
function parseTagged(source: string, format: 'text' | 'xml'): BMFont {
  const tags: { name: string; attrs: Map<string, string> }[] = [];
  if (format === 'text') {
    for (const line of source.split(/\r?\n/)) {
      const m = /^\s*(\w+)(.*)$/.exec(line);
      if (m) tags.push({ name: m[1]!, attrs: attributes(m[2]!) });
    }
  } else {
    for (const m of source.matchAll(/<(\w+)((?:\s+[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g)) {
      const attrs = attributes(m[2]!);
      for (const [k, v] of attrs) attrs.set(k, decodeEntities(v));
      tags.push({ name: m[1]!, attrs });
    }
  }

  const font = emptyFont();
  let sawInfo = false;
  let sawCommon = false;
  for (const { name, attrs } of tags) {
    const n = (key: string, fallback = 0) => {
      const v = attrs.get(key);
      return v === undefined || v === '' ? fallback : Number(v);
    };
    const list = (key: string, length: number) =>
      (attrs.get(key) ?? '')
        .split(',')
        .map((v) => Number(v) || 0)
        .concat(Array(length).fill(0))
        .slice(0, length);
    switch (name) {
      case 'info':
        sawInfo = true;
        font.info = {
          face: attrs.get('face') ?? '',
          size: n('size'),
          bold: n('bold') === 1,
          italic: n('italic') === 1,
          unicode: n('unicode') === 1,
          smooth: n('smooth') === 1,
          fixedHeight: n('fixedHeight') === 1,
          charset: attrs.get('charset') ?? '',
          stretchH: n('stretchH', 100),
          aa: n('aa', 1),
          padding: list('padding', 4) as FontInfo['padding'],
          spacing: list('spacing', 2) as FontInfo['spacing'],
          outline: n('outline'),
        };
        break;
      case 'common':
        sawCommon = true;
        font.common = {
          lineHeight: n('lineHeight'),
          base: n('base'),
          scaleW: n('scaleW'),
          scaleH: n('scaleH'),
          pages: n('pages'),
          packed: n('packed') === 1,
          alphaChnl: n('alphaChnl'),
          redChnl: n('redChnl'),
          greenChnl: n('greenChnl'),
          blueChnl: n('blueChnl'),
        };
        break;
      case 'page':
        font.pages[n('id')] = attrs.get('file') ?? '';
        break;
      case 'char':
        font.chars.push({
          id: n('id'),
          x: n('x'),
          y: n('y'),
          width: n('width'),
          height: n('height'),
          xoffset: n('xoffset'),
          yoffset: n('yoffset'),
          xadvance: n('xadvance'),
          page: n('page'),
          chnl: n('chnl', 15),
        });
        break;
      case 'kerning':
        font.kernings.push({ first: n('first'), second: n('second'), amount: n('amount') });
        break;
      case 'distanceField': {
        const field = distanceField(attrs.get('fieldType'), attrs.get('distanceRange'));
        if (field) font.distanceField = field;
        break;
      }
    }
  }
  if (!sawInfo || !sawCommon)
    throw new FontError(`${format} font is missing its info or common tag`);
  font.pages = Array.from(font.pages, (p) => p ?? '');
  return font;
}

function attributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    attrs.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s.replace(/&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const named: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]!;
    return String.fromCodePoint(
      e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
    );
  });
}

function emptyFont(): BMFont {
  return {
    info: {
      face: '',
      size: 0,
      bold: false,
      italic: false,
      unicode: true,
      smooth: false,
      fixedHeight: false,
      charset: '',
      stretchH: 100,
      aa: 1,
      padding: [0, 0, 0, 0],
      spacing: [0, 0],
      outline: 0,
    },
    common: {
      lineHeight: 0,
      base: 0,
      scaleW: 0,
      scaleH: 0,
      pages: 0,
      packed: false,
      alphaChnl: 0,
      redChnl: 0,
      greenChnl: 0,
      blueChnl: 0,
    },
    pages: [],
    chars: [],
    kernings: [],
  };
}

// --- binary -------------------------------------------------------------------

function parseBinary(bytes: Uint8Array): BMFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[3] !== 3) throw new FontError(`binary version ${bytes[3]} is not supported, only 3`);
  const font = emptyFont();
  const cstring = (start: number, end: number): [string, number] => {
    let i = start;
    while (i < end && bytes[i] !== 0) i++;
    return [new TextDecoder().decode(bytes.subarray(start, i)), i + 1];
  };

  let o = 4;
  let sawInfo = false;
  let sawCommon = false;
  while (o + 5 <= bytes.length) {
    const type = bytes[o]!;
    const size = view.getUint32(o + 1, true);
    const start = o + 5;
    const end = start + size;
    if (end > bytes.length) throw new FontError(`block ${type} runs past the end of the file`);
    switch (type) {
      case 1: {
        sawInfo = true;
        // The spec numbers these bits from the high end: bit 0 is 0x80.
        const flags = bytes[start + 2]!;
        font.info = {
          size: view.getInt16(start, true),
          smooth: (flags & 0x80) !== 0,
          unicode: (flags & 0x40) !== 0,
          italic: (flags & 0x20) !== 0,
          bold: (flags & 0x10) !== 0,
          fixedHeight: (flags & 0x08) !== 0,
          charset: String(bytes[start + 3]!),
          stretchH: view.getUint16(start + 4, true),
          aa: bytes[start + 6]!,
          padding: [bytes[start + 7]!, bytes[start + 8]!, bytes[start + 9]!, bytes[start + 10]!],
          spacing: [bytes[start + 11]!, bytes[start + 12]!],
          outline: bytes[start + 13]!,
          face: cstring(start + 14, end)[0],
        };
        if (font.info.unicode) font.info.charset = '';
        break;
      }
      case 2:
        sawCommon = true;
        font.common = {
          lineHeight: view.getUint16(start, true),
          base: view.getUint16(start + 2, true),
          scaleW: view.getUint16(start + 4, true),
          scaleH: view.getUint16(start + 6, true),
          pages: view.getUint16(start + 8, true),
          packed: (bytes[start + 10]! & 0x01) !== 0,
          alphaChnl: bytes[start + 11]!,
          redChnl: bytes[start + 12]!,
          greenChnl: bytes[start + 13]!,
          blueChnl: bytes[start + 14]!,
        };
        break;
      case 3: {
        let p = start;
        while (p < end) {
          const [name, next] = cstring(p, end);
          font.pages.push(name);
          p = next;
        }
        break;
      }
      case 4:
        for (let p = start; p + 20 <= end; p += 20) {
          font.chars.push({
            id: view.getUint32(p, true),
            x: view.getUint16(p + 4, true),
            y: view.getUint16(p + 6, true),
            width: view.getUint16(p + 8, true),
            height: view.getUint16(p + 10, true),
            xoffset: view.getInt16(p + 12, true),
            yoffset: view.getInt16(p + 14, true),
            xadvance: view.getInt16(p + 16, true),
            page: bytes[p + 18]!,
            chnl: bytes[p + 19]!,
          });
        }
        break;
      case 5:
        for (let p = start; p + 10 <= end; p += 10) {
          font.kernings.push({
            first: view.getUint32(p, true),
            second: view.getUint32(p + 4, true),
            amount: view.getInt16(p + 8, true),
          });
        }
        break;
    }
    o = end;
  }
  if (!sawInfo || !sawCommon)
    throw new FontError('binary font is missing its info or common block');
  return font;
}

// --- writers ------------------------------------------------------------------

const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;
const b = (v: boolean) => (v ? 1 : 0);

export function writeText(font: BMFont): string {
  const { info: i, common: c } = font;
  const lines = [
    `info face=${quote(i.face)} size=${i.size} bold=${b(i.bold)} italic=${b(i.italic)} charset=${quote(i.charset)} unicode=${b(i.unicode)} stretchH=${i.stretchH} smooth=${b(i.smooth)} aa=${i.aa} padding=${i.padding.join(',')} spacing=${i.spacing.join(',')} outline=${i.outline} fixedHeight=${b(i.fixedHeight)}`,
    `common lineHeight=${c.lineHeight} base=${c.base} scaleW=${c.scaleW} scaleH=${c.scaleH} pages=${c.pages} packed=${b(c.packed)} alphaChnl=${c.alphaChnl} redChnl=${c.redChnl} greenChnl=${c.greenChnl} blueChnl=${c.blueChnl}`,
    ...font.pages.map((p, id) => `page id=${id} file=${quote(p)}`),
    `chars count=${font.chars.length}`,
    ...font.chars.map(
      (g) =>
        `char id=${g.id} x=${g.x} y=${g.y} width=${g.width} height=${g.height} xoffset=${g.xoffset} yoffset=${g.yoffset} xadvance=${g.xadvance} page=${g.page} chnl=${g.chnl}`,
    ),
  ];
  if (font.distanceField) {
    const { fieldType, distanceRange } = font.distanceField;
    lines.push(`distanceField fieldType=${fieldType} distanceRange=${distanceRange}`);
  }
  if (font.kernings.length) {
    lines.push(`kernings count=${font.kernings.length}`);
    for (const k of font.kernings)
      lines.push(`kerning first=${k.first} second=${k.second} amount=${k.amount}`);
  }
  return lines.join('\n') + '\n';
}

export function writeXml(font: BMFont): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const { info: i, common: c } = font;
  const out = [
    '<?xml version="1.0"?>',
    '<font>',
    `  <info face="${esc(i.face)}" size="${i.size}" bold="${b(i.bold)}" italic="${b(i.italic)}" charset="${esc(i.charset)}" unicode="${b(i.unicode)}" stretchH="${i.stretchH}" smooth="${b(i.smooth)}" aa="${i.aa}" padding="${i.padding.join(',')}" spacing="${i.spacing.join(',')}" outline="${i.outline}" fixedHeight="${b(i.fixedHeight)}"/>`,
    `  <common lineHeight="${c.lineHeight}" base="${c.base}" scaleW="${c.scaleW}" scaleH="${c.scaleH}" pages="${c.pages}" packed="${b(c.packed)}" alphaChnl="${c.alphaChnl}" redChnl="${c.redChnl}" greenChnl="${c.greenChnl}" blueChnl="${c.blueChnl}"/>`,
    '  <pages>',
    ...font.pages.map((p, id) => `    <page id="${id}" file="${esc(p)}" />`),
    '  </pages>',
    `  <chars count="${font.chars.length}">`,
    ...font.chars.map(
      (g) =>
        `    <char id="${g.id}" x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" xoffset="${g.xoffset}" yoffset="${g.yoffset}" xadvance="${g.xadvance}" page="${g.page}" chnl="${g.chnl}" />`,
    ),
    '  </chars>',
  ];
  if (font.kernings.length) {
    out.push(`  <kernings count="${font.kernings.length}">`);
    for (const k of font.kernings)
      out.push(`    <kerning first="${k.first}" second="${k.second}" amount="${k.amount}" />`);
    out.push('  </kernings>');
  }
  if (font.distanceField) {
    const { fieldType, distanceRange } = font.distanceField;
    out.push(`  <distanceField fieldType="${fieldType}" distanceRange="${distanceRange}"/>`);
  }
  out.push('</font>');
  return out.join('\n') + '\n';
}

export function writeJson(font: BMFont): string {
  const { info: i, common: c } = font;
  const b01 = (v: boolean) => (v ? 1 : 0);
  return (
    JSON.stringify(
      {
        pages: font.pages,
        chars: font.chars,
        info: {
          ...i,
          bold: b01(i.bold),
          italic: b01(i.italic),
          unicode: b01(i.unicode),
          smooth: b01(i.smooth),
          fixedHeight: b01(i.fixedHeight),
        },
        common: { ...c, packed: b01(c.packed) },
        kernings: font.kernings,
        ...(font.distanceField ? { distanceField: font.distanceField } : {}),
      },
      null,
      1,
    ) + '\n'
  );
}

export function writeBinary(font: BMFont): Uint8Array {
  const enc = new TextEncoder();
  const { info: i, common: c } = font;
  const blocks: Uint8Array[] = [];
  const block = (type: number, data: Uint8Array) => {
    const head = new Uint8Array(5);
    head[0] = type;
    new DataView(head.buffer).setUint32(1, data.length, true);
    blocks.push(head, data);
  };

  const face = enc.encode(i.face);
  const info = new Uint8Array(14 + face.length + 1);
  const iv = new DataView(info.buffer);
  iv.setInt16(0, i.size, true);
  info[2] =
    (i.smooth ? 0x80 : 0) |
    (i.unicode ? 0x40 : 0) |
    (i.italic ? 0x20 : 0) |
    (i.bold ? 0x10 : 0) |
    (i.fixedHeight ? 0x08 : 0);
  info[3] = i.unicode ? 0 : Number(i.charset) || 0;
  iv.setUint16(4, i.stretchH, true);
  info.set([i.aa, ...i.padding, ...i.spacing, i.outline], 6);
  info.set(face, 14);
  block(1, info);

  const common = new Uint8Array(15);
  const cv = new DataView(common.buffer);
  [c.lineHeight, c.base, c.scaleW, c.scaleH, c.pages].forEach((v, k) =>
    cv.setUint16(k * 2, v, true),
  );
  common.set([c.packed ? 1 : 0, c.alphaChnl, c.redChnl, c.greenChnl, c.blueChnl], 10);
  block(2, common);

  block(3, enc.encode(font.pages.map((p) => p + '\0').join('')));

  const chars = new Uint8Array(font.chars.length * 20);
  const hv = new DataView(chars.buffer);
  font.chars.forEach((g, k) => {
    const p = k * 20;
    hv.setUint32(p, g.id, true);
    hv.setUint16(p + 4, g.x, true);
    hv.setUint16(p + 6, g.y, true);
    hv.setUint16(p + 8, g.width, true);
    hv.setUint16(p + 10, g.height, true);
    hv.setInt16(p + 12, g.xoffset, true);
    hv.setInt16(p + 14, g.yoffset, true);
    hv.setInt16(p + 16, g.xadvance, true);
    chars[p + 18] = g.page;
    chars[p + 19] = g.chnl;
  });
  block(4, chars);

  if (font.kernings.length) {
    const kern = new Uint8Array(font.kernings.length * 10);
    const kv = new DataView(kern.buffer);
    font.kernings.forEach((k, n) => {
      kv.setUint32(n * 10, k.first, true);
      kv.setUint32(n * 10 + 4, k.second, true);
      kv.setInt16(n * 10 + 8, k.amount, true);
    });
    block(5, kern);
  }

  const total = 4 + blocks.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  out.set([0x42, 0x4d, 0x46, 3]);
  let o = 4;
  for (const x of blocks) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
