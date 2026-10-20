import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkFont } from '../src/check.js';
import {
  detectFormat,
  FontError,
  parseFont,
  writeBinary,
  writeText,
  writeXml,
} from '../src/font.js';
import { layoutText } from '../src/layout.js';

const read = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);
const demo = () => parseFont(read('../public/demo.fnt'));

describe('parseFont', () => {
  it('reads a binary font', () => {
    const font = parseFont(read('./fixtures/sample-binary.fnt'));
    expect(font.info).toMatchObject({
      face: 'Pixel Test',
      size: 16,
      smooth: true,
      unicode: true,
      bold: true,
      italic: false,
      outline: 1,
    });
    expect(font.info.padding).toEqual([1, 2, 1, 2]);
    expect(font.common).toMatchObject({
      lineHeight: 18,
      base: 14,
      scaleW: 128,
      scaleH: 64,
      pages: 2,
      alphaChnl: 1,
    });
    expect(font.pages).toEqual(['page_0.png', 'page_1.png']);
    expect(font.chars.map((c) => [c.id, c.x, c.width, c.page])).toEqual([
      [65, 0, 8, 0],
      [66, 10, 8, 1],
      [67, 20, 8, 0],
      [32, 30, 0, 1],
    ]);
    expect(font.kernings).toEqual([
      { first: 65, second: 66, amount: -1 },
      { first: 66, second: 67, amount: 2 },
    ]);
  });

  it('reads text and XML, including quoted values with spaces and entities', () => {
    const text = parseFont(
      enc(
        'info face="My Font" size=-12 bold=1\ncommon lineHeight=10 base=8 scaleW=32 scaleH=32 pages=1\npage id=0 file="a b.png"\nchar id=65 x=1 y=2 width=3 height=4 xoffset=-1 yoffset=1 xadvance=4 page=0 chnl=15\n',
      ),
    );
    expect(text.info).toMatchObject({ face: 'My Font', size: -12, bold: true });
    expect(text.pages).toEqual(['a b.png']);
    expect(text.chars[0]).toMatchObject({ id: 65, xoffset: -1 });

    const xml = parseFont(
      enc(
        `<?xml version="1.0"?><font><info face="A &amp; B" size="8"/><common lineHeight="9" base="7" scaleW="16" scaleH="16" pages="1"/><pages><page id="0" file='p.png'/></pages><chars count="1"><char id="66" x="0" y="0" width="2" height="2" xoffset="0" yoffset="0" xadvance="3" page="0" chnl="15"/></chars></font>`,
      ),
    );
    expect(xml.info.face).toBe('A & B');
    expect(xml.pages).toEqual(['p.png']);
    expect(xml.chars[0]).toMatchObject({ id: 66, xadvance: 3 });
  });

  it('round trips through every writer', () => {
    const font = demo();
    expect(parseFont(enc(writeText(font)))).toEqual(font);
    expect(parseFont(enc(writeXml(font)))).toEqual(font);
    expect(parseFont(writeBinary(font))).toEqual(font);
    expect(detectFormat(writeBinary(font))).toBe('binary');
  });

  it('rejects other files', () => {
    expect(() => parseFont(enc('hello'))).toThrow(FontError);
    expect(() => parseFont(enc('info face="x"\n'))).toThrow(/missing its info or common/);
    expect(() => parseFont(new Uint8Array([0x42, 0x4d, 0x46, 2]))).toThrow(/version 2/);
  });
});

describe('layoutText', () => {
  it('applies offsets, advance and kerning', () => {
    const font = demo();
    const plain = layoutText(font, 'LA');
    expect(plain.glyphs.map((g) => [g.glyph.id, g.x, g.y])).toEqual([
      [76, 0, 1],
      [65, 4, 1],
    ]);
    // L then T is kerned by -1.
    expect(layoutText(font, 'LT').glyphs[1]!.x).toBe(3);
    expect(layoutText(font, 'lt').glyphs[1]!.x).toBe(3);
  });

  it('moves to the next line and reports missing characters', () => {
    const font = demo();
    const layout = layoutText(font, 'A\nB~');
    expect(layout.glyphs.map((g) => [g.glyph.id, g.x, g.y])).toEqual([
      [65, 0, 1],
      [66, 0, 8],
      [63, 4, 8],
    ]);
    expect(layout.missing).toEqual([126]);
    expect(layout.height).toBe(14);
  });
});

describe('checkFont', () => {
  it('finds nothing wrong with the demo font', () => {
    expect(checkFont(demo(), [{ width: 64, height: 32 }])).toEqual([]);
  });

  it('reports glyphs off the page, bad pages, duplicates and stray kerning', () => {
    const font = demo();
    font.chars.push({ ...font.chars[10]!, x: 62 });
    font.chars.push({ ...font.chars[0]!, id: 9999, page: 3 });
    font.chars = font.chars.filter((c) => c.id !== 32);
    font.kernings.push({ first: 65, second: 12345, amount: 1 });
    const messages = checkFont(font, [{ width: 64, height: 16 }]).map(
      (p) => `${p.severity}: ${p.message}`,
    );
    expect(messages).toEqual([
      'warning: page 0 is 64x16 but the font says 64x32',
      expect.stringMatching(/^error: .* is defined more than once$/),
      expect.stringMatching(/^error: .* at 62,\d+ 3x5 reaches outside the 64x32 page$/),
      'error: U+270F is on page 3, which does not exist',
      "warning: there is no space character (32), spaces will be skipped or drawn as '?'",
      "warning: kerning 'A' (65) U+3039 refers to a character that is not in the font",
    ]);
  });
});
