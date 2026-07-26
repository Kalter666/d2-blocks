<script>
  import { app } from './store.svelte.js';
  import { index } from './d2.js';

  let host = $state(null);   // holds the injected SVG
  let view = $state(null);   // scrolling viewport
  let zoom = $state(1);
  let maps = $state({ byId: new Map(), idByEl: new Map() });

  // Re-index whenever a new SVG lands. Reading app.svg creates the dependency;
  // $effect runs after the DOM update, so host already holds the new markup.
  $effect(() => {
    app.svg;
    maps = host ? index(host) : { byId: new Map(), idByEl: new Map() };
  });

  // Light up whatever the pointer is on, from either side of the app. Depends on
  // maps too, so a re-render re-applies the highlight to the new elements.
  $effect(() => {
    const el = app.hover != null ? maps.byId.get(app.hover) : null;
    el?.classList.add('lit');
    return () => el?.classList.remove('lit');
  });

  /** Innermost tagged <g> under the pointer — a box inside a group, not the group. */
  function onPointerMove(e) {
    for (let n = e.target; n && n !== view; n = n.parentNode) {
      const id = maps.idByEl.get(n);
      if (id != null) { app.hover = id; return; }
    }
    app.hover = null;
  }

  const MIN = 0.1, MAX = 16;
  const clamp = (z) => Math.min(MAX, Math.max(MIN, z));

  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel still scrolls
    e.preventDefault();
    zoom = clamp(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }

  /** Scale so the whole diagram fits the viewport — the useful "reset". */
  function fit() {
    const svg = host?.querySelector('svg');
    if (!svg) return (zoom = 1);
    const { width, height } = svg.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    if (!width || !height) return (zoom = 1);
    zoom = clamp(Math.min((box.width - 40) / (width / zoom), (box.height - 40) / (height / zoom)));
  }

  // Drag to pan, but not when starting on a shape — that's a hover target.
  function onPointerDown(e) {
    if (e.button !== 0) return;
    const x = e.clientX, y = e.clientY;
    const left = view.scrollLeft, top = view.scrollTop;
    view.setPointerCapture(e.pointerId);
    const drag = (m) => {
      view.scrollLeft = left - (m.clientX - x);
      view.scrollTop = top - (m.clientY - y);
    };
    const stop = () => {
      view.removeEventListener('pointermove', drag);
      view.releasePointerCapture(e.pointerId);
    };
    view.addEventListener('pointermove', drag);
    view.addEventListener('pointerup', stop, { once: true });
  }
</script>

<div class="canvas">
  <div
    class="view"
    role="application"
    aria-label="Diagram preview. Drag to pan, Ctrl and scroll to zoom."
    bind:this={view}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerleave={() => (app.hover = null)}
  >
    <div class="paper" bind:this={host} style="zoom: {zoom}">
      {@html app.svg}
    </div>
  </div>

  {#if app.error}
    <p class="error" role="status">{app.error}</p>
  {/if}

  <div class="zoom">
    <button onclick={() => (zoom = clamp(zoom / 1.25))} disabled={zoom <= MIN} title="Zoom out">−</button>
    <button class="level" onclick={() => (zoom = 1)} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
    <button onclick={() => (zoom = clamp(zoom * 1.25))} disabled={zoom >= MAX} title="Zoom in">+</button>
    <button onclick={fit} title="Fit to window">⤢</button>
  </div>
</div>

<style>
  .canvas {
    position: relative;
    background: var(--bg);
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 22px 22px;
    overflow: hidden;
  }

  .view {
    block-size: 100%;
    overflow: auto;
    cursor: grab;
    touch-action: none;
  }
  .view:active { cursor: grabbing; }

  .paper { display: flex; justify-content: center; padding: 20px; min-block-size: 100%; }
  .paper :global(svg) { max-inline-size: none; }

  /* Both directions of the hover link land here. */
  .paper :global(.lit) { filter: drop-shadow(0 0 5px var(--accent)) drop-shadow(0 0 2px var(--accent)); }
  .paper :global(g) { transition: filter 0.12s; }

  .error {
    position: absolute; inset-block-end: 12px; inset-inline: 12px;
    margin: 0; padding: 8px 12px;
    font-family: var(--mono); font-size: 12px; white-space: pre-wrap;
    color: #7f1d1d; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  }

  .zoom {
    position: absolute; inset-block-start: 12px; inset-inline-end: 12px;
    display: flex; gap: 1px;
    background: var(--line); border: 1px solid var(--line);
    border-radius: 7px; overflow: hidden;
  }
  .zoom button {
    border: 0; background: var(--surface); color: var(--fg);
    font: inherit; font-size: 13px; padding: 3px 9px; cursor: pointer;
  }
  .zoom button:hover:not(:disabled) { background: var(--bg); }
  .zoom button:disabled { opacity: 0.4; cursor: default; }
  .level { font-variant-numeric: tabular-nums; min-inline-size: 46px; }
</style>
