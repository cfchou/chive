<script lang="ts">
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import type { AiChatFixture } from "./types";

  type Props = { fixture: AiChatFixture };
  let { fixture }: Props = $props();
  let composerValue = $state("");
</script>

<div class="ai-chat-sidebar" aria-label="AI Chat">
  <div class="heading">
    <span>AI Chat</span>
    <span class="fixture-label">Static example</span>
  </div>
  <div class="conversation" aria-live="polite">
    {#if fixture.state === "empty"}
      <div class="empty-state">
        <strong>Ask about this PDF</strong>
        <p>Use a suggested prompt or write a message to begin.</p>
      </div>
    {:else}
      {#each fixture.messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
    {/if}
    {#if fixture.state === "generating"}
      <p class="state-note" role="status">Generating example response…</p>
    {:else if fixture.state === "error"}
      <p class="error-note" role="alert">{fixture.errorMessage}</p>
    {/if}
  </div>
  <ChatComposer contexts={fixture.contexts} state={fixture.state} bind:value={composerValue} />
</div>

<style>
  .ai-chat-sidebar {
    display: flex;
    min-width: 0;
    min-height: 0;
    height: 100%;
    flex-direction: column;
    background: var(--bg);
  }
  .heading {
    display: flex;
    flex: 0 0 auto;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5) var(--space-2) var(--space-3);
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
  }
  .fixture-label {
    overflow: hidden;
    font-weight: 400;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }
  .conversation {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    overflow-x: hidden;
    overflow-y: auto;
  }
  .empty-state {
    display: grid;
    gap: var(--space-2);
    margin: auto 0;
    padding: var(--space-5);
    color: var(--muted);
    text-align: center;
    font-size: var(--text-sm);
  }
  .empty-state strong {
    color: var(--fg);
  }
  .state-note,
  .error-note {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .error-note {
    border: 1px solid color-mix(in oklab, var(--danger), transparent 65%);
    color: var(--danger);
  }
</style>
