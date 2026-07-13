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

  let dialog = $state<HTMLDialogElement | null>(null);
  $effect(() => {
    const modal = dialog;
    if (!modal) return;
    if (!modal.open) modal.showModal();
    return () => {
      if (modal.open) modal.close();
    };
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    }
  }

  function handleDialogCancel(event: Event) {
    event.preventDefault();
    onCancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<dialog
  class="modal"
  bind:this={dialog}
  aria-modal="true"
  aria-labelledby="unsaved-title"
  aria-describedby="unsaved-message"
  oncancel={handleDialogCancel}
>
  <h2 id="unsaved-title">Save changes?</h2>
  <p id="unsaved-message">Do you want to save the changes made to “{label}”?</p>
  <div class="modal-actions">
    <!-- svelte-ignore a11y_autofocus -->
    <button class="btn primary" type="button" data-modal-save autofocus onclick={onSave}>Save</button>
    <button class="btn" type="button" data-modal-discard onclick={onDiscard}>Don't Save</button>
    <button class="btn" type="button" data-modal-cancel onclick={onCancel}>Cancel</button>
  </div>
</dialog>

<style>
  .modal {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: min(420px, calc(100vw - 2 * var(--space-5)));
    max-width: calc(100vw - 2 * var(--space-5));
    margin: auto;
    padding: var(--space-5);
    border-radius: var(--radius-lg, 12px);
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: var(--elev-raised);
  }
  .modal::backdrop {
    background: color-mix(in oklab, #000, transparent 55%);
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
    background: var(--accent);
    border-color: transparent;
    color: var(--accent-on);
  }
  .btn.primary:hover {
    background: var(--accent-hover);
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
