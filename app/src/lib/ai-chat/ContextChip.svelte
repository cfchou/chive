<script lang="ts">
  type Props = { label: string; onRemove: () => void };
  let { label, onRemove }: Props = $props();
</script>

<button
  class="context-chip"
  type="button"
  aria-label={`Remove ${label} context; use whole document`}
  title={`Remove ${label} context`}
  onclick={onRemove}
>
  <span>{label}</span>
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"></path></svg>
</button>

<style>
  .context-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 28px;
    max-width: 100%;
    padding: 4px 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg-2);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .context-chip:hover,
  .context-chip:focus-visible {
    border-color: var(--fg);
    color: var(--fg);
    outline: none;
  }
  .context-chip:focus-visible {
    box-shadow: var(--focus-ring);
  }
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  svg {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.5;
  }
</style>
