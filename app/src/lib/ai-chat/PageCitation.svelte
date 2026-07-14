<script lang="ts">
  type Props = { page: number };
  let { page }: Props = $props();
</script>

<button class="page-citation" type="button" aria-label={`Page ${page}`}>Page {page}</button>

<style>
  .page-citation {
    min-height: 28px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg-2);
    font-size: var(--text-xs);
  }
  .page-citation:hover,
  .page-citation:focus-visible {
    border-color: var(--fg);
    outline: none;
  }
  .page-citation:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
