<script>
  import { toHtml, toMd, rich } from './md.js';
  import { commit } from './store.svelte.js';

  let { value = $bindable('') } = $props();

  let el = $state(null);
  // Decided once, not continuously: flipping mode mid-keystroke would yank the
  // caret, and markdown that starts out non-canonical should stay in the
  // textarea until the user explicitly asks for it to be reformatted.
  let wysiwyg = $state(rich(value));
  let last = null; // the markdown this editor last emitted

  $effect(() => {
    if (!el) return;
    // Keep execCommand's output inside the subset toMd understands.
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, false);
  });

  // Seeds on mount, and re-seeds when the value changed somewhere else — undo,
  // or a code-pane edit. Typing can't trigger it, because pull() moves `last`
  // in the same breath; re-seeding on every keystroke would reset the caret.
  $effect(() => {
    if (!el || value === last) return;
    el.innerHTML = toHtml(value);
    last = value;
  });

  function pull() {
    last = toMd(el.innerHTML);
    value = last;
  }

  const cmd = (c, arg) => { el.focus(); document.execCommand(c, false, arg); pull(); };

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  function code() {
    const sel = document.getSelection()?.toString();
    if (sel) cmd('insertHTML', `<code>${esc(sel)}</code>`);
  }

  function link() {
    const url = prompt('Link to:');
    if (url) cmd('createLink', url);
  }

  function onPaste(e) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    // Laundered through the bridge both ways, so pasted browser or Word markup
    // can't smuggle in anything toMd would silently drop on the way back out.
    // Plain text goes through toHtml too, so pasting markdown just works.
    const md = html ? toMd(html) : e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, toHtml(md));
    pull();
  }

  function convert() {
    commit();
    value = toMd(toHtml(value));
    wysiwyg = true;
  }

  // The inline editor is a few lines tall by design — it sits inside a block in
  // a narrow column. Anything longer than a note wants room, so it can pop out.
  let big = $state(false);
  let dlg = $state(null);

  $effect(() => { if (dlg && !dlg.open) dlg.showModal(); });

  // The contenteditable is destroyed and rebuilt when it moves in or out of the
  // dialog, so forget what was seeded — otherwise it comes back empty.
  function expand(next) {
    big = next;
    last = null;
  }

  const TOOLS = [
    ['B', 'Bold', () => cmd('bold'), 'b'],
    ['I', 'Italic', () => cmd('italic'), 'i'],
    ['<>', 'Code', code, ''],
    ['H1', 'Heading', () => cmd('formatBlock', '<h1>'), ''],
    ['H2', 'Subheading', () => cmd('formatBlock', '<h2>'), ''],
    ['•', 'Bullet list', () => cmd('insertUnorderedList'), ''],
    ['1.', 'Numbered list', () => cmd('insertOrderedList'), ''],
    ['🔗', 'Link', link, ''],
  ];
</script>

{#snippet editor()}
  {#if wysiwyg}
    <div class="tools">
      {#each TOOLS as [glyph, title, run, style]}
        <!-- mousedown, not click: the default would blur the editor and throw
             away the selection execCommand is about to act on. -->
        <button title={title} onmousedown={(e) => e.preventDefault()} onclick={run}
          style:font-weight={style === 'b' ? '700' : null}
          style:font-style={style === 'i' ? 'italic' : null}>{glyph}</button>
      {/each}
      <button class="grow" title={big ? 'Shrink back into the block' : 'Edit in a bigger window'}
        onmousedown={(e) => e.preventDefault()} onclick={() => expand(!big)}>{big ? '⤡' : '⤢'}</button>
    </div>

    <div
      class="body"
      bind:this={el}
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-multiline="true"
      aria-label="Rich text"
      spellcheck="false"
      oninput={pull}
      onpaste={onPaste}
      onfocus={commit}
    ></div>
  {:else}
    <textarea class="body plain" bind:value spellcheck="false" aria-label="Markdown" onfocus={commit}></textarea>
    <p class="hint">
      Formatting the toolbar can't show — editing as markdown.
      <button onclick={convert}>reformat &amp; edit visually</button>
    </p>
  {/if}
{/snippet}

{#if big}
  <!-- Native <dialog>: Escape, the backdrop and focus trapping all come free. -->
  <dialog bind:this={dlg} onclose={() => expand(false)}>
    <div class="rich full">{@render editor()}</div>
    <form method="dialog"><button class="done">Done</button></form>
  </dialog>
{:else}
  <div class="rich">{@render editor()}</div>
{/if}

<style>
  .rich {
    margin: 0 8px 8px 24px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }

  .tools {
    display: flex;
    gap: 1px;
    flex-wrap: wrap;
    padding: 3px 4px;
    border-block-end: 1px solid var(--line);
    background: var(--surface);
  }
  .tools button {
    min-inline-size: 24px;
    padding: 2px 5px;
    border: 0; border-radius: 4px;
    background: none; color: var(--muted);
    font: inherit; font-size: 11px; line-height: 1.4;
    cursor: pointer;
  }
  .tools button:hover { background: var(--bg); color: var(--fg); }
  .grow { margin-inline-start: auto; }

  .body {
    display: block;
    inline-size: 100%;
    min-block-size: 4.5rem;
    max-block-size: 16rem;
    overflow: auto;
    padding: 7px 9px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg);
  }
  .body:focus-visible { outline: 2px solid var(--tint, #3b82f6); outline-offset: -2px; }

  .plain {
    border: 0;
    background: none;
    resize: vertical;
    font-family: var(--mono);
    white-space: pre-wrap;
  }

  /* The canvas is the real preview — this only has to read as rich text. */
  .body :global(h1) { font-size: 15px; margin: 0 0 4px; }
  .body :global(h2) { font-size: 13px; margin: 0 0 4px; }
  .body :global(h3) { font-size: 12px; margin: 0 0 4px; }
  .body :global(p) { margin: 0 0 4px; }
  .body :global(ul), .body :global(ol) { margin: 0 0 4px; padding-inline-start: 18px; }
  .body :global(code) {
    font-family: var(--mono); font-size: 11px;
    padding: 0 3px; border-radius: 3px;
    background: color-mix(in oklab, var(--muted) 18%, transparent);
  }
  .body :global(a) { color: var(--accent); }

  dialog {
    inline-size: min(760px, 92vw);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--fg);
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.45); }

  .full { margin: 0; border: 0; border-radius: 0; }
  .full .body { min-block-size: 55vh; max-block-size: 70vh; font-size: 14px; }
  .full :global(h1) { font-size: 22px; }
  .full :global(h2) { font-size: 18px; }
  .full .tools button { font-size: 13px; padding: 4px 8px; }

  .done {
    display: block;
    margin: 10px 12px 12px auto;
    padding: 5px 14px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--accent); background: var(--accent); color: #fff;
    font: inherit; font-size: 12px;
  }

  .hint {
    margin: 0;
    padding: 4px 9px 6px;
    font-size: 11px;
    color: var(--muted);
    border-block-start: 1px solid var(--line);
  }
  .hint button {
    font: inherit; font-size: 11px;
    border: 0; background: none; padding: 0;
    color: var(--accent); text-decoration: underline; cursor: pointer;
  }
</style>
