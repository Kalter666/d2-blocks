<script>
  import Stack from './Stack.svelte';
  import { app, commit, del, reorder } from './store.svelte.js';
  import { keys, safeKey, SHAPES, STYLE_PROPS, DIRECTIONS, ARROWS } from './blocks.js';

  let { block, path = '' } = $props();

  const options = $derived(keys(app.blocks));

  // The d2 id this block draws on the canvas, so hovering can light it up.
  const targetId = $derived.by(() => {
    if (block.type === 'box' || block.type === 'group') return path + safeKey(block.name);
    if (block.type === 'style') return block.target;
    if (block.type === 'link') {
      const c = app.diagram?.connections?.find((c) => c.src === block.src && c.dst === block.dst);
      return c?.id ?? null;
    }
    return null;
  });

  const lit = $derived(targetId != null && app.hover === targetId);

  function onDragStart(e) {
    app.dragging = block;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // Firefox won't drag without it
  }

  // Dragging is the nice way to reorder; arrows are the way that works without
  // a mouse. Nesting is still drag-only — see README.
  function onGripKey(e) {
    const delta = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    if (reorder(block, delta)) e.currentTarget.focus();
  }
</script>

<div
  class="block {block.type}"
  class:lit
  role="listitem"
  draggable="true"
  ondragstart={onDragStart}
  ondragend={() => (app.dragging = null)}
  onpointerenter={() => targetId && (app.hover = targetId)}
  onpointerleave={() => (app.hover = null)}
>
  <div class="row">
    <button class="grip" onkeydown={onGripKey} title="Drag to move, or arrow keys to reorder">
      <span aria-hidden="true">⠿</span>
      <span class="sr">Move this {block.type} block</span>
    </button>

    {#if block.type === 'box'}
      <span class="verb">box</span>
      <input class="slot name" bind:value={block.name} onfocus={commit} placeholder="name" size="8" />
      <span class="verb dim">labelled</span>
      <input class="slot" bind:value={block.label} onfocus={commit} placeholder="same as name" size="10" />
      <span class="verb dim">shaped</span>
      <select class="slot" bind:value={block.shape} onfocus={commit}>
        {#each SHAPES as s}<option value={s}>{s || 'default'}</option>{/each}
      </select>

    {:else if block.type === 'group'}
      <span class="verb">group</span>
      <input class="slot name" bind:value={block.name} onfocus={commit} placeholder="name" size="8" />
      <span class="verb dim">labelled</span>
      <input class="slot" bind:value={block.label} onfocus={commit} placeholder="same as name" size="10" />

    {:else if block.type === 'link'}
      <span class="verb">connect</span>
      <select class="slot" bind:value={block.src} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      <select class="slot arrow" bind:value={block.arrow} onfocus={commit}>
        {#each ARROWS as a}<option value={a}>{a}</option>{/each}
      </select>
      <select class="slot" bind:value={block.dst} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      <span class="verb dim">labelled</span>
      <input class="slot" bind:value={block.label} onfocus={commit} placeholder="nothing" size="8" />

    {:else if block.type === 'style'}
      <span class="verb">style</span>
      <select class="slot" bind:value={block.target} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      <select class="slot" bind:value={block.prop} onfocus={commit}>
        {#each STYLE_PROPS as p}<option value={p}>{p}</option>{/each}
      </select>
      <input class="slot" bind:value={block.value} onfocus={commit} placeholder="value" size="9" />
      {#if block.prop === 'fill' || block.prop === 'stroke' || block.prop === 'font-color'}
        <input class="swatch" type="color" bind:value={block.value} onfocus={commit} aria-label="pick a colour" />
      {/if}

    {:else if block.type === 'direction'}
      <span class="verb">lay out</span>
      <select class="slot" bind:value={block.value} onfocus={commit}>
        {#each DIRECTIONS as d}<option value={d}>{d}</option>{/each}
      </select>

    {:else}
      <span class="verb">d2</span>
      <code class="raw-text">{block.text || ' '}</code>
    {/if}

    <button class="remove" onclick={() => del(block)} title="Delete this block">×</button>
  </div>

  {#if block.type === 'group'}
    <div class="children">
      <Stack list={block.children} path={`${path}${safeKey(block.name)}.`} />
    </div>
  {/if}
</div>

<style>
  .block {
    --tint: #64748b;
    background: var(--surface);
    border: 1px solid color-mix(in oklab, var(--tint) 35%, transparent);
    border-left: 4px solid var(--tint);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
    transition: box-shadow 0.12s, transform 0.12s;
  }
  .block:active { cursor: grabbing; }
  .box       { --tint: #3b82f6; }
  .group     { --tint: #8b5cf6; }
  .link      { --tint: #f59e0b; }
  .style     { --tint: #ec4899; }
  .direction { --tint: #64748b; }
  .raw       { --tint: #94a3b8; }

  .lit {
    box-shadow: 0 0 0 2px var(--tint), 0 2px 8px color-mix(in oklab, var(--tint) 40%, transparent);
    transform: translateX(1px);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 7px 8px 7px 6px;
  }

  .grip {
    border: 0; background: none; padding: 2px; border-radius: 4px;
    color: var(--tint); cursor: grab; font-size: 13px; line-height: 1; opacity: 0.6;
  }
  .grip:hover, .grip:focus-visible { opacity: 1; }
  .grip:active { cursor: grabbing; }

  .sr {
    position: absolute; inline-size: 1px; block-size: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }

  .verb { font-size: 12px; font-weight: 600; color: var(--tint); white-space: nowrap; }
  .verb.dim { font-weight: 400; color: var(--muted); }

  .slot {
    font: inherit;
    font-size: 12px;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--bg);
    color: var(--fg);
    min-width: 0;
  }
  .slot:focus-visible { outline: 2px solid var(--tint); outline-offset: 0; }
  .name { font-weight: 600; }
  .arrow { font-family: var(--mono); }

  .swatch {
    inline-size: 24px; block-size: 22px; padding: 0;
    border: 1px solid var(--line); border-radius: 5px; background: none;
  }

  .raw-text {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    white-space: pre;
    overflow-x: auto;
    flex: 1;
  }

  .remove {
    margin-inline-start: auto;
    border: 0; background: none; color: var(--muted);
    font-size: 16px; line-height: 1; cursor: pointer;
    padding: 2px 4px; border-radius: 4px;
  }
  .remove:hover { color: #dc2626; background: color-mix(in oklab, #dc2626 12%, transparent); }

  .children {
    margin: 0 8px 8px 14px;
    padding-inline-start: 8px;
    border-inline-start: 2px dashed color-mix(in oklab, var(--tint) 40%, transparent);
  }
</style>
