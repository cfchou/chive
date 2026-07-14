<script lang="ts">
  import PageCitation from "./PageCitation.svelte";
  import type { AiChatMessage } from "./types";

  type Props = { message: AiChatMessage };
  let { message }: Props = $props();
</script>

<article class="message" class:user={message.role === "user"} aria-label={message.role === "user" ? "You" : "AI"}>
  <span class="author">{message.role === "user" ? "You" : "AI"}</span>
  <p>{message.content}</p>
  {#if message.citations?.length}
    <div class="citations" aria-label="Page citations">
      {#each message.citations as citation (citation.id)}
        <PageCitation page={citation.page} />
      {/each}
    </div>
  {/if}
</article>

<style>
  .message {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .message.user {
    margin-left: var(--space-6);
    background: var(--fg);
    color: var(--accent-on);
    border-color: var(--fg);
  }
  .author {
    font-size: var(--text-xs);
    font-weight: 700;
  }
  p {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: var(--text-sm);
    line-height: var(--leading-body);
  }
  .citations {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
