<script lang="ts">
  // Dev-only test surface for the AI Chat Composer (issue #25 / A3).
  //
  // The real shell never renders AI Chat Context Chips yet (real PDF context is
  // post-M1), and A3 removed the old `?aiChatFixture=` door — so without this
  // page there would be no way to regression-test that context chips add to the
  // composer's initial height, that removing a chip returns to whole-document
  // mode, and that the one-third height cap / internal scrolling still hold.
  //
  // This mounts ChatComposer directly inside a fixed-size, panel-shaped column
  // (so the composer's `max-height: 33.333%` has a real reference height).
  // Playwright is its only consumer (it runs against `vite dev`, where `dev` is
  // true).
  //
  // `dev` is a build-time constant, so a production build compiles this whole
  // page body away to nothing. Be precise about what that does and does not
  // mean: SvelteKit still ships a route node for `/dev/composer-harness` and
  // still lists it in the route table — the page just renders empty. The point
  // of the guard is that no harness UI or markup reaches a shipped app, not
  // that the URL disappears. It branches no behavior in the real shell either
  // way.
  import { dev } from "$app/environment";
  import ChatComposer from "$lib/ai-chat/ChatComposer.svelte";
  import type { AiChatContext, AiChatState } from "$lib/ai-chat/types";

  const contexts: AiChatContext[] = [{ id: "current-page", label: "Current page" }];
  let value = $state("");
  let generating = $state(false);
  let composerState = $derived<AiChatState>(
    generating ? "generating" : value.trim() ? "completed" : "empty",
  );
</script>

{#if dev}
  <div class="harness" data-testid="composer-harness">
    <button type="button" data-testid="toggle-generating" onclick={() => (generating = !generating)}>
      Toggle generating (now: {generating ? "on" : "off"})
    </button>
    <div class="panel" data-testid="harness-panel">
      <div class="filler"></div>
      <ChatComposer {contexts} state={composerState} bind:value onSend={() => {}} onStop={() => (generating = false)} />
    </div>
  </div>
{/if}

<style>
  .harness {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }
  /* Panel-shaped like the real AI Chat Sidebar so the composer's one-third cap
     resolves against a definite height. */
  .panel {
    display: flex;
    flex-direction: column;
    width: 360px;
    height: 600px;
    border: 1px solid var(--border, #ccc);
    background: var(--bg, #fff);
  }
  .filler {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
