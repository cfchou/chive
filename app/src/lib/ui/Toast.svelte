<script lang="ts">
  export let message = "";
</script>

{#if message}
  <div class="toast" role="status" aria-live="polite">{message}</div>
{/if}

<style>
  .toast {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 10;
    max-width: 320px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--elev-raised);
    font-size: var(--text-sm);
  }
</style>
