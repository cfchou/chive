<script lang="ts">
  let {
    open = false,
    label = "",
    onSave,
    onDiscard,
    onCancel,
  }: {
    open: boolean;
    label: string;
    onSave: () => void | Promise<void>;
    onDiscard: () => void | Promise<void>;
    onCancel: () => void | Promise<void>;
  } = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void onSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      void onCancel();
    }
  }
</script>

{#if open}
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Unsaved changes"
    onkeydown={handleKeydown}
    tabindex="-1"
  >
    <div class="modal-content">
      <p class="modal-text">
        Do you want to save the changes made to &lsquo;{label}&rsquo;?
      </p>
      <div class="modal-buttons">
        <button class="modal-btn modal-btn-secondary" onclick={onCancel}>Cancel</button>
        <button class="modal-btn modal-btn-secondary" onclick={onDiscard}>Don't Save</button>
        <button class="modal-btn modal-btn-primary" onclick={onSave}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }
  .modal-content {
    background: var(--surface, #fff);
    border-radius: 10px;
    padding: 20px 24px;
    min-width: 360px;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .modal-text {
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 20px 0;
    color: var(--text, #333);
  }
  .modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .modal-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--border, #ccc);
    font-size: 13px;
    cursor: pointer;
  }
  .modal-btn-secondary {
    background: transparent;
    color: var(--text, #333);
  }
  .modal-btn-secondary:hover {
    background: var(--bg, #f0f0f0);
  }
  .modal-btn-primary {
    background: var(--accent, #007aff);
    color: #fff;
    border-color: var(--accent, #007aff);
  }
  .modal-btn-primary:hover {
    opacity: 0.9;
  }
</style>
