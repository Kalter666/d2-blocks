<script>
  import { serialize } from './blocks.js';
  import { fromMermaid } from './mermaid.js';
  import { importMermaid } from './store.svelte.js';
  import { draw } from './d2.js';
  import { t } from './i18n/index.svelte.js';

  let { open = $bindable(false), onimport } = $props();

  const SAMPLE = `flowchart TD
  A[Client] --> B{Auth?}
  B -->|yes| C[(Database)]
  B -->|no| D[Login]`;

  let text = $state('');
  let preview = $state('');
  let error = $state('');
  let previewToken = 0;

  // Preview reuses the d2 engine: translate mermaid -> blocks -> d2 -> SVG. This
  // shows exactly what Import will produce, and validates it in one pass.
  $effect(() => {
    if (!open) return;
    const src = text.trim();
    const mine = ++previewToken;
    preview = '';
    error = '';
    if (!src) return;
    let d2;
    try {
      d2 = serialize(fromMermaid(src));
    } catch (e) {
      error = String(e?.message ?? e);
      return;
    }
    draw(d2, { layout: 'dagre', themeID: 0, darkThemeID: 200, sketch: false })
      .then(({ svg }) => { if (mine === previewToken) preview = svg; })
      .catch((e) => { if (mine === previewToken) error = String(e?.message ?? e); });
  });

  function doImport() {
    try {
      importMermaid(text);
      onimport?.();
      open = false;
    } catch (e) {
      error = String(e?.message ?? e);
    }
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
    onclick={(event) => { if (event.currentTarget === event.target) open = false; }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mermaid-title">
      <header>
        <div>
          <h2 id="mermaid-title">{t('mermaid.title')}</h2>
          <p>{t('mermaid.subtitle')}</p>
        </div>
        <button class="close" onclick={() => (open = false)} aria-label={t('mermaid.close')}>×</button>
      </header>

      <div class="content">
        <div class="input">
          <textarea
            bind:value={text}
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            placeholder={SAMPLE}
            aria-label={t('mermaid.sourceAria')}
          ></textarea>
        </div>
        <aside class="preview-pane">
          <div class="preview" aria-label={t('mermaid.previewAria')}>
            {#if preview}
              <div class="svg">{@html preview}</div>
            {:else if error}
              <span class="preview-message error">{error}</span>
            {:else if text.trim()}
              <span class="preview-message">{t('mermaid.drawingPreview')}</span>
            {:else}
              <span class="preview-message">{t('mermaid.pastePrompt')}</span>
            {/if}
          </div>
          <button class="load" onclick={doImport} disabled={!text.trim() || !!error}>{t('mermaid.import')}</button>
          <small>{t('mermaid.footnote')}</small>
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
    inline-size: min(1000px, 100%);
    block-size: min(680px, 100%);
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
  h2, p { margin: 0; }
  h2 { font-size: 19px; letter-spacing: -0.02em; }
  header p { margin-block-start: 4px; color: var(--muted); font-size: 12px; }
  button { font: inherit; color: inherit; }
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

  .content {
    display: grid;
    grid-template-columns: minmax(320px, 1fr) minmax(300px, 0.9fr);
    flex: 1;
    min-block-size: 0;
  }
  .input { display: flex; padding: 16px 16px 16px 20px; }
  textarea {
    flex: 1;
    resize: none;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  .preview-pane {
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    padding: 16px 20px;
    border-inline-start: 1px solid var(--line);
    background: var(--bg);
  }
  .preview {
    display: grid;
    flex: 1;
    min-block-size: 250px;
    place-items: center;
    margin-block-end: 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: #fff;
  }
  .svg { display: grid; inline-size: 100%; block-size: 100%; place-items: center; padding: 10px; }
  .svg :global(svg) { inline-size: 100%; block-size: 100%; max-inline-size: 100%; max-block-size: 100%; }
  .preview-message { padding: 0 16px; color: #78839a; font-size: 12px; text-align: center; }
  .preview-message.error { color: #dc2626; white-space: pre-wrap; }
  .load {
    padding: 9px 14px;
    border: 0;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .load:hover:not(:disabled) { background: var(--accent-dark); }
  .load:disabled { opacity: 0.5; cursor: not-allowed; }
  small { margin-block-start: 7px; color: var(--muted); font-size: 10px; text-align: center; }

  @media (max-width: 800px) {
    .backdrop { padding: 0; }
    .dialog { inline-size: 100%; block-size: 100%; border: 0; border-radius: 0; }
    .content { display: block; overflow: auto; }
    .input { block-size: 240px; }
    .preview-pane { border-inline-start: 0; border-block-start: 1px solid var(--line); }
    .preview { block-size: 300px; }
  }
</style>
