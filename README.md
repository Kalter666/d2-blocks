# d2 blocks

Build diagrams by stacking blocks. Get clean [d2](https://d2lang.com) source you
can put in a pull request.

**→ [kalter666.github.io/d2-blocks](https://kalter666.github.io/d2-blocks/)**

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
hand. The source pane is editable too, so anyone who *does* know d2 can type or
paste straight into it and watch the blocks rearrange themselves.

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

## Rich text

d2 labels can be markdown, which is what turns a diagram into something readable
rather than a grid of captions. It isn't a separate kind of block — hit `¶` on
any box or connection and its label becomes a small WYSIWYG editor (headings,
bold, italic, code, links, lists) writing an ordinary block string. A box keeps
its shape, so a cylinder or an oval holds rich text just as well as a plain
rectangle. `⤢` pops the editor out into a full-size window when a few lines in a
narrow column isn't enough room:

```
Notes: |md
  # Payment flow
  - charges the card
|
```

Markdown is what's stored; the HTML only exists so a `contenteditable` can show
it. `rich()` in `src/md.js` is the safety catch: it hands a block to the visual
editor **only** if the markdown survives a round-trip byte-for-byte. Anything
else — a table, an image, raw HTML, a nested list — opens as a plain markdown
textarea with a button to reformat, so editing can never quietly rewrite text
the toolbar didn't understand.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/d2-blocks/
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

Both directions are live. Block edits reserialise the source; typing or pasting
in the code pane reparses it into blocks. While the code pane has focus your text
wins, so you aren't reformatted mid-word; on blur the canonical serialisation
takes over, which doubles as format-on-blur.

`serialize` is total; `parse` is best-effort with a verbatim fallback, so the
pair round-trips even when parsing fails completely.

d2 runs in a web worker via [`@terrastruct/d2`](https://www.npmjs.com/package/@terrastruct/d2)
(stock, no fork). The canvas is the rendered SVG — hover linking works because
d2 tags every shape's `<g>` with `base64(id)`, so there is no second render
pipeline and no hit-testing geometry.

| File | |
|---|---|
| `src/blocks.js` | block schema, `serialize`, `parse`, tree moves — the core |
| `src/store.svelte.js` | app state, undo history, persistence |
| `src/d2.js` | compile + render, and the SVG ↔ id index |
| `src/md.js` | the markdown ⟷ HTML bridge behind the rich-text editor |

## Known limits

- **No manual positioning.** d2 always auto-layouts — `top`/`left` exist only on
  the paid TALA engine — so you choose a direction and a layout engine, not
  coordinates. Every edit reflows the whole diagram.
- **Style values are constrained to what d2 accepts.** Each property carries its
  own editor and range (colour picker, bounded number, checkbox, enum), taken
  from d2's own validation rather than guessed. `npm test` compiles every
  default and both ends of every range, so a drifting bound fails CI.
- **Rich text is a box, not a group.** A markdown label on a group turns it into
  a text shape and orphans its children — verified against the compiler — so the
  `¶` toggle is only offered on boxes. All 18 shapes hold markdown fine; leaving
  the shape unset is the one case d2 renders borderless, which is why the
  dropdown calls that option *text* once rich text is on.
- **A duplicate name is flagged, not prevented.** d2 merges two boxes called
  `auth` in the same scope into one shape. A drag that would cause that is
  refused outright, but typing a clashing name only turns the field red — you
  can't refuse a keystroke without making `authx` untypeable.
- **Nesting is drag-only.** Arrow keys on a block's grip reorder it within its
  list; moving a block *into* a group needs a mouse.
- **First load is heavy.** The d2 wasm is ~6 MB gzipped. If that becomes a
  problem, serve `d2.wasm` as a separate cacheable asset instead of using the
  npm browser bundle, which inlines it.
- `parse` is a line scanner, not a d2 parser. It's exact on files this editor
  wrote and non-destructive on files it didn't, but a d2 keyword block like
  `vars: { … }` shows up as an ordinary group.

## Licence

[MIT](LICENSE).

The build inlines [d2](https://github.com/terrastruct/d2), which is
[MPL-2.0](https://github.com/terrastruct/d2/blob/master/LICENSE.txt). MPL is
file-level copyleft and explicitly allows distribution inside a larger work
under other terms, so this project stays MIT — but d2's own files remain MPL
wherever they end up, including in the bundle served from Pages.
