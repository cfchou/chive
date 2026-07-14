<script lang="ts">
  // AI Chat Sidebar — purely presentational (props in, callbacks out). It
  // renders whatever conversation the shell hands it and MUST NOT import the
  // AI Chat Service or the AiChatSession class: that seam is what lets the
  // deterministic mock be replaced by a real provider without touching this
  // component (issue #24 acceptance criterion).
  //
  // The shell drives it in two modes:
  //   - real mode: the active Document Session's AI Chat Session state, with
  //     `onSend` wired and no `subtitle`;
  //   - fixture mode (test-only `?aiChatFixture=` backstage door, removed in
  //     A3): a static AiChatFixture spread into the same props, with
  //     subtitle="Static example" and no `onSend`.
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import type { AiChatContext, AiChatMessage, AiChatState } from "./types";

  type Props = {
    messages: AiChatMessage[];
    state: AiChatState;
    contexts: AiChatContext[];
    /** Error text for the "error" state (fixture-only until A3 makes errors real). */
    errorMessage?: string;
    /** Optional heading note. Deliberately generic — not a fixture flag — so the component stays fixture-unaware. */
    subtitle?: string;
    /** Unsent composer draft; the shell owns where it is stored (per-document). */
    value?: string;
    /** The scrollable conversation element, exposed so the shell can capture/restore per-document scroll. */
    conversationEl?: HTMLDivElement | null;
    /** Called with the trimmed composer text on Send; absent = sending disabled (fixture mode, or no document). */
    onSend?: (text: string) => void;
  };
  let {
    messages,
    state: chatState,
    contexts,
    errorMessage,
    subtitle,
    value = $bindable(""),
    conversationEl = $bindable(null),
    onSend,
  }: Props = $props();
</script>

<div class="ai-chat-sidebar" aria-label="AI Chat">
  <div class="heading">
    <span>AI Chat</span>
    {#if subtitle}
      <span class="heading-note">{subtitle}</span>
    {/if}
  </div>
  <div class="conversation" aria-live="polite" bind:this={conversationEl}>
    {#if chatState === "empty"}
      <div class="empty-state">
        <strong>Ask about this PDF</strong>
        <p>Write a message to begin.</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
    {/if}
    {#if chatState === "generating"}
      <p class="state-note" role="status">Generating example response…</p>
    {:else if chatState === "error"}
      <p class="error-note" role="alert">{errorMessage}</p>
    {/if}
  </div>
  <ChatComposer {contexts} state={chatState} bind:value {onSend} />
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
  .heading-note {
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
