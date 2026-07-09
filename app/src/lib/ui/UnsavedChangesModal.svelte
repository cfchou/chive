<script lang="ts">
  // Save / Don't Save / Cancel prompt shown when closing a Document Tab (or the
  // window) with unsaved changes. In-app (not native) so it works identically in
  // the browser build and is drivable in e2e. Enter = Save, Esc = Cancel.
  type Props = {
    label: string;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  };
  let { label, onSave, onDiscard, onCancel }: Props = $props();

  let saveButton = $state<HTMLButtonElement | null>(null);
  $effect(() => saveButton?.focus());

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop">
  <div class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="unsaved-title">
    <h2 id="unsaved-title">Save changes?</h2>
    <p>Do you want to save the changes made to “{label}”?</p>
    <div class="modal-actions">
      <button class="btn primary" type="button" data-modal-save bind:this={saveButton} onclick={onSave}>
        Save
      </button>
      <button class="btn" type="button" data-modal-discard onclick={onDiscard}>Don't Save</button>
      <button class="btn" type="button" data-modal-cancel onclick={onCancel}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, #000, transparent 55%);
  }
  .modal {
    min-width: 320px;
    max-width: 420px;
    padding: var(--space-5);
    border-radius: var(--radius-lg, 12px);
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }
  .modal h2 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-display);
    font-size: var(--text-lg, 1.1rem);
  }
  .modal p {
    margin: 0 0 var(--space-5);
    color: var(--muted);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #2563eb);
    border-color: transparent;
    color: #fff;
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
