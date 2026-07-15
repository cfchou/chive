<script lang="ts">
  import ContextChip from "./ContextChip.svelte";
  import type { AiChatContext, AiChatState } from "./types";

  type Props = {
    contexts: AiChatContext[];
    state: AiChatState;
    value?: string;
    /** Called with the trimmed text on Send. Absent = Send cannot submit (no
     * Active Document Tab), so the button shows as disabled. */
    onSend?: (text: string) => void;
    /** Called on Stop while generating; absent = Stop is inert. */
    onStop?: () => void;
  };

  let { contexts, state: generationState, value = $bindable(""), onSend, onStop }: Props = $props();
  let textarea: HTMLTextAreaElement;
  let dismissedContextIds = $state<string[]>([]);
  let visibleContexts = $derived(contexts.filter((context) => !dismissedContextIds.includes(context.id)));

  function resizeTextarea() {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  // `oninput` only fires for user typing; the height must also follow
  // programmatic value changes (the shell clears the draft after an accepted
  // send and swaps drafts on Document Tab switches).
  $effect(() => {
    void value;
    if (textarea) resizeTextarea();
  });

  function removeContext(id: string) {
    dismissedContextIds = [...dismissedContextIds, id];
  }

  // Whether the trailing button is showing Stop right now.
  let isGenerating = $derived(generationState === "generating");
  // Send can submit only when there's a handler (an Active Document Tab) AND
  // non-empty trimmed text. This is what disables Send at `/` with no document
  // even after typing, and on an empty composer.
  let canSubmit = $derived(Boolean(onSend) && value.trim().length > 0);

  // Enter is NOT send (explicit newlines grow the composer, per issue #22);
  // sending is this button only. While generating the same button means Stop.
  function primaryAction() {
    if (isGenerating) {
      onStop?.();
      return;
    }
    if (!canSubmit) return;
    onSend?.(value.trim());
  }
</script>

<div class="composer" aria-label="AI Chat composer">
  {#if visibleContexts.length}
    <div class="contexts" aria-label="Message context">
      {#each visibleContexts as context (context.id)}
        <ContextChip label={context.label} onRemove={() => removeContext(context.id)} />
      {/each}
    </div>
  {/if}
  <div class="input-row">
    <textarea
      bind:this={textarea}
      bind:value
      rows="2"
      aria-label="Message AI Chat"
      placeholder="Ask about this PDF"
      oninput={resizeTextarea}
    ></textarea>
  </div>
  <div class="composer-actions" aria-label="Composer actions">
    <div class="configuration" aria-label="AI configuration">
      <button class="configuration-chip" type="button" aria-label="Change provider: OpenAI" title="Provider: OpenAI">
        <span class="configuration-chip-label">OpenAI</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"></path></svg>
      </button>
      <button class="configuration-chip" type="button" aria-label="Change model: GPT-5" title="Model: GPT-5">
        <span class="configuration-chip-label">GPT-5</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"></path></svg>
      </button>
      <button class="configuration-chip" type="button" aria-label="Change effort: Medium" title="Effort: Medium">
        <span class="configuration-chip-label">Medium</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"></path></svg>
      </button>
    </div>
    <div class="message-actions" aria-label="Message actions">
      <button class="secondary-action" type="button" aria-label="Add files" title="Add files">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
      </button>
      <button
        class="primary-action"
        type="button"
        aria-label={isGenerating ? "Stop generating" : "Send message"}
        title={isGenerating ? "Stop generating" : "Send message"}
        disabled={!isGenerating && !canSubmit}
        onclick={primaryAction}
      >
        {#if isGenerating}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10"></rect></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 33.333%;
    min-height: 0;
    margin: 0 var(--space-2) var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
    box-shadow: var(--elev-ring);
  }
  .contexts {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
  }
  .input-row {
    display: flex;
    min-height: 0;
  }
  textarea {
    display: block;
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: calc(2 * 1.45em);
    max-height: 100%;
    padding: 0;
    resize: none;
    overflow-y: auto;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.45;
  }
  textarea::placeholder {
    color: var(--muted);
  }
  .composer-actions {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-1);
  }
  .configuration,
  .message-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .configuration {
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .configuration::-webkit-scrollbar {
    display: none;
  }
  .configuration-chip {
    display: inline-flex;
    flex: 0 0 72px;
    width: 72px;
    height: 26px;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg-2);
    font: inherit;
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .configuration-chip-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .configuration-chip:hover,
  .configuration-chip:focus-visible,
  .secondary-action:hover,
  .secondary-action:focus-visible {
    border-color: var(--fg);
    color: var(--fg);
    outline: none;
  }
  .configuration-chip:focus-visible,
  .secondary-action:focus-visible,
  .primary-action:focus-visible {
    box-shadow: var(--focus-ring);
  }
  .configuration-chip svg {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }
  .secondary-action,
  .primary-action {
    display: grid;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: var(--radius-pill);
  }
  .secondary-action {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg-2);
  }
  .primary-action {
    border: 0;
    background: var(--accent);
    color: var(--accent-on);
  }
  .primary-action:hover,
  .primary-action:focus-visible {
    background: var(--accent-hover);
    outline: none;
  }
  .primary-action:active {
    background: var(--accent-active);
  }
  .primary-action:disabled {
    background: var(--accent);
    opacity: 0.4;
    cursor: default;
  }
  .secondary-action svg,
  .primary-action svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }
  .primary-action rect {
    fill: currentColor;
    stroke: none;
  }
</style>
