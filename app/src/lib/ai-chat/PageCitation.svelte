<script lang="ts">
  // An AI Chat Page Citation. A3 (issue #25) makes it a real button so it is
  // keyboard-accessible for free (Tab to focus, Enter/Space to activate) and
  // navigates the PDF to the cited page. With no `onNavigate` it still renders
  // as a button but does nothing — a safe default for any caller that has no
  // navigation target.
  type Props = { page: number; onNavigate?: () => void };
  let { page, onNavigate }: Props = $props();
</script>

<button class="page-citation" type="button" aria-label={`Go to page ${page}`} onclick={() => onNavigate?.()}>
  Page {page}
</button>

<style>
  .page-citation {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg-2);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .page-citation:hover {
    border-color: var(--fg);
    color: var(--fg);
  }
  .page-citation:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
