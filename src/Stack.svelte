<script>
  import Block from './Block.svelte';
  import { app, move } from './store.svelte.js';

  let { list, path = '' } = $props();

  let el = $state(null);
  let at = $state(-1); // insertion index the indicator is showing, -1 for none

  /** Insertion index from the pointer: before the first block whose middle is below it. */
  function indexAt(y) {
    const blocks = [...el.children].filter((c) => c.classList.contains('block'));
    const i = blocks.findIndex((b) => {
      const r = b.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? blocks.length : i;
  }

  function onDragOver(e) {
    if (!app.dragging) return;
    e.preventDefault();
    e.stopPropagation(); // the innermost stack under the pointer wins
    e.dataTransfer.dropEffect = 'move';
    at = indexAt(e.clientY);
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (app.dragging) move(app.dragging, list, at < 0 ? list.length : at);

    at = -1;
    app.dragging = null;
  }
</script>

<div
  bind:this={el}
  class="stack"
  role="list"
  class:empty={list.length === 0}
  class:receiving={at >= 0}
  ondragover={onDragOver}
  ondragleave={() => (at = -1)}
  ondrop={onDrop}
>
  {#each list as block, i (block)}
    {#if at === i}<div class="indicator"></div>{/if}
    <Block {block} {path} />
  {/each}
  {#if at >= list.length}<div class="indicator"></div>{/if}
  {#if list.length === 0}<p class="hint">drop blocks here</p>{/if}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-block-size: 8px;
    border-radius: 8px;
  }
  .stack.empty { min-block-size: 34px; }
  .receiving { background: color-mix(in oklab, var(--accent) 8%, transparent); }

  .indicator {
    block-size: 3px;
    margin-block: -4px;
    border-radius: 2px;
    background: var(--accent);
  }

  .hint {
    margin: 0;
    padding: 8px;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    border: 1px dashed var(--line);
    border-radius: 6px;
  }
</style>
