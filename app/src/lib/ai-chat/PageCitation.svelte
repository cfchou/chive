<script lang="ts">
  type Props = { page: number };
  let { page }: Props = $props();
</script>

<span class="page-citation">Page {page}</span>

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
    font-size: var(--text-xs);
  }
</style>
