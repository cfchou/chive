<script lang="ts">
  type Props = {
    label: string;
    onSave: () => void | Promise<void>;
    onDiscard: () => void | Promise<void>;
    onCancel: () => void;
  };

  let { label, onSave, onDiscard, onCancel }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void onSave();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="unsaved-backdrop" role="presentation">
  <div
    class="unsaved-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="unsaved-title"
    aria-describedby="unsaved-message"
    tabindex="-1"
  >
    <h2 id="unsaved-title">Unsaved changes</h2>
    <p id="unsaved-message">Do you want to save the changes made to '{label}'?</p>
    <div class="unsaved-actions">
      <button class="secondary" type="button" onclick={onCancel}>Cancel</button>
      <button class="secondary" type="button" onclick={onDiscard}>Don't Save</button>
      <button class="primary" type="button" onclick={onSave}>Save</button>
    </div>
  </div>
</div>

<style>
  .unsaved-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: var(--space-6);
    background: rgba(17, 17, 17, 0.28);
  }

  .unsaved-modal {
    width: min(420px, 100%);
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--elev-raised);
  }

  .unsaved-modal h2 {
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
  }

  .unsaved-modal p {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .unsaved-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .unsaved-actions button {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
  }

  .unsaved-actions button:hover {
    background: var(--surface-warm);
  }

  .unsaved-actions .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-on);
  }

  .unsaved-actions .primary:hover {
    background: var(--accent-hover);
  }

  .unsaved-actions button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
