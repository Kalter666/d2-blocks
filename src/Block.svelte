<script>
  import Stack from './Stack.svelte';
  import Rich from './Rich.svelte';
  import { markdownHint } from './md.js';
  import { app, commit, del, reorder } from './store.svelte.js';
  import { t } from './i18n/index.svelte.js';
  import {
    targets, safeKey, renameKey, collides, defaultStyle,
    SHAPES, STYLE_PROPS, DIRECTIONS, ARROWS,
  } from './blocks.js';

  let { block = $bindable(), path = '', siblings = [] } = $props();

  // Description disclosure is deliberately local to this block. It is not an
  // accordion: any number of notes and connection descriptions can stay open.
  let mdOpen = $state(false);
  const mdSummary = $derived(markdownHint(block.label));

  // Compiled ids only on the root board: a layer's shapes aren't this file's.
  const options = $derived(targets(
    app.blocks,
    app.board ? [] : (app.diagram?.shapes ?? []).map((s) => s.id),
    [block.src, block.dst, block.target],
  ));
  const named = $derived(block.type === 'box' || block.type === 'group');

  // Typing can't be refused mid-word — you'd never get to type "authx" past
  // "auth" — so a bad name is flagged instead of blocked. d2 would merge two
  // same-named boxes into one shape with both sets of edges, and say nothing.
  const problem = $derived.by(() => {
    if (!named) return '';
    if (!block.name.trim()) return t('block.needsName');
    if (collides(siblings, block.name, block)) return t('block.duplicate', { kind: t(`block.verb.${block.type}`) });
    return '';
  });

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

  // Not bind:value — the old key has to be read before the new one is written,
  // so anything pointing at this block can be repointed in the same breath.
  // Done per keystroke, so a half-typed name never leaves a dangling reference.
  function setName(next) {
    const from = path + safeKey(block.name);
    block.name = next;
    renameKey(app.blocks, from, path + safeKey(next));
  }

  // Rich text is a mode of the label, not a separate field, so toggling it off
  // leaves the markdown behind as an ordinary (if long) label rather than
  // dropping what the user wrote.
  function toggleMd() {
    commit();
    if (block.md) {
      delete block.md;
      mdOpen = false;
    } else {
      block.md = true;
      mdOpen = false;
    }
  }

  const spec = $derived(STYLE_PROPS[block.prop] ?? {});

  // Switching property carries the old value across, which is how you end up
  // asking d2 for `stroke-dash: "#c9d6ff"`. Reset to something that validates.
  function setProp(next) {
    block.prop = next;
    block.value = defaultStyle(next);
  }

  function onDragStart(e) {
    // dragstart bubbles, and every ancestor group is draggable too — without
    // this, grabbing a nested box ends up dragging the outermost group instead.
    e.stopPropagation();
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
    <button class="grip" onkeydown={onGripKey} title={t('block.grip')}>
      <span aria-hidden="true">⠿</span>
      <span class="sr">{t('block.move', { kind: t(`block.verb.${block.type}`) })}</span>
    </button>

    {#if block.type === 'box'}
      <span class="verb">{t('block.verb.box')}</span>
      <input class="slot name" class:bad={problem} aria-invalid={!!problem} value={block.name} oninput={(e) => setName(e.currentTarget.value)} onfocus={commit} placeholder={t('placeholder.name')} size="8" />
      {#if !block.md}
        <span class="verb dim">{t('block.labelled')}</span>
        <input class="slot" bind:value={block.label} onfocus={commit} placeholder={t('placeholder.sameAsName')} size="10" />
      {/if}
      <span class="verb dim">{t('block.shaped')}</span>
      <select class="slot" bind:value={block.shape} onfocus={commit}>
        {#each SHAPES as [value]}<option {value} title="d2: {value || 'no shape'}">{!value && block.md ? t('shape.textOnly') : t(`shape.${value || 'default'}`)}</option>{/each}
      </select>
      <button class="chip" class:on={block.md} onclick={toggleMd}
        title={block.md ? t('block.md.off') : t('block.md.on')}>¶</button>

    {:else if block.type === 'group'}
      <span class="verb">{t('block.verb.group')}</span>
      <input class="slot name" class:bad={problem} aria-invalid={!!problem} value={block.name} oninput={(e) => setName(e.currentTarget.value)} onfocus={commit} placeholder={t('placeholder.name')} size="8" />
      <span class="verb dim">{t('block.labelled')}</span>
      <input class="slot" bind:value={block.label} onfocus={commit} placeholder={t('placeholder.sameAsName')} size="10" />

    {:else if block.type === 'link'}
      <span class="verb">{t('block.verb.connect')}</span>
      <select class="slot" bind:value={block.src} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      <select class="slot arrow" bind:value={block.arrow} onfocus={commit}>
        {#each ARROWS as a}<option value={a}>{a}</option>{/each}
      </select>
      <select class="slot" bind:value={block.dst} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      {#if !block.md}
        <span class="verb dim">{t('block.labelled')}</span>
        <input class="slot" bind:value={block.label} onfocus={commit} placeholder={t('placeholder.nothing')} size="8" />
      {/if}
      <button class="chip" class:on={block.md} onclick={toggleMd}
        title={block.md ? t('block.md.off') : t('block.md.on')}>¶</button>

    {:else if block.type === 'style'}
      <span class="verb">{t('block.verb.style')}</span>
      <select class="slot" bind:value={block.target} onfocus={commit}>
        {#each options as o}<option value={o.key}>{' '.repeat(o.depth * 2) + o.name}</option>{/each}
      </select>
      <select class="slot" value={block.prop} onchange={(e) => setProp(e.currentTarget.value)} onfocus={commit}>
        {#each Object.keys(STYLE_PROPS) as p}<option value={p}>{p}</option>{/each}
      </select>

      {#if spec.kind === 'color'}
        <input class="swatch" type="color" bind:value={block.value} onfocus={commit} aria-label={t('block.colourAria', { prop: block.prop })} />
        <input class="slot hex" bind:value={block.value} onfocus={commit} placeholder={t('placeholder.hex')} size="8" />
      {:else if spec.kind === 'number'}
        <input
          class="slot num" type="number" bind:value={block.value} onfocus={commit}
          min={spec.min} max={spec.max ?? undefined} step={spec.step} aria-label={block.prop}
        />
        <span class="verb dim">{spec.max == null ? t('block.range.min', { min: spec.min }) : t('block.range.minMax', { min: spec.min, max: spec.max })}</span>
      {:else if spec.kind === 'bool'}
        <label class="bool">
          <input type="checkbox" checked={block.value === 'true'} onfocus={commit}
            onchange={(e) => (block.value = String(e.currentTarget.checked))} />
          {block.value === 'true' ? t('block.yes') : t('block.no')}
        </label>
      {:else if spec.kind === 'enum'}
        <select class="slot" bind:value={block.value} onfocus={commit}>
          {#each spec.options as o}<option value={o}>{o}</option>{/each}
        </select>
      {:else}
        <input class="slot" bind:value={block.value} onfocus={commit} placeholder="value" size="9" />
      {/if}

    {:else if block.type === 'direction'}
      <span class="verb">{t('block.verb.direction')}</span>
      <select class="slot" bind:value={block.value} onfocus={commit}>
        {#each DIRECTIONS as d}<option value={d}>{d}</option>{/each}
      </select>

    {:else}
      <span class="verb">{t('block.verb.raw')}</span>
      <code class="raw-text">{block.text || ' '}</code>
    {/if}

    <button class="remove" onclick={() => del(block)} title={t('block.delete')}>×</button>
  </div>

  {#if problem}<p class="problem">{problem}</p>{/if}

  {#if (block.type === 'box' || block.type === 'link') && block.md}
    <button
      class="md-summary"
      class:empty={!block.label}
      onclick={() => (mdOpen = !mdOpen)}
      aria-expanded={mdOpen}
      title={mdOpen ? t('block.desc.close') : t('block.desc.open')}
    >
      <span class="md-chevron" class:open={mdOpen} aria-hidden="true">›</span>
      <span class="md-kind">{mdSummary.heading ? t('block.mdKind.heading') : t('block.mdKind.description')}</span>
      <span class="md-preview">{mdSummary.empty ? t('block.descEmpty') : mdSummary.text}</span>
    </button>
    {#if mdOpen}<Rich bind:value={block.label} />{/if}
  {/if}

  {#if block.type === 'group'}
    <div class="children">
      <Stack bind:list={block.children} path={`${path}${safeKey(block.name)}.`} />
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
  .bad { border-color: #dc2626; background: color-mix(in oklab, #dc2626 8%, var(--bg)); }
  .bad:focus-visible { outline-color: #dc2626; }

  .problem {
    margin: 0; padding: 0 10px 7px 24px;
    font-size: 11px; color: #dc2626;
  }
  .arrow { font-family: var(--mono); }

  .swatch {
    inline-size: 30px; block-size: 24px; padding: 2px;
    border: 1px solid var(--line); border-radius: 5px; background: var(--bg);
    cursor: pointer;
  }
  .hex { font-family: var(--mono); }
  .num { inline-size: 4.5rem; }

  .bool {
    display: flex; align-items: center; gap: 4px;
    font-size: 12px; color: var(--muted); cursor: pointer;
  }

  .chip {
    padding: 2px 6px; border-radius: 5px; cursor: pointer;
    border: 1px solid var(--line); background: var(--bg);
    color: var(--muted); font: inherit; font-size: 12px; line-height: 1.3;
  }
  .chip:hover { color: var(--fg); }
  .chip.on { background: var(--tint); border-color: var(--tint); color: #fff; }

  .md-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    inline-size: calc(100% - 32px);
    min-inline-size: 0;
    margin: 0 8px 8px 24px;
    padding: 5px 8px;
    border: 1px solid color-mix(in oklab, var(--tint) 25%, var(--line));
    border-radius: 6px;
    background: color-mix(in oklab, var(--tint) 5%, var(--bg));
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: start;
    cursor: pointer;
  }
  .md-summary:hover {
    border-color: color-mix(in oklab, var(--tint) 55%, var(--line));
    background: color-mix(in oklab, var(--tint) 9%, var(--bg));
  }
  .md-summary:focus-visible { outline: 2px solid var(--tint); outline-offset: 1px; }
  .md-chevron {
    flex: none;
    color: var(--tint);
    font-size: 18px;
    line-height: 0.8;
    transition: transform 0.14s ease;
  }
  .md-chevron.open { transform: rotate(90deg); }
  .md-kind {
    flex: none;
    color: var(--tint);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .md-preview {
    min-inline-size: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .md-summary.empty .md-preview { font-style: italic; }

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
