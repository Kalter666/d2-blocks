# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Svelte 5 + Vite static site: build diagrams from blocks, get clean d2 source. d2 runs in the browser (`@terrastruct/d2`, Go→wasm in a web worker); three.js draws the 3D look. No server.

## Commands

```sh
npm run dev                 # http://localhost:5173/d2-blocks/  (base path is /d2-blocks/)
npm test                    # node --test: every *.test.js under src/ (~3 s; loads the d2 wasm)
npm test -- src/blocks.test.js                        # one unit file (~0.1 s)
npm test -- --test-name-pattern="round-trip" src/blocks.test.js
npm run lint                # Biome, lint only (<1 s); config and reasons in biome.jsonc
npm run check               # svelte-check, errors only (~5 s) — the fast check for .svelte edits
npm run verify              # test + lint + check + build: run before calling work done
npm run test:e2e            # Playwright, chromium (~1.5 min); starts/reuses the dev server on 5173
npx playwright test e2e/syntax.spec.js -g "sql_table"  # one e2e case
npm run build               # BASE_PATH env overrides the /d2-blocks/ base
```

`?gallery` on the dev URL shows one of every 3D shape (doesn't touch the saved diagram). CI (`.github/workflows/test.yml`) runs unit, lint, check, build, then e2e; Pages deploys from `main` only after that workflow passes.

`scripts/record-demo.mjs` and `scripts/record-features.mjs` re-record the GIFs in `docs/` (dev server on :5199 via `npx vite --port 5199 --strictPort`, ffmpeg, a real GPU). They are not tests and rewrite binary files: don't run them unless asked; say so if a UI change makes a clip stale.

When searching, skip `dist/`, `playwright-report/` and `test-results/` (build/test output; `dist/assets` holds the minified bundle with d2's wasm inlined).

## MCP server

`mcp/server.js` (stdio; `npm run mcp`, registered for this repo in `.mcp.json`) exposes the app to agents: `render_d2`, `check_d2` (compiles? round-trips through the editor? what stays raw?), `convert` (mermaid ⇄ d2), `examples`, and `open_in_editor`, which returns a link to the hosted editor with the diagram in a `#d2=` fragment (`src/share.js`; `App.svelte` opens it on mount, undoably). The tools in `mcp/tools.js` run the app's own modules under node — `draw()` included — so nothing is reimplemented; add a tool there and register it in `server.js`. Tests: `mcp/tools.test.js` (functions) and `mcp/server.test.js` (over stdio). stdout is the protocol channel: never `console.log` in `mcp/`.

## Which check after which edit

| Edited | Run |
|---|---|
| `src/blocks.js` | `npm test -- src/blocks.test.js src/tree.test.js src/examples.test.js src/compile.test.js` |
| `src/models.js`, `src/3d/*` | `npm test -- src/models.test.js src/3d/layout.test.js`, then look at `?gallery` |
| `src/md.js`, `mermaid.js`, `boards.js`, `settings.js`, `history.js`, `sanitize.js` | the matching `*.test.js` |
| `src/i18n/*` | `npm test -- src/i18n/i18n.test.js` |
| any `.svelte` | `npm run check`, then the matching e2e spec (`editing`, `source-history`, `modals`, `scene`, `dnd`, `i18n`) |
| d2 syntax support | add a case to `e2e/syntax.spec.js`, run it with `-g` |
| `mcp/*`, `src/share.js` | `npm test -- mcp/*.test.js src/share.test.js`, plus `e2e/share.spec.js` for the link |

## Architecture

```
block tree ──serialize()──> d2 source ──draw()──> { svg, diagram } ──> Canvas (SVG) / Scene.svelte (3D)
     ▲                         │          (d2.js: d2 compile + render, sanitized)
     └────────parse()──────────┘
```

- **`src/blocks.js` is the core.** `serialize` is total; `parse` is best-effort with a verbatim fallback: any line or map it can't model becomes a `raw` block holding the text byte-for-byte. The invariant is **lossless round-trip** of pasted d2: `serialize(parse(src)) === src` for d2 in the editor's canonical spacing and for everything kept raw; other spacing (`{ shape: x }`) is reprinted canonically and must still compile to the same diagram (MCP `check_d2` reports `exact` / `reformatted` / `changed`). When adding syntax support, either model it fully or make sure it lands in `raw` — never a mangled box. Connection maps, `classes`/`vars`/boards, `sql_table`/`class` bodies, d2 keywords, `;`, globs/filters and escapes are deliberately kept raw. Also here: `SHAPES`, `STYLE_PROPS`, `BLOCK_TYPES`, `newBlock()`, and the tree operations (`keys`, `moveInto`, `collides`…).
- **`src/store.svelte.js`**: the single `$state` app object (blocks, hover, current `board`, `svg`, `diagram`, `busy`, `renders`), mutations, localStorage persistence. The pure parts live beside it: **`src/settings.js`** (persisted settings: defaults, allowed values, versioned save format, `themeIds`) and **`src/history.js`** (undo/redo). `App.svelte` debounces (160 ms) source changes into `draw()`, and autosaves in a separate effect.
- **`src/d2.js`**: the only module that touches the d2 engine; `draw(src, opts)` is its one export. All compile+render goes through a `serial()` gate (`src/serial.js`) — concurrent calls corrupt the SVG — and a watchdog replaces (and terminates) the worker if it hangs (a Go panic never settles the promise). Output SVG passes through `src/sanitize.js` before `{@html}` (markdown labels can carry raw HTML). Board selection (`layers`/`scenarios`/`steps`) uses `src/boards.js` + d2's render `target`. Importing `d2.js` spawns the worker, so pure logic lives in separate files that node tests can import.
- **SVG ↔ id mapping** (`src/ids.js`): d2 tags each shape/connection `<g>` with base64(xml-escaped id); `index()` decodes them. Hover linking between blocks, flat canvas and 3D all go through these ids. A block finds its id in `Block.svelte` (`targetId`); the nth duplicate `a -> b` link is d2's `(a -> b)[n]`.
- **3D**: d2 still does the layout; the scene reads geometry from the compiled `diagram` and builds solids. `src/Scene.svelte` orchestrates (`build()`, render loop, pointer handling, effects); the parts are in `src/3d/`:
  - `layout.js` — pure: which shapes are platforms, lift, centring, connection routes, arrow trimming.
  - `materials.js` — the style d2 resolved (`resolveStyle`), colours read off the hidden SVG (`readPaint`), and the material palette `M` (`makePalette`).
  - `skins.js` — per-family texture data (`SKIN`, `DARK_FAMILY`) and the canvases that paint it.
  - `cables.js` — conduits, the current shader, arrowheads. `art.js` — label plaques, icons, and tables/classes/code/LaTeX rasterised from the SVG. `stage.js` — renderer, lights, grid, disposal.
  - `src/models.js` — DOM-free bodies per shape family (`FAMILY`, `HEIGHT`, `MODELS`), the `PALETTE` contract and the motion animator; `models.test.js` measures them.
  Styles come from the compiled shape/connection fields (so classes/vars/globs apply); *colours* come from the hidden SVG's computed styles, because d2 only resolves theme tokens (`N1`, `B4`…) there.
- **Other bridges**: `src/md.js` (markdown ⟷ HTML for the rich-text editor; `rich()` refuses WYSIWYG unless the markdown round-trips exactly), `src/mermaid.js` (import/export, best-effort, not lossless), `src/examples.js` + `src/examples/*.d2` (gallery).
- **i18n**: `src/i18n/en.js` and `ru.js` must define identical keys; UI strings go through `t()` from `src/i18n/index.svelte.js`.

## Rules the tests and the linter enforce

`npm run lint` (Biome, `biome.jsonc`, plugins in `lint/*.grit`) catches these in under a second; the formatter is deliberately off. It fails on:
- importing `@terrastruct/d2` anywhere but `src/d2.js` (and tests);
- `document`, `window`, `localStorage`, `matchMedia`… in the DOM-free modules node tests import (`blocks`, `boards`, `history`, `settings`, `ids`, `md`, `mermaid`, `serial`, `models`, `3d/layout`, `3d/cables`);
- `localStorage` in any `.js` except `store.svelte.js`;
- importing `@playwright/test` in a spec instead of `./helpers.js`;
- assigning `innerHTML`/`outerHTML` or `insertAdjacentHTML` (raw HTML sinks), and checking `Array.isArray(x.material)` by hand instead of `materialsOf()`.

A deliberate exception gets `// biome-ignore <rule>: <why>` (`<!-- … -->` in markup), never a blanket disable. When a recommended rule fights an idiom of this codebase, turn it off in `biome.jsonc` with the reason, as the existing ones are.

The tests enforce:

- Only `d2.js` imports `@terrastruct/d2`, and `{@html}` appears only where it receives `draw()` output (`architecture.test.js`). A new preview or export calls `draw()`.
- en/ru keys match, and every key the code builds at runtime (`shape.*`, `block.verb.*`, `board.*`, `theme.*`, categories) exists (`i18n.test.js`).
- Every FAMILY has a SKIN, DARK_FAMILY colour and HEIGHT, and nothing unreachable remains; the real palette is exactly `PALETTE`; every motion is in `MOTIONS` (`models.test.js`).
- The save format round-trips and rejects what it can't read (`settings.test.js`); `load()` backs an unreadable save up to `d2-blocks.bak` rather than letting autosave overwrite it.

## Recipes

**Support a new piece of d2 syntax**
1. Add a case to `CASES` in `e2e/syntax.spec.js` first. If it already passes, it lands in `raw` correctly — decide whether modelling it is worth it.
2. `src/blocks.js`: a regex in the `RE` table, emit it in `serialize`/`line()`, recognise it in `parse`. Variants you can't model fall through to `raw`; never guess.
3. Round-trip in `src/blocks.test.js`, and *meaning* in `src/compile.test.js` (compile with real d2, assert the shape/edge is what you intended).
4. Editor UI is `src/Block.svelte`; strings per the UI-string recipe.
5. For 3D, read new fields from the compiled `diagram`, not the block tree — classes/vars/globs only resolve there.

**Add a block type**: `BLOCK_TYPES` and `newBlock()` in `blocks.js`, a case in `line()` (it throws on unknown types) and in `parse`, the UI in `Block.svelte`, `block.verb.<type>` in en and ru, palette button in `App.svelte`, optionally `mermaid.js`.

**Add a 3D shape family**
- `src/models.js`: map the d2 shape → family in `FAMILY`, `[factor, min, max]` in `HEIGHT`, and a builder in `MODELS` — `(w, h, H, M) => THREE.Group`, base on y=0, inside the w×h footprint. Take materials only from `M` (names in `PALETTE`); keep the file DOM-free. Animate parts with `moves(part, kind)` using a kind from `MOTIONS`.
- `src/3d/skins.js`: an entry in `SKIN` and in `DARK_FAMILY`.
- `npm test -- src/models.test.js`, then eyeball `?gallery`.

**Add a UI string**: `'area.thing': '…'` under `ui` in BOTH `src/i18n/en.js` and `ru.js`; use `t('area.thing', { n })` (params are `{name}`). Plurals: `plural('x.count', n)` with `.one/.few/.many/.other` keys (ru needs all four).

**Add an example**: a `.d2` file in `src/examples/`, an entry in `src/examples/catalog.js` (`id` = filename), and `examples[id]` (title, description, tags) in en.js AND ru.js. `examples.test.js` compiles it, round-trips it and requires no `raw` blocks.

**Add a persisted setting**: one entry in `SETTINGS` in `src/settings.js` (default + allowed values). Store, save, load and the save test pick it up. Bump `VERSION` only if an older reader would misread the new shape.

## Gotchas

- `*.svelte.js` files use runes and can't be imported by `node --test`; that is why pure logic stays out of `store.svelte.js`, and `i18n.test.js` imports the dictionaries directly.
- The SVG stays mounted (hidden) in 3D: the scene reads colours and rasterises panels from it, and Download SVG uses it. Don't wrap it in `{#if}` (`e2e/scene.spec.js` checks).
- `app.busy` is set in the same tick as a source change and `app.renders` counts finished draws; e2e waits on them (`drawn()` in `e2e/helpers.js`). Don't move `busy` into the timer or skip "unchanged" renders.
- `load()` runs in `main.js` before `mount()` on purpose (Svelte's ownership check), and `?gallery` skips it, which is what keeps autosave off there.
- d2 merges same-named siblings: drags that would merge are refused (`canMoveInto`), typing only flags the field red.
- Markdown on a *group* turns it into a text shape and orphans its children, so rich text is offered on boxes and links only.
- `parse` counts braces without regard to quotes (the `ponytail:` on `closing`), so a `{` inside a quoted label can confuse map detection.
- `README.md` "Known limits" lists product constraints (no manual positioning, icon CORS in 3D, first label line only in 3D). Read it before "fixing" one.

## Tests

- Unit tests compile with the real d2 engine where meaning matters (`compile.test.js`), not just string shape.
- `e2e/syntax.spec.js` is a catalogue of d2 syntax: each case must compile, round-trip byte-for-byte through the editor, draw its text, and build the 3D scene without a page error. Headless WebGL is software-rendered and CPU-bound, so more than the default 4 workers is slower.
- Import `test` and `expect` from `e2e/helpers.js`, not `@playwright/test`. Its `page` is one warm page per worker (a cold page costs ~6 s of wasm compile), reset before each test through the dev-only `window.__d2blocks.reset()`: store, history, localStorage, focus, open modal. Component-local UI state (zoom, drawer height) carries over. A test about boot — a reload, `?gallery`, the cold-render race — takes `{ cold: page }` and calls `open(page)` itself, which waits for the cold render so the single shared worker isn't raced.
- Wait for a render with `drawn(page, action)`, and assert on the `source(page)` textarea rather than the canvas where you can.
- A module's code can be exercised in a real browser from e2e via `page.evaluate(() => import('/d2-blocks/src/x.js'))` (see `security.spec.js`).

## Conventions

Comments explain *why* (often a past bug), and the codebase leans heavily on them; match that density, and keep a doc comment directly above the function it describes. `ponytail:` marks a deliberate shortcut and names when it stops being enough (e.g. `ponytail: whole-tree snapshots, fine at this size`); add one when you knowingly take a shortcut.
