<script>
  import { draw } from './d2.js';
  import { EXAMPLES, EXAMPLE_CATEGORIES } from './examples.js';

  let { open = $bindable(false), onload } = $props();
  let query = $state('');
  let category = $state('All');
  let selectedID = $state(EXAMPLES[0].id);
  let preview = $state('');
  let previewError = $state('');
  let previewToken = 0;

  const filtered = $derived(EXAMPLES.filter((example) => {
    const matchesCategory = category === 'All' || example.category === category;
    const haystack = `${example.title} ${example.description} ${example.tags.join(' ')}`.toLowerCase();
    return matchesCategory && haystack.includes(query.trim().toLowerCase());
  }));
  const selected = $derived(
    EXAMPLES.find((example) => example.id === selectedID) ?? filtered[0] ?? EXAMPLES[0],
  );

  $effect(() => {
    if (!open || !selected) return;
    const mine = ++previewToken;
    preview = '';
    previewError = '';
    draw(selected.source, { layout: 'dagre', themeID: 0, darkThemeID: 200, sketch: false })
      .then(({ svg }) => {
        if (mine === previewToken) preview = svg;
      })
      .catch((error) => {
        if (mine === previewToken) previewError = String(error?.message ?? error);
      });
  });

  function choose(example) {
    selectedID = example.id;
  }

  function loadSelected() {
    onload(selected);
    open = false;
  }

  function onKey(event) {
    if (open && event.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.currentTarget === event.target) open = false;
    }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="examples-title">
      <header>
        <div>
          <h2 id="examples-title">System design examples</h2>
          <p>Start with a proven architecture, then edit every block and connection.</p>
        </div>
        <button class="close" onclick={() => (open = false)} aria-label="Close examples">×</button>
      </header>

      <div class="filters">
        <input
          type="search"
          bind:value={query}
          placeholder="Search examples…"
          aria-label="Search examples"
        />
        <div class="categories" aria-label="Example categories">
          {#each ['All', ...EXAMPLE_CATEGORIES] as item}
            <button class:active={category === item} onclick={() => (category = item)}>
              {item}
            </button>
          {/each}
        </div>
      </div>

      <div class="content">
        <div class="results">
          <div class="count">{filtered.length} {filtered.length === 1 ? 'example' : 'examples'}</div>
          {#if filtered.length}
            <div class="cards">
              {#each filtered as example}
                <button
                  class="card"
                  class:selected={selected.id === example.id}
                  onclick={() => choose(example)}
                  aria-pressed={selected.id === example.id}
                >
                  <span class="card-title">{example.title}</span>
                  <span class="description">{example.description}</span>
                  <span class="tags">
                    {#each example.tags as tag}<span>{tag}</span>{/each}
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="empty">No examples match “{query}”.</div>
          {/if}
        </div>

        <aside class="preview-pane">
          <div class="preview-heading">
            <div>
              <span class="eyebrow">{selected.category}</span>
              <h3>{selected.title}</h3>
            </div>
            <span class="editable">fully editable</span>
          </div>
          <div class="preview" aria-label="{selected.title} diagram preview">
            {#if preview}
              <div class="svg">{@html preview}</div>
            {:else if previewError}
              <span class="preview-message">Preview unavailable</span>
            {:else}
              <span class="preview-message">drawing preview…</span>
            {/if}
          </div>
          <p>{selected.description}</p>
          <button class="load" onclick={loadSelected}>Use this example</button>
          <small>Loading is undoable and does not change your layout or theme.</small>
        </aside>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(15 23 42 / 0.58);
    backdrop-filter: blur(3px);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    inline-size: min(1120px, 100%);
    block-size: min(760px, 100%);
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.3);
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding: 18px 20px 14px;
    border-block-end: 1px solid var(--line);
  }

  h2, h3, p { margin: 0; }
  h2 { font-size: 19px; letter-spacing: -0.02em; }
  header p { margin-block-start: 4px; color: var(--muted); font-size: 12px; }

  button, input { font: inherit; }
  button { color: inherit; }
  .close {
    align-self: start;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover { color: var(--fg); }

  .filters {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-block-end: 1px solid var(--line);
    background: var(--bg);
  }
  input {
    inline-size: 220px;
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    color: var(--fg);
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  .categories { display: flex; gap: 5px; overflow-x: auto; }
  .categories button {
    flex: none;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
  }
  .categories button:hover { color: var(--fg); background: var(--surface); }
  .categories button.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-weight: 650;
  }

  .content {
    display: grid;
    grid-template-columns: minmax(380px, 1.1fr) minmax(330px, 0.9fr);
    flex: 1;
    min-block-size: 0;
  }
  .results { overflow: auto; padding: 14px 16px 20px 20px; }
  .count {
    margin-block-end: 9px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .card {
    display: flex;
    flex-direction: column;
    align-items: start;
    min-block-size: 124px;
    padding: 12px;
    text-align: start;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    cursor: pointer;
  }
  .card:hover { border-color: var(--muted); background: var(--bg); }
  .card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }
  .card-title { font-size: 13px; font-weight: 700; }
  .description {
    display: -webkit-box;
    margin-block-start: 5px;
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-block-start: auto; padding-block-start: 8px; }
  .tags span {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--bg);
    color: var(--muted);
    font-size: 9px;
  }
  .empty { display: grid; place-items: center; block-size: 200px; color: var(--muted); }

  .preview-pane {
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    padding: 18px 20px;
    border-inline-start: 1px solid var(--line);
    background: var(--bg);
  }
  .preview-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .eyebrow {
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }
  h3 { margin-block-start: 2px; font-size: 16px; }
  .editable {
    padding: 3px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, #22c55e 14%, transparent);
    color: #16a34a;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .preview {
    display: grid;
    flex: 1;
    min-block-size: 250px;
    place-items: center;
    margin-block: 14px 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: #fff;
  }
  .svg { display: grid; inline-size: 100%; block-size: 100%; place-items: center; padding: 10px; }
  .svg :global(svg) { inline-size: 100%; block-size: 100%; max-inline-size: 100%; max-block-size: 100%; }
  .preview-message { color: #78839a; font-size: 12px; }
  .preview-pane > p { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .load {
    margin-block-start: 14px;
    padding: 9px 14px;
    border: 0;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .load:hover { background: var(--accent-dark); }
  small { margin-block-start: 7px; color: var(--muted); font-size: 10px; text-align: center; }

  @media (max-width: 800px) {
    .backdrop { padding: 0; }
    .dialog { inline-size: 100%; block-size: 100%; border: 0; border-radius: 0; }
    .filters { align-items: stretch; flex-direction: column; }
    input { inline-size: 100%; }
    .content { display: block; overflow: auto; }
    .results { overflow: visible; padding: 14px; }
    .preview-pane { border-inline-start: 0; border-block-start: 1px solid var(--line); }
    .preview { block-size: 320px; }
  }

  @media (max-width: 480px) {
    .cards { grid-template-columns: 1fr; }
  }
</style>
