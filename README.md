# d2 blocks

Build diagrams by stacking blocks. Get clean [d2](https://d2lang.com) source you
can put in a pull request.

Runs entirely in the browser — no server, no accounts. Deploys to GitHub Pages
as a static site.

## Why

d2 is a good language and a rough first experience for someone non-technical:
blank page, unfamiliar syntax, and a typo in `a -> b` silently *creates* a
phantom box instead of erroring. Visual tools avoid that but hand you a binary
blob nobody can review in a diff.

This tries to be both. You assemble a stack of blocks — *box*, *group*,
*connect*, *style* — and the d2 source is generated from it. Nobody has to type
syntax, and what comes out is the same file a developer would have written by
hand.

```
┌────────────────────────┐
│ ▤ group [Backend]      │      Backend: {
│   ┌──────────────────┐ │        API
│   │ ■ box [API]      │ │        Worker
│   │ ■ box [Worker]   │ │      }
│   └──────────────────┘ │      Backend.API -> Database
├────────────────────────┤
│ → [API ▾] to [DB ▾]    │
└────────────────────────┘
```

Two things fall out of blocks mapping 1:1 onto d2 statements:

- **Connections pick from a dropdown, never free text.** You can only connect
  boxes that exist, so phantom boxes are impossible.
- **Round-trips are lossless.** Any statement with no matching block becomes a
  grey `d2` block holding the line verbatim. Paste in a hand-written file using
  vars, classes or imports, edit something unrelated, and the parts this editor
  doesn't understand come back byte-for-byte.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/d2-editor/
npm test         # round-trip + real-compiler checks
npm run build
```

`npm test` is worth running before touching `blocks.js`. Beyond the tree
round-trip it compiles the generated d2 with the real d2 engine and asserts the
result *means* the right thing — that caught two bugs where the output parsed
fine but drew the wrong diagram.

## Deploy

Push to `main`. The workflow builds with `BASE_PATH=/<repo>/` and publishes to
Pages; enable Pages → Source → GitHub Actions once. For a custom domain at the
root, set `BASE_PATH=/`.

## How it works

```
block tree ──serialize()──> d2 ──compile()──> diagram ──render()──> SVG
     ▲                       │
     └────────parse()────────┘
```

The block tree is the source of truth while editing. `serialize` is total;
`parse` is best-effort with a verbatim fallback, so the pair round-trips even
when parsing fails completely.

d2 runs in a web worker via [`@terrastruct/d2`](https://www.npmjs.com/package/@terrastruct/d2)
(stock, no fork). The canvas is the rendered SVG — hover linking works because
d2 tags every shape's `<g>` with `base64(id)`, so there is no second render
pipeline and no hit-testing geometry.

| File | |
|---|---|
| `src/blocks.js` | block schema, `serialize`, `parse`, tree moves — the core |
| `src/store.svelte.js` | app state, undo history, persistence |
| `src/d2.js` | compile + render, and the SVG ↔ id index |
| `src/share.js` | URL codec (native `CompressionStream`) |

## Known limits

- **The code pane is output, not input.** You can copy d2 out; you can't type it
  in yet. Importing means pasting into a share link or `localStorage`.
- **No manual positioning.** d2 always auto-layouts — `top`/`left` exist only on
  the paid TALA engine — so you choose a direction and a layout engine, not
  coordinates. Every edit reflows the whole diagram.
- **Two boxes with the same name in the same scope silently merge.** d2 treats a
  repeated key as the same shape. New blocks get a free name, but renaming one
  onto another collides.
- **Nesting is drag-only.** Arrow keys on a block's grip reorder it within its
  list; moving a block *into* a group needs a mouse.
- **First load is heavy.** The d2 wasm is ~6 MB gzipped. If that becomes a
  problem, serve `d2.wasm` as a separate cacheable asset instead of using the
  npm browser bundle, which inlines it.
- `parse` is a line scanner, not a d2 parser. It's exact on files this editor
  wrote and non-destructive on files it didn't, but a d2 keyword block like
  `vars: { … }` shows up as an ordinary group.
