<script>
  import Stack from './Stack.svelte';
  import Canvas from './Canvas.svelte';
  import { draw } from './d2.js';
  import { keys } from './blocks.js';
  import {
    app, source, add, undo, redo, canUndo, canRedo, save, load, shareLink,
  } from './store.svelte.js';

  const THEMES = [
    [0, 'Neutral'], [1, 'Grey'], [3, 'Terrastruct'], [4, 'Cool classics'],
    [5, 'Mixed berry'], [6, 'Grape soda'], [8, 'Colourblind clear'], [300, 'Dark mauve'],
  ];

  let showCode = $state(true);
  let toast = $state('');
  const src = $derived(source());
  const options = $derived(keys(app.blocks));

  load();

  // Re-render on any change, coalesced. A token drops results that arrive after
  // a newer render has already started.
  let token = 0;
  $effect(() => {
    const [text, layout, themeID, sketch] = [src, app.layout, app.theme, app.sketch];
    const mine = ++token;
    app.busy = true;
    const timer = setTimeout(async () => {
      try {
        const { svg, diagram } = await draw(text, { layout, themeID, sketch });
        if (mine !== token) return;
        Object.assign(app, { svg, diagram, error: '' });
      } catch (e) {
        if (mine === token) app.error = String(e?.message ?? e).trim();
      } finally {
        if (mine === token) app.busy = false;
      }
      save();
    }, 160);
    return () => clearTimeout(timer);
  });

  /** d2 merges same-named boxes, so a new block needs a name nobody is using. */
  function freeName(base) {
    const taken = new Set(options.map((o) => o.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  const addBox = () => add({ type: 'box', name: freeName('box'), label: '', shape: '' });
  const addGroup = () => add({ type: 'group', name: freeName('group'), label: '', children: [] });
  const addLink = () => add({
    type: 'link', arrow: '->', label: '',
    src: options[0]?.key ?? '', dst: options[1]?.key ?? options[0]?.key ?? '',
  });
  const addStyle = () => add({
    type: 'style', target: options[0]?.key ?? '', prop: 'fill', value: '#c9d6ff',
  });

  function flash(msg) {
    toast = msg;
    setTimeout(() => (toast = ''), 1800);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(src);
    flash('d2 copied to clipboard');
  }

  async function share() {
    const url = await shareLink();
    history.replaceState(null, '', url);
    await navigator.clipboard.writeText(url);
    flash('Share link copied');
  }

  function downloadSvg() {
    const url = URL.createObjectURL(new Blob([app.svg], { type: 'image/svg+xml' }));
    Object.assign(document.createElement('a'), { href: url, download: 'diagram.svg' }).click();
    URL.revokeObjectURL(url);
  }

  function onKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.target.matches('input, select, textarea')) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<header>
  <h1>d2 <span>blocks</span></h1>

  <div class="group">
    <button onclick={undo} disabled={!canUndo()} title="Undo (Ctrl+Z)">↶</button>
    <button onclick={redo} disabled={!canRedo()} title="Redo (Ctrl+Shift+Z)">↷</button>
  </div>

  <label>layout
    <select bind:value={app.layout}>
      <option value="dagre">dagre</option>
      <option value="elk">elk</option>
    </select>
  </label>

  <label>theme
    <select bind:value={app.theme}>
      {#each THEMES as [id, name]}<option value={id}>{name}</option>{/each}
    </select>
  </label>

  <label class="check"><input type="checkbox" bind:checked={app.sketch} /> sketch</label>

  <span class="spacer"></span>
  {#if app.busy}<span class="busy" aria-live="polite">drawing…</span>{/if}

  <button onclick={copyCode}>Copy d2</button>
  <button onclick={downloadSvg}>Download SVG</button>
  <button class="primary" onclick={share}>Share</button>
</header>

<main>
  <section class="editor">
    <div class="scroll">
      <Stack list={app.blocks} />
    </div>
    <div class="palette">
      <button class="add box" onclick={addBox}>+ box</button>
      <button class="add group" onclick={addGroup}>+ group</button>
      <button class="add link" onclick={addLink} disabled={!options.length}>+ connect</button>
      <button class="add style" onclick={addStyle} disabled={!options.length}>+ style</button>
    </div>
  </section>

  <Canvas />
</main>

<footer class:open={showCode}>
  <button class="drawer" onclick={() => (showCode = !showCode)} aria-expanded={showCode}>
    <span class="chevron" class:up={showCode}>▾</span> d2 source
    <span class="note">this is what you share — read-only for now</span>
  </button>
  {#if showCode}<pre>{src}</pre>{/if}
</footer>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 14px;
    background: var(--surface);
    border-block-end: 1px solid var(--line);
  }

  h1 { margin: 0 6px 0 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
  h1 span { color: var(--accent); }

  .spacer { flex: 1; }
  .busy { font-size: 12px; color: var(--muted); }

  label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .check { gap: 4px; cursor: pointer; }

  select {
    font: inherit; font-size: 12px; color: var(--fg);
    padding: 3px 5px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg);
  }

  .group { display: flex; gap: 1px; }
  .group button { border-radius: 0; }
  .group button:first-child { border-start-start-radius: 6px; border-end-start-radius: 6px; }
  .group button:last-child { border-start-end-radius: 6px; border-end-end-radius: 6px; }

  header button {
    font: inherit; font-size: 12px; cursor: pointer;
    padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--bg); color: var(--fg);
  }
  header button:hover:not(:disabled) { background: var(--surface); border-color: var(--muted); }
  header button:disabled { opacity: 0.4; cursor: default; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .primary:hover:not(:disabled) { background: var(--accent-dark); border-color: var(--accent-dark); }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(300px, 27rem) 1fr;
    min-block-size: 0;
  }

  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    background: var(--surface);
    border-inline-end: 1px solid var(--line);
  }
  .scroll { flex: 1; overflow: auto; padding: 12px; }

  .palette {
    display: flex; gap: 6px; flex-wrap: wrap;
    padding: 10px 12px;
    border-block-start: 1px solid var(--line);
    background: var(--bg);
  }
  .add {
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    padding: 5px 11px; border-radius: 999px; color: #fff; border: 0;
  }
  .add:disabled { opacity: 0.35; cursor: default; }
  .add.box   { background: #3b82f6; }
  .add.group { background: #8b5cf6; }
  .add.link  { background: #f59e0b; }
  .add.style { background: #ec4899; }

  footer { background: var(--surface); border-block-start: 1px solid var(--line); }
  footer.open { max-block-size: 32vh; display: flex; flex-direction: column; }

  .drawer {
    display: flex; align-items: center; gap: 7px; inline-size: 100%;
    font: inherit; font-size: 12px; font-weight: 600; text-align: start;
    padding: 6px 14px; border: 0; background: none; color: var(--fg); cursor: pointer;
  }
  .chevron { display: inline-block; transition: transform 0.15s; }
  .chevron.up { transform: rotate(180deg); }
  .note { font-weight: 400; color: var(--muted); }

  pre {
    margin: 0; padding: 0 14px 12px;
    overflow: auto;
    font-family: var(--mono); font-size: 12px; line-height: 1.55;
    color: var(--fg);
    tab-size: 2;
  }

  .toast {
    position: fixed; inset-block-end: 20px; inset-inline-start: 50%;
    transform: translateX(-50%);
    padding: 8px 16px; border-radius: 999px;
    font-size: 13px; color: #fff; background: #0f172a;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.2);
  }

  @media (max-width: 780px) {
    main { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
    .editor { border-inline-end: 0; border-block-end: 1px solid var(--line); }
  }
</style>
