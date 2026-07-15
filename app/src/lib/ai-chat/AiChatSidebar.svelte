<script lang="ts">
  // AI Chat Sidebar — purely presentational (props in, callbacks out). It
  // renders whatever conversation the shell hands it and MUST NOT import the
  // AI Chat Service or the AiChatSession class: that seam is what lets the
  // deterministic mock be replaced by a real provider without touching this
  // component (issue #24 acceptance criterion).
  //
  // A3 (issue #25): while generating, the reply text streams in as
  // `inFlightContent`; this component shows it as a live assistant bubble until
  // the shell commits it as a real message. Errors offer a Retry. The message
  // viewport stays pinned to the bottom while the user is at the bottom, but
  // leaves them alone when they have scrolled up to read earlier turns.
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import type { AiChatContext, AiChatMessage, AiChatState } from "./types";

  type Props = {
    messages: AiChatMessage[];
    state: AiChatState;
    contexts: AiChatContext[];
    /** Error text shown in the "error" state. */
    errorMessage?: string;
    /** The reply text streamed so far; shown as a live bubble while generating. */
    inFlightContent?: string;
    /** Identifies the active Document Session; a change means a Document Tab
     * switch, so anchoring steps aside and lets the shell restore the scroll. */
    sessionKey?: string;
    /** Optional heading note. Deliberately generic — not a fixture flag. */
    subtitle?: string;
    /** Unsent composer draft; the shell owns where it is stored (per-document). */
    value?: string;
    /** The scrollable conversation element, exposed so the shell can capture/restore per-document scroll. */
    conversationEl?: HTMLDivElement | null;
    /** Called with the trimmed composer text on Send; absent = sending disabled (no document). */
    onSend?: (text: string) => void;
    /** Called on Stop while generating. */
    onStop?: () => void;
    /** Called on Retry from the error state. */
    onRetry?: () => void;
    /** Called when a page citation is activated, with its page number. */
    onNavigateToPage?: (page: number) => void;
  };
  let {
    messages,
    state: chatState,
    contexts,
    errorMessage,
    inFlightContent = "",
    sessionKey,
    subtitle,
    value = $bindable(""),
    conversationEl = $bindable(null),
    onSend,
    onStop,
    onRetry,
    onNavigateToPage,
  }: Props = $props();

  // The live streaming bubble reuses ChatMessage with a synthetic assistant
  // message. Its id is fixed and never collides with a committed turn.
  let inFlightMessage = $derived<AiChatMessage>({
    id: "assistant-in-flight",
    role: "assistant",
    content: inFlightContent,
  });

  // ---- Viewport anchoring (D9) ----
  // "Pinned" means the user is parked at (or very near) the bottom, so new
  // content should keep them there. Scrolling up un-pins; scrolling back down
  // re-pins. These are plain lets: they drive imperative scrolling, not markup.
  const NEAR_BOTTOM_PX = 32;
  let pinned = true;
  // Undefined until the first effect run records the current key; a change from
  // the recorded value means a Document Tab switch.
  let lastSessionKey: string | undefined;
  let sessionKeySeen = false;
  let lastUserTurnCount = 0;

  function nearBottom(element: HTMLDivElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX;
  }

  function onConversationScroll() {
    if (conversationEl) pinned = nearBottom(conversationEl);
  }

  // After any content change, keep the viewport pinned to the bottom if the
  // user is there. A brand-new user turn always re-pins (sending a message
  // reveals it). A Document Tab switch (sessionKey change) is left to the
  // shell's scroll restore.
  $effect(() => {
    // Track the values that grow the conversation so this runs on each change.
    void inFlightContent;
    void chatState;
    const userTurnCount = messages.filter((message) => message.role === "user").length;

    if (!conversationEl) {
      lastUserTurnCount = userTurnCount;
      return;
    }
    if (!sessionKeySeen || sessionKey !== lastSessionKey) {
      sessionKeySeen = true;
      lastSessionKey = sessionKey;
      lastUserTurnCount = userTurnCount;
      return;
    }
    if (userTurnCount > lastUserTurnCount) pinned = true;
    lastUserTurnCount = userTurnCount;
    if (pinned) conversationEl.scrollTop = conversationEl.scrollHeight;
  });
</script>

<div class="ai-chat-sidebar" aria-label="AI Chat">
  <div class="heading">
    <span>AI Chat</span>
    {#if subtitle}
      <span class="heading-note">{subtitle}</span>
    {/if}
  </div>
  <div class="conversation" aria-live="polite" bind:this={conversationEl} onscroll={onConversationScroll}>
    {#if chatState === "empty"}
      <div class="empty-state">
        <strong>Ask about this PDF</strong>
        <p>Write a message to begin.</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <ChatMessage {message} {onNavigateToPage} />
      {/each}
      {#if chatState === "generating" && inFlightContent}
        <ChatMessage message={inFlightMessage} />
      {/if}
    {/if}
    {#if chatState === "generating"}
      <p class="state-note" role="status">Generating response…</p>
    {:else if chatState === "error"}
      <div class="error-note" role="alert">
        <span>{errorMessage}</span>
        {#if onRetry}
          <button class="retry" type="button" onclick={() => onRetry?.()}>Retry</button>
        {/if}
      </div>
    {/if}
  </div>
  <ChatComposer {contexts} state={chatState} bind:value {onSend} {onStop} />
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border: 1px solid color-mix(in oklab, var(--danger), transparent 65%);
    color: var(--danger);
  }
  .retry {
    flex: 0 0 auto;
    padding: 4px 10px;
    border: 1px solid currentColor;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .retry:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
