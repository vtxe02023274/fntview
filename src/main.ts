import { checkFont } from './check.js';
import { decodeGlyph, type Pixels } from './field.js';
import {
  detectFormat,
  FontError,
  parseFont,
  writeBinary,
  writeJson,
  writeText,
  writeXml,
  type BMFont,
  type Glyph,
} from './font.js';
import { ASCII, PackError } from './generate.js';
import { layoutText } from './layout.js';
import { makeFont } from './rasterize.js';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const preview = $<HTMLCanvasElement>('#preview');
const atlas = $<HTMLCanvasElement>('#atlas');
const sample = $<HTMLTextAreaElement>('#sample');
const zoomInput = $<HTMLInputElement>('#zoom');
const tintInput = $<HTMLInputElement>('#tint');
const guides = $<HTMLInputElement>('#guides');
const info = $<HTMLElement>('#info');
const problems = $<HTMLElement>('#problems');
const hoverInfo = $<HTMLElement>('#hover');
const message = $<HTMLElement>('#message');
const pageSelect = $<HTMLSelectElement>('#page');

let font: BMFont | undefined;
let fontName = 'font';
let pages: (ImageBitmap | undefined)[] = [];
let tinted: (HTMLCanvasElement | undefined)[] = [];
let pagePixels: (Pixels | undefined)[] = [];
/** Decoded distance field glyphs by position and zoom. */
let fieldGlyphs = new Map<string, HTMLCanvasElement>();

async function open(files: File[]): Promise<void> {
  const fntFile = files.find((f) => /\.(fnt|xml|txt|json)$/i.test(f.name));
  if (!fntFile) {
    message.textContent = 'pick a .fnt file, together with its page images';
    return;
  }
  try {
    const bytes = new Uint8Array(await fntFile.arrayBuffer());
    font = parseFont(bytes);
    message.textContent = `${fntFile.name}: ${detectFormat(bytes)} format`;
  } catch (err) {
    message.textContent =
      err instanceof FontError ? `${fntFile.name}: ${err.message}` : String(err);
    return;
  }
  fontName = fntFile.name.replace(/\.[^.]+$/, '');
  pages = await Promise.all(
    font.pages.map(async (page) => {
      const name = page.split(/[\\/]/).pop()!;
      const file = files.find((f) => f.name === name);
      return file ? createImageBitmap(file) : undefined;
    }),
  );
  const missing = font.pages.filter((_, i) => !pages[i]);
  if (missing.length) message.textContent += `, also pick ${missing.join(', ')} to see the glyphs`;
  showFont();
}

async function openDemo(name = 'demo'): Promise<void> {
  const [fnt, png] = await Promise.all([fetch(`${name}.fnt`), fetch(`${name}.png`)]);
  await open([
    new File([await fnt.arrayBuffer()], `${name}.fnt`),
    new File([await png.blob()], `${name}.png`),
  ]);
}

function showFont(): void {
  const f = font!;
  tinted = [];
  pagePixels = [];
  fieldGlyphs = new Map();
  info.textContent = [
    `${f.info.face || '(no face name)'}, size ${Math.abs(f.info.size)}${f.info.bold ? ', bold' : ''}${f.info.italic ? ', italic' : ''}`,
    `${f.chars.length} chars, ${f.kernings.length} kerning pairs`,
    `line height ${f.common.lineHeight}, base ${f.common.base}`,
    `${f.pages.length} page${f.pages.length === 1 ? '' : 's'} of ${f.common.scaleW}x${f.common.scaleH}`,
    ...(f.distanceField
      ? [`${f.distanceField.fieldType}, distance range ${f.distanceField.distanceRange}`]
      : []),
  ].join('\n');
  pageSelect.replaceChildren(...f.pages.map((p, i) => new Option(`${i}: ${p}`, String(i))));
  const found = checkFont(
    f,
    pages.map((p) => (p ? { width: p.width, height: p.height } : undefined)),
  );
  problems.replaceChildren(
    ...(found.length
      ? found.map((p) => {
          const li = document.createElement('li');
          li.className = p.severity;
          li.textContent = p.message;
          return li;
        })
      : [Object.assign(document.createElement('li'), { textContent: 'no problems found' })]),
  );
  draw();
}

/** Page image recolored with the tint, keeping its alpha. */
function pageImage(index: number): CanvasImageSource | undefined {
  const page = pages[index];
  if (!page) return undefined;
  if (!tinted[index]) {
    const c = document.createElement('canvas');
    c.width = page.width;
    c.height = page.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(page, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = tintInput.value;
    ctx.fillRect(0, 0, c.width, c.height);
    tinted[index] = c;
  }
  return tinted[index];
}

function pageData(index: number): Pixels | undefined {
  const page = pages[index];
  if (!page) return undefined;
  if (!pagePixels[index]) {
    const c = document.createElement('canvas');
    c.width = page.width;
    c.height = page.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(page, 0, 0);
    pagePixels[index] = ctx.getImageData(0, 0, c.width, c.height);
  }
  return pagePixels[index];
}

/** A distance field glyph decoded at the zoom level, in the tint color. */
function fieldGlyph(glyph: Glyph, zoom: number): HTMLCanvasElement | undefined {
  const key = `${glyph.page},${glyph.x},${glyph.y},${glyph.width},${glyph.height},${zoom}`;
  let c = fieldGlyphs.get(key);
  if (c) return c;
  const page = pageData(glyph.page);
  if (!page || !font?.distanceField) return undefined;
  const { width, height, alpha } = decodeGlyph(page, glyph, zoom, font.distanceField);
  c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const tint = parseInt(tintInput.value.slice(1), 16);
  for (let i = 0; i < alpha.length; i++) {
    image.data[i * 4] = tint >> 16;
    image.data[i * 4 + 1] = (tint >> 8) & 255;
    image.data[i * 4 + 2] = tint & 255;
    image.data[i * 4 + 3] = alpha[i]!;
  }
  ctx.putImageData(image, 0, 0);
  fieldGlyphs.set(key, c);
  return c;
}

function draw(): void {
  if (!font) return;
  const zoom = Number(zoomInput.value);
  const layout = layoutText(font, sample.value);
  const margin = 4;
  preview.width = Math.max(1, Math.ceil((layout.width + margin * 2) * zoom));
  preview.height = Math.max(1, Math.ceil((layout.height + margin * 2) * zoom));
  const ctx = preview.getContext('2d')!;
  ctx.imageSmoothingEnabled = font.info.smooth && zoom < 2;
  ctx.clearRect(0, 0, preview.width, preview.height);

  if (guides.checked) {
    const lines = sample.value.split('\n').length;
    ctx.fillStyle = 'rgba(255, 224, 138, 0.35)';
    for (let i = 0; i < lines; i++) {
      const base = (margin + i * font.common.lineHeight + font.common.base) * zoom;
      ctx.fillRect(0, Math.round(base), preview.width, 1);
    }
  }

  for (const { glyph, x, y } of layout.glyphs) {
    if (font.distanceField) {
      const decoded = glyph.width && glyph.height ? fieldGlyph(glyph, zoom) : undefined;
      if (decoded) ctx.drawImage(decoded, (margin + x) * zoom, (margin + y) * zoom);
    }
    const image = font.distanceField ? undefined : pageImage(glyph.page);
    if (image && glyph.width && glyph.height) {
      ctx.drawImage(
        image,
        glyph.x,
        glyph.y,
        glyph.width,
        glyph.height,
        (margin + x) * zoom,
        (margin + y) * zoom,
        glyph.width * zoom,
        glyph.height * zoom,
      );
    }
    if (guides.checked && glyph.width && glyph.height) {
      ctx.strokeStyle = 'rgba(111, 168, 220, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        (margin + x) * zoom + 0.5,
        (margin + y) * zoom + 0.5,
        glyph.width * zoom - 1,
        glyph.height * zoom - 1,
      );
    }
  }
  const missing = layout.missing.map((c) => String.fromCodePoint(c)).join(' ');
  hoverInfo.textContent = missing ? `not in the font: ${missing}` : '';
  drawAtlas();
}

let hovered: Glyph | undefined;

function drawAtlas(): void {
  if (!font) return;
  const page = Number(pageSelect.value || 0);
  const scale = Math.max(1, Math.floor(512 / Math.max(font.common.scaleW, font.common.scaleH, 1)));
  atlas.width = font.common.scaleW * scale;
  atlas.height = font.common.scaleH * scale;
  const ctx = atlas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, atlas.width, atlas.height);
  // Distance field pages are opaque, tinting them would hide the field.
  const image = font.distanceField ? pages[page] : pageImage(page);
  if (image) ctx.drawImage(image, 0, 0, atlas.width, atlas.height);
  for (const g of font.chars) {
    if (g.page !== page || !g.width) continue;
    ctx.strokeStyle = g === hovered ? '#ffe08a' : 'rgba(111, 168, 220, 0.5)';
    ctx.strokeRect(g.x * scale + 0.5, g.y * scale + 0.5, g.width * scale - 1, g.height * scale - 1);
  }
}

atlas.addEventListener('pointermove', (e) => {
  if (!font) return;
  const r = atlas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * font.common.scaleW;
  const y = ((e.clientY - r.top) / r.height) * font.common.scaleH;
  const page = Number(pageSelect.value || 0);
  hovered = font.chars.find(
    (g) => g.page === page && x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height,
  );
  hoverInfo.textContent = hovered
    ? `${hovered.id >= 32 ? `'${String.fromCodePoint(hovered.id)}' ` : ''}id ${hovered.id}  ${hovered.width}x${hovered.height} at ${hovered.x},${hovered.y}  offset ${hovered.xoffset},${hovered.yoffset}  advance ${hovered.xadvance}`
    : '';
  drawAtlas();
});

function download(name: string, data: BlobPart): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export-text').addEventListener(
  'click',
  () => font && download(`${fontName}.fnt`, writeText(font)),
);
$('#export-xml').addEventListener(
  'click',
  () => font && download(`${fontName}.xml.fnt`, writeXml(font)),
);
$('#export-json').addEventListener(
  'click',
  () => font && download(`${fontName}.json`, writeJson(font)),
);
$('#export-binary').addEventListener('click', () => {
  if (!font) return;
  let bytes: Uint8Array;
  try {
    bytes = writeBinary(font);
  } catch (err) {
    message.textContent =
      err instanceof FontError ? `cannot save as binary: ${err.message}` : String(err);
    return;
  }
  download(`${fontName}.bin.fnt`, bytes as BlobPart);
  if (font.distanceField) {
    message.textContent = 'the binary format has no distance field settings, they were left out';
  }
});

$('#export-page').addEventListener('click', () => {
  const index = Number(pageSelect.value || 0);
  const page = pages[index];
  if (!font || !page) {
    message.textContent = 'no page image to save';
    return;
  }
  const c = document.createElement('canvas');
  c.width = page.width;
  c.height = page.height;
  c.getContext('2d')!.drawImage(page, 0, 0);
  const name = font.pages[index]!.split(/[\\/]/).pop()!;
  c.toBlob((blob) => blob && download(name, blob), 'image/png');
});

const makeChars = $<HTMLTextAreaElement>('#make-chars');
makeChars.value = ASCII;
$('#make').addEventListener('click', async () => {
  const file = $<HTMLInputElement>('#make-file').files?.[0];
  if (!file) {
    message.textContent = 'pick a font file first';
    return;
  }
  try {
    const made = await makeFont(file, {
      size: Number($<HTMLInputElement>('#make-size').value),
      padding: Number($<HTMLInputElement>('#make-padding').value),
      pageWidth: Number($<HTMLInputElement>('#make-width').value),
      text: makeChars.value,
    });
    font = made.font;
    fontName = font.info.face;
    pages = [await createImageBitmap(made.page)];
    message.textContent = `made ${font.chars.length} chars from ${file.name}, save the page and a descriptor below`;
    if (made.missing.length) {
      const list = made.missing.map((c) => String.fromCodePoint(c)).join(' ');
      message.textContent += `; left out ${made.missing.length} not in the font: ${list}`;
    }
    showFont();
  } catch (err) {
    message.textContent =
      err instanceof PackError ? err.message : `cannot use ${file.name}: ${String(err)}`;
  }
});

$<HTMLInputElement>('#file').addEventListener('change', (e) => {
  open([...((e.target as HTMLInputElement).files ?? [])]);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  open([...(e.dataTransfer?.files ?? [])]);
});
$('#demo').addEventListener('click', () => openDemo());
$('#demo-sdf').addEventListener('click', () => openDemo('demo-sdf'));
for (const el of [sample, zoomInput, guides]) el.addEventListener('input', draw);
tintInput.addEventListener('input', () => {
  tinted = [];
  fieldGlyphs = new Map();
  draw();
});
pageSelect.addEventListener('change', drawAtlas);

openDemo();
