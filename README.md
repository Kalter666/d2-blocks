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

## Shapes are roles

The shape dropdown lists what people actually draw — *Database*, *Queue*, *User*,
*Cloud / external* — not `cylinder`, `queue`, `person`, `cloud`. The value written
to the source is still d2's own name, so nothing about the file changes; hover an
option to see which one it is. All 18 of d2's shapes are there, so a pasted file
using `stored_data` still shows the right thing selected.

## Two looks

**3D** is the default. The diagram lies on a grid floor and every shape becomes
a small physical object — a database is rack hardware with populated drive bays,
a service is a vented appliance, storage is an industrial tank with a valve, and
the name sits on a plaque where the object cannot hide it. Connections glow and
their ticks march. **flat** is the ordinary d2 render.

`src/Scene.svelte` is a [three.js](https://threejs.org) renderer. d2 still compiles
and lays the diagram out; the scene reads the geometry out of the compiled result
and builds real solids, lit and casting shadows, with an orbit camera. Models use
separate physical materials for glass, paper, cardboard, skin, rubber and metal
instead of tinting every part like painted steel. Labels are sprites, so they face
the camera from any angle instead of lying on the ground.

The SVG stays mounted but hidden. Download SVG still works from it, and each
object’s resolved theme and style are read from the shape d2 drew, so the light
and dark theme selectors work in both views without duplicating d2's palettes.
Appearance can follow the system or be forced light/dark; choosing a palette
automatically previews its matching appearance.
Style blocks translate into 3D material colour, opacity, surface relief, shadows,
label typography and animation. The marching connections and styled object
animation stop under `prefers-reduced-motion: reduce`.

## Examples

**▦ Examples** opens a gallery of ready-made architectures — three-tier web app,
event-driven, saga, RAG, zero-trust, and thirty-odd more — filtered by category or
by a search over titles, descriptions and tags. Each one renders a live preview
with the real compiler before you commit to it; loading one replaces the source and
is a single undo away.

Every example is an ordinary `.d2` file in `src/examples/`, with its metadata in
`catalog.js`. Vite inlines them at build time, so the gallery needs no fetches, and
`examples.test.js` compiles all of them and round-trips each through `parse`, so a
bundled example that stopped being editable as blocks fails CI.

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

The 3D bodies are geometry, so `models.test.js` measures them without a GPU: one
per d2 shape, checking it stands on the floor, fits the footprint d2 reserved, and
is the height it claims. That caught four real bugs the first time it ran. What it
*can't* judge is whether a thing looks like a database — open
`http://localhost:5173/d2-blocks/?gallery` for that. It puts one of every shape on
screen at once, and doesn't touch your saved diagram.

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
| `src/models.js` | the 3D bodies — DOM-free geometry, so a test can measure them |
| `src/Scene.svelte` | the three.js renderer: skins, materials, lights, camera |
| `src/examples.js` | the bundled `.d2` gallery and its catalogue |

## Known limits

- **No manual positioning.** d2 always auto-layouts — `top`/`left` exist only on
  the paid TALA engine — so you choose a direction and a layout engine, not
  coordinates. Every edit reflows the whole diagram.
- **Style values are constrained to what d2 accepts.** Each property carries its
  own editor and range (colour picker, bounded number, checkbox, enum), taken
  from d2's own validation rather than guessed. `npm test` compiles every
  default and both ends of every range, so a drifting bound fails CI.
- **Every family is modelled.** A database is a server cabinet, storage is a
  hooped tank with pipework, a queue is a flanged transport tube, a state is an
  illuminated indicator, start/end is a two-button control station, a decision
  is a warning sign on a post, a cloud is a shaded weather cloud, an actor is a
  clothed figure, input/output is an open workstation, a process step is a
  conveyor station, a document is a tabbed file folder, a page is a monitor, a
  callout is a pinned note, and a component is a populated circuit board. Only a
  container's platform is a plain extrusion.
- **Models are per family.** All eighteen selectable shapes now have distinct
  physical readings. Skins are painted procedurally into
  canvases at startup — no image assets — and every model is built to the footprint
  d2 laid out, so the 3D view and the flat one agree about where things are.
- **3D shows one line of each label.** Labels are drawn into a canvas texture, so a
  markdown note appears in 3D as its first line — read it in flat mode or on the
  block. Icons and tooltips aren't carried over either.
- **three.js costs ~150 kB gzipped** on top of the d2 wasm. It is bundled, not
  lazy-loaded, so flat-mode-only users pay for it too.
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
- **A pasted diagram is untrusted markup.** d2 copies raw HTML out of a markdown
  label straight into a `<foreignObject>`, and the canvas mounts its SVG with
  `{@html}` — so `sanitize()` in `src/sanitize.js` strips event handlers, script
  and frame elements, and any URL scheme that isn't http(s), mailto, a fragment or
  a data image. Without it, `x: |md <img src=y onerror="…"> |` in a file someone
  sent you would run on this origin. There is no Content-Security-Policy header:
  Pages serves static files only, and the d2 worker needs `wasm-unsafe-eval` and a
  blob worker, so a meta CSP tight enough to be worth having would break it.
- **The examples are inlined, not fetched.** Every bundled `.d2` file ships in the
  JavaScript bundle, which is why the gallery opens instantly and why adding a
  hundred more would need `import.meta.glob` without `eager`.
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
