<script lang="ts">
  type Props = {
    message: string;
    showing: boolean;
  };

  let { message, showing }: Props = $props();
</script>

<div class="toast" class:is-showing={showing} role="status" aria-live="polite">{message}</div>

<style>
  .toast {
    position: fixed;
    right: var(--space-5);
    bottom: var(--space-5);
    z-index: 5;
    max-width: 320px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--elev-raised);
    font-size: var(--text-sm);
    opacity: 0;
    transform: translateY(var(--space-3));
    transition:
      opacity var(--motion-base) var(--ease-standard),
      transform var(--motion-base) var(--ease-standard);
    pointer-events: none;
  }
  .toast.is-showing {
    opacity: 1;
    transform: translateY(0);
  }
</style>
