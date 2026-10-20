import { checkFont } from './check.js';
import {
  detectFormat,
  FontError,
  parseFont,
  writeBinary,
  writeText,
  writeXml,
  type BMFont,
  type Glyph,
} from './font.js';
import { layoutText } from './layout.js';

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

async function open(files: File[]): Promise<void> {
  const fntFile = files.find((f) => /\.(fnt|xml|txt)$/i.test(f.name));
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

async function openDemo(): Promise<void> {
  const [fnt, png] = await Promise.all([fetch('demo.fnt'), fetch('demo.png')]);
  await open([
    new File([await fnt.arrayBuffer()], 'demo.fnt'),
    new File([await png.blob()], 'demo.png'),
  ]);
}

function showFont(): void {
  const f = font!;
  tinted = [];
  info.textContent = [
    `${f.info.face || '(no face name)'}, size ${Math.abs(f.info.size)}${f.info.bold ? ', bold' : ''}${f.info.italic ? ', italic' : ''}`,
    `${f.chars.length} chars, ${f.kernings.length} kerning pairs`,
    `line height ${f.common.lineHeight}, base ${f.common.base}`,
    `${f.pages.length} page${f.pages.length === 1 ? '' : 's'} of ${f.common.scaleW}x${f.common.scaleH}`,
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
    const image = pageImage(glyph.page);
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
  const image = pageImage(page);
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
$('#export-binary').addEventListener(
  'click',
  () => font && download(`${fontName}.bin.fnt`, writeBinary(font) as BlobPart),
);

$<HTMLInputElement>('#file').addEventListener('change', (e) => {
  open([...((e.target as HTMLInputElement).files ?? [])]);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  open([...(e.dataTransfer?.files ?? [])]);
});
$('#demo').addEventListener('click', openDemo);
for (const el of [sample, zoomInput, guides]) el.addEventListener('input', draw);
tintInput.addEventListener('input', () => {
  tinted = [];
  draw();
});
pageSelect.addEventListener('change', drawAtlas);

openDemo();
