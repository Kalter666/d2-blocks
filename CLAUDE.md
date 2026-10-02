# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Svelte 5 + Vite static site: build diagrams from blocks, get clean d2 source. d2 runs in the browser (`@terrastruct/d2`, Go→wasm in a web worker); three.js draws the 3D look. No server.

## Commands

```sh
npm run dev                 # http://localhost:5173/d2-blocks/  (base path is /d2-blocks/)
npm test                    # node --test, all src/*.test.js (loads the d2 wasm; needs --test-force-exit, already in the script)
node --test --test-force-exit src/blocks.test.js       # one unit file
node --test --test-force-exit --test-name-pattern="round-trip" src/blocks.test.js
npm run test:e2e            # Playwright, chromium; starts/reuses the dev server on 5173
npx playwright test e2e/syntax.spec.js -g "sql_table"  # one e2e case
npm run build               # BASE_PATH env overrides the /d2-blocks/ base
```

`?gallery` on the dev URL shows one of every 3D shape (doesn't touch the saved diagram). CI (`.github/workflows/test.yml`) runs `npm test` then the e2e suite; pushing to `main` deploys to GitHub Pages.

## Architecture

```
block tree ──serialize()──> d2 source ──compile()──> diagram ──render()──> SVG
     ▲                         │                        │
     └────────parse()──────────┘                        └──> Scene.svelte (3D)
```

- **`src/blocks.js` is the core.** `serialize` is total; `parse` is best-effort with a verbatim fallback: any line or map it can't model becomes a `raw` block holding the text byte-for-byte. The invariant is **lossless round-trip** of pasted d2 (`serialize(parse(src)) === src`). When adding syntax support, either model it fully or make sure it lands in `raw` — never a mangled box. Connection maps, `classes`/`vars`/boards, `sql_table`/`class` bodies, d2 keywords, `;`, globs/filters and escapes are deliberately kept raw.
- **`src/store.svelte.js`**: the single `$state` app object (blocks, theme, look, hover, current `board`, `svg`, `diagram`), undo history, localStorage persistence. `App.svelte` debounces (160 ms) source changes into `draw()`.
- **`src/d2.js`**: one shared D2 worker. All compile+render goes through a `serial()` gate (`src/serial.js`) — concurrent calls corrupt the SVG — and a watchdog replaces the worker if it hangs (a Go panic never settles the promise). Board selection (`layers`/`scenarios`/`steps`) uses `src/boards.js` + d2's render `target`. Output SVG is passed through `src/sanitize.js` before `{@html}` (markdown labels can carry raw HTML). Modules that import `d2.js` spawn the worker on import, so pure logic lives in separate files that node tests can import.
- **SVG ↔ id mapping**: d2 tags each shape/connection `<g>` with base64(xml-escaped id); `index()` in `d2.js` decodes them. Hover linking between blocks, flat canvas and 3D all go through these ids.
- **3D (`src/Scene.svelte`)**: d2 still does the layout; the scene reads geometry from the compiled `diagram` and builds solids. Styles come from the compiled shape/connection fields (so classes/vars/globs apply); *colours* are read from the hidden SVG's computed styles, because d2 only resolves theme tokens (`N1`, `B4`…) there. The SVG stays mounted but hidden in 3D for this reason and for Download SVG. Tables, classes, code and LaTeX are rasterised from that SVG onto slabs. Bodies per shape family live in `src/models.js`, which is DOM-free so `models.test.js` can measure them.
- **Other bridges**: `src/md.js` (markdown ⟷ HTML for the rich-text editor; `rich()` refuses WYSIWYG unless the markdown round-trips exactly), `src/mermaid.js` (import/export, best-effort, not lossless), `src/examples.js` + `src/examples/*.d2` (gallery; `examples.test.js` compiles and round-trips every example).
- **i18n**: `src/i18n/en.js` and `ru.js` must define identical keys (`i18n.test.js` enforces it); UI strings go through `t()`.

## Tests

- Unit tests compile with the real d2 engine where meaning matters (`compile.test.js`), not just string shape.
- `e2e/syntax.spec.js` is a catalogue of d2 syntax: each case must compile, round-trip byte-for-byte through the editor, draw its text, and build the 3D scene without a page error. It reuses one warm page per worker (a cold page costs ~6 s of wasm compile) and waits on the `.busy` flag rising then falling. Headless WebGL is software-rendered and CPU-bound, so more than the default 4 workers is slower.
- `e2e/helpers.js`: `open(page)` waits for the cold render to settle before driving the app — the single shared worker must not be raced.

## Conventions

Comments explain *why* (often a past bug), and the codebase leans heavily on them; match that density. Deliberate shortcuts are marked `ponytail:` with their ceiling.
