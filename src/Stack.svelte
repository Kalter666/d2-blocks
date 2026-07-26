<script>
  import Block from './Block.svelte';
  import { app, move } from './store.svelte.js';
  import { canMoveInto } from './blocks.js';

  // `root` makes this stack fill the scroll area. Without it the empty space
  // below the last block belongs to the container, which has no drop handlers —
  // so there'd be nowhere to aim when dragging a block back out of a group.
  let { list, path = '', root = false } = $props();

  let el = $state(null);
  let at = $state(-1);          // insertion index the indicator is showing, -1 for none
  let hovering = $state(false); // pointer is over this stack specifically

  // A drop that would nest a group in itself, or land a second `auth` beside the
  // first, is refused — but it has to *look* refused rather than just do nothing.
  const blocked = $derived(!!app.dragging && !canMoveInto(app.dragging, list));

  // The root direction is a toolbar setting, so it isn't drawn here. A group's
  // own direction still is — it's a real per-container choice, and pasting is
  // the only way one gets there.
  const shown = $derived(root ? list.filter((b) => b.type !== 'direction') : list);

  // Drop indices are counted against what's on screen; the move is against the
  // real list, which may hold blocks the stack didn't draw.
  const listIndex = (i) => (i >= shown.length ? list.length : list.indexOf(shown[i]));

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
    e.dataTransfer.dropEffect = blocked ? "none" : "move";
    hovering = true;
    at = blocked ? -1 : indexAt(e.clientY);
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (app.dragging && !blocked) move(app.dragging, list, listIndex(at < 0 ? shown.length : at));
    at = -1;
    hovering = false;
    app.dragging = null;
  }
</script>

<div
  bind:this={el}
  class="stack"
  role="list"
  class:root
  class:empty={shown.length === 0}
  class:receiving={at >= 0}
  class:blocked={blocked && hovering}
  ondragover={onDragOver}
  ondragleave={() => { at = -1; hovering = false; }}
  ondrop={onDrop}
>
  {#each shown as block, i (block)}
    {#if at === i}<div class="indicator"></div>{/if}
    <Block {block} {path} siblings={list} />
  {/each}
  {#if at >= shown.length}<div class="indicator"></div>{/if}
  {#if shown.length === 0}<p class="hint">drop blocks here</p>{/if}
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
  .stack.root { flex: 1; }
  .receiving { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  .blocked {
    background: color-mix(in oklab, #dc2626 10%, transparent);
    outline: 2px dashed #dc2626;
    outline-offset: 2px;
  }

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
