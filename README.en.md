# fntview

[中文](README.md)

Check BMFont bitmap fonts (.fnt) in the browser: preview text layout, see where every glyph sits in the atlas, find the problems that break text in a game, and convert between the text, XML and binary formats. Files are read in the browser and never uploaded.

Use it online: https://vtxe02023274.github.io/fntview/

![screenshot](docs/screenshot.png)

BMFont is AngelCode's bitmap font format. libGDX, Phaser, MonoGame, Cocos and many other engines load it directly, and most bitmap font generators can write it.

## Features

- Reads text, XML and binary (version 3) .fnt files, plus the JSON written by msdf-bmfont and similar tools, and detects which one it is
- Lays out text the BMFont way: xoffset / yoffset, xadvance, kerning pairs, lineHeight for new lines
- Shows baselines and glyph boxes so offsets are easy to check
- Atlas view with every glyph's rectangle; hover for id, size and offsets
- Problem checks: glyphs outside the atlas, missing pages, duplicate characters, no space character, kerning for characters that do not exist, page images that are not the declared size
- Exports to text, XML, JSON or binary

## Usage

1. Click "Open .fnt + images" and pick the .fnt together with its page images, or drop them on the page
2. Type the text to preview at the top

"Demo" loads the built in font, a 3x5 pixel font drawn by `tools/make-demo.mjs`, so no third party font is included.

## Development

```sh
npm install
npm run build   # writes site/
npm test
npm run lint
```

`src/font.ts` (reading and writing the three formats), `src/layout.ts` (layout) and `src/check.ts` (checks) do not need a browser and work in Node too.

## License

MIT
