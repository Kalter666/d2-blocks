<script>
  import Stack from './Stack.svelte';
  import Canvas from './Canvas.svelte';
  import Examples from './Examples.svelte';
  import MermaidImport from './MermaidImport.svelte';
  import { draw } from './d2.js';
  import { keys, defaultStyle, DIRECTIONS } from './blocks.js';
  import {
    app, source, add, undo, redo, canUndo, canRedo, save, setSource, commit,
    direction, setDirection, mermaid,
  } from './store.svelte.js';
  import { t, LOCALES, setLocale, example as exampleText } from './i18n/index.svelte.js';

  // ids only — the display name comes from t('theme.<id>') so it follows the locale.
  const THEMES = [0, 1, 3, 4, 5, 6, 7, 8, 100, 302, 300];
  // d2 emits both and picks via prefers-color-scheme, so the diagram follows the
  // OS theme like the rest of the app. Otherwise it's a white slab in dark mode.
  const DARK_THEMES = [200, 201, 301];
  const REPO = 'https://github.com/Kalter666/d2-blocks';

  let showCode = $state(true);
  let showExamples = $state(false);
  let showMermaid = $state(false);
  let toast = $state('');
  let sourceHeight = $state(null);
  let sourceFooter = $state(null);
  const src = $derived(source());
  const options = $derived(keys(app.blocks));

  // While the code pane has focus, what you typed is the truth — otherwise every
  // keystroke would be reparsed and reprinted back at you mid-word. On blur the
  // draft is dropped and the canonical serialisation takes over, which doubles
  // as format-on-blur.
  let draft = $state(null);

  // Re-render on any change, coalesced. A token drops results that arrive after
  // a newer render has already started.
  let token = 0;
  $effect(() => {
    const forced = app.appearance;
    const selectedThemeID = forced === 'dark' ? app.darkTheme : app.theme;
    const selectedDarkThemeID = forced === 'light' ? app.theme : app.darkTheme;
    const [text, layout, themeID, darkThemeID, sketch, board] =
      [src, app.layout, selectedThemeID, selectedDarkThemeID, app.sketch, app.board];
    const mine = ++token;
    app.busy = true;
    const timer = setTimeout(async () => {
      try {
        const { svg, diagram, boards, board: shown } =
          await draw(text, { layout, themeID, darkThemeID, sketch, board });
        if (mine !== token) return;
        Object.assign(app, { svg, diagram, boards, error: '' });
        if (shown !== board) app.board = shown;
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
    type: 'style', target: options[0]?.key ?? '', prop: 'fill', value: defaultStyle('fill'),
  });

  function flash(msg) {
    toast = msg;
    setTimeout(() => (toast = ''), 1800);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(src);
    flash(t('toast.copiedD2'));
  }

  async function copyMermaid() {
    await navigator.clipboard.writeText(mermaid());
    flash(t('toast.copiedMermaid'));
  }

  function downloadSvg() {
    const url = URL.createObjectURL(new Blob([app.svg], { type: 'image/svg+xml' }));
    Object.assign(document.createElement('a'), { href: url, download: 'diagram.svg' }).click();
    URL.revokeObjectURL(url);
  }

  function loadExample(example) {
    commit();
    draft = null;
    setSource(example.source);
    flash(t('toast.exampleLoaded', { title: exampleText(example.id).title }));
  }

  const MIN_SOURCE_HEIGHT = 150;
  const clampSourceHeight = (height) =>
    Math.min(Math.max(MIN_SOURCE_HEIGHT, window.innerHeight * 0.7), Math.max(MIN_SOURCE_HEIGHT, height));

  function startSourceResize(e) {
    e.preventDefault();
    const handle = e.currentTarget;
    const pointer = e.pointerId;
    const startY = e.clientY;
    const startHeight = sourceFooter.getBoundingClientRect().height;

    handle.setPointerCapture(pointer);
    const move = (event) => {
      sourceHeight = clampSourceHeight(startHeight + startY - event.clientY);
    };
    const stop = () => {
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function resizeSourceWithKeys(e) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const height = sourceFooter.getBoundingClientRect().height;
    sourceHeight = clampSourceHeight(height + (e.key === 'ArrowUp' ? step : -step));
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

  <button class="examples" onclick={() => (showExamples = true)}>▦ {t('toolbar.examples')}</button>

  <div class="group">
    <button onclick={undo} disabled={!canUndo()} title={t('toolbar.undo')}>↶</button>
    <button onclick={redo} disabled={!canRedo()} title={t('toolbar.redo')}>↷</button>
  </div>

  <label>{t('toolbar.flow')}
    <select value={direction()} onchange={(e) => setDirection(e.currentTarget.value)}>
      {#each DIRECTIONS as d}<option value={d}>{d}</option>{/each}
    </select>
  </label>

  <label>{t('toolbar.layout')}
    <select bind:value={app.layout}>
      <option value="dagre">dagre</option>
      <option value="elk">elk</option>
    </select>
  </label>

  <label>{t('toolbar.look')}
    <select bind:value={app.look}>
      <option value="3d">{t('look.3d')}</option>
      <option value="flat">{t('look.flat')}</option>
    </select>
  </label>

  {#if app.boards.length}
    <label>{t('toolbar.board')}
      <select bind:value={app.board}>
        <option value="">{t('board.root')}</option>
        {#each app.boards as b}<option value={b.path}>{t(`board.${b.kind}`)}: {b.label}</option>{/each}
      </select>
    </label>
  {/if}

  <label>{t('toolbar.appearance')}
    <select bind:value={app.appearance}>
      <option value="system">{t('appearance.system')}</option>
      <option value="light">{t('appearance.light')}</option>
      <option value="dark">{t('appearance.dark')}</option>
    </select>
  </label>

  <label>{t('toolbar.light')}
    <select value={app.theme} onchange={(e) => {
      app.theme = Number(e.currentTarget.value);
      app.appearance = 'light';
    }}>
      {#each THEMES as id}<option value={id}>{t(`theme.${id}`)}</option>{/each}
    </select>
  </label>

  <label>{t('toolbar.dark')}
    <select value={app.darkTheme} onchange={(e) => {
      app.darkTheme = Number(e.currentTarget.value);
      app.appearance = 'dark';
    }}>
      {#each DARK_THEMES as id}<option value={id}>{t(`theme.${id}`)}</option>{/each}
    </select>
  </label>

  <label>{t('toolbar.language')}
    <select value={app.locale} onchange={(e) => setLocale(e.currentTarget.value)}>
      {#each Object.entries(LOCALES) as [code, name]}<option value={code}>{name}</option>{/each}
    </select>
  </label>

  <label class="check"><input type="checkbox" bind:checked={app.sketch} /> {t('toolbar.sketch')}</label>

  <span class="spacer"></span>
  {#if app.busy}<span class="busy" aria-live="polite">{t('toolbar.busy')}</span>{/if}

  <button onclick={() => (showMermaid = true)}>{t('toolbar.importMermaid')}</button>
  <button onclick={copyMermaid}>{t('toolbar.copyMermaid')}</button>
  <button onclick={copyCode}>{t('toolbar.copyD2')}</button>
  <button class="primary" onclick={downloadSvg}>{t('toolbar.downloadSvg')}</button>
</header>

<main>
  <section class="editor">
    <div class="scroll">
      <Stack bind:list={app.blocks} root />
    </div>
    <div class="palette">
      <button class="add box" onclick={addBox}>{t('palette.box')}</button>
      <button class="add group" onclick={addGroup}>{t('palette.group')}</button>
      <button class="add link" onclick={addLink} disabled={!options.length}>{t('palette.connect')}</button>
      <button class="add style" onclick={addStyle} disabled={!options.length}>{t('palette.style')}</button>
    </div>
  </section>

  <Canvas />
</main>

<footer
  bind:this={sourceFooter}
  class:open={showCode}
  style:height={showCode && sourceHeight ? `${sourceHeight}px` : null}
>
  {#if showCode}
    <button
      type="button"
      class="source-resizer"
      aria-label={t('source.resize')}
      title={t('source.resize')}
      onpointerdown={startSourceResize}
      onkeydown={resizeSourceWithKeys}
      ondblclick={() => (sourceHeight = null)}
    ></button>
  {/if}
  <div class="bar">
    <button class="drawer" onclick={() => (showCode = !showCode)} aria-expanded={showCode}>
      <span class="chevron" class:up={showCode}>▾</span> {t('source.label')}
      <span class="note">{t('source.note')}</span>
    </button>
    <a href={REPO} target="_blank" rel="noopener">{t('footer.source')}</a>
    <a href="{REPO}/blob/main/LICENSE" target="_blank" rel="noopener">MIT</a>
  </div>
  {#if showCode}
    <textarea
      class="code"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
      aria-label={t('source.aria')}
      value={draft ?? src}
      onfocus={() => { commit(); draft = src; }}
      oninput={(e) => setSource((draft = e.currentTarget.value))}
      onblur={() => (draft = null)}
    ></textarea>
  {/if}
</footer>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}
<Examples bind:open={showExamples} onload={loadExample} />
<MermaidImport bind:open={showMermaid} onimport={() => flash('mermaid imported')} />

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
  select:disabled { opacity: 0.45; }

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
  .examples { font-weight: 650; }

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
  .scroll { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; }

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

  footer {
    position: relative;
    flex: none;
    background: var(--surface);
    border-block-start: 1px solid var(--line);
  }
  footer.open {
    block-size: min(32vh, 18rem);
    min-block-size: 150px;
    max-block-size: 70vh;
    display: flex;
    flex-direction: column;
  }

  .source-resizer {
    position: absolute;
    z-index: 2;
    inset: -4px 0 auto;
    inline-size: 100%;
    block-size: 9px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: row-resize;
    touch-action: none;
  }
  .source-resizer::after {
    content: '';
    position: absolute;
    inset: 3px 0 auto;
    border-block-start: 1px solid transparent;
  }
  .source-resizer:hover::after,
  .source-resizer:focus-visible::after { border-color: var(--accent); }
  .source-resizer:focus-visible { outline: none; }

  .bar { display: flex; align-items: center; }
  .bar a {
    padding: 6px 8px; font-size: 11px; color: var(--muted);
    text-decoration: none; white-space: nowrap;
  }
  .bar a:hover { color: var(--accent); text-decoration: underline; }
  .bar a:last-child { padding-inline-end: 14px; }

  .drawer {
    display: flex; align-items: center; gap: 7px; flex: 1;
    font: inherit; font-size: 12px; font-weight: 600; text-align: start;
    padding: 6px 14px; border: 0; background: none; color: var(--fg); cursor: pointer;
  }
  .chevron { display: inline-block; transition: transform 0.15s; }
  .chevron.up { transform: rotate(180deg); }
  .note { font-weight: 400; color: var(--muted); }

  .code {
    flex: 1;
    margin: 0 14px 12px;
    padding: 8px 10px;
    min-block-size: 7rem;
    resize: none;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--mono); font-size: 12px; line-height: 1.55;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
  .code:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

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
