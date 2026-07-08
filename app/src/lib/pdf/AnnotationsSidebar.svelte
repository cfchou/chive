<script lang="ts">
  import { itemCountLabel } from "$lib/format";
  import {
    groupAnnotationEntriesByPage,
    type AnnotationEntry,
  } from "$lib/pdf/annotation-sidebar";

  type Props = {
    annotationEntries: AnnotationEntry[];
    annotationStatus: string;
    selectedAnnotationEntryId: string | null;
    locateAnnotationEntry: (entry: AnnotationEntry) => unknown;
  };

  let {
    annotationEntries,
    annotationStatus,
    selectedAnnotationEntryId,
    locateAnnotationEntry,
  }: Props = $props();
</script>

<div class="nav-content" role="tabpanel" aria-label="Annotations">
  <div class="nav-heading">
    <span class="label">Annotations</span>
    <span>{annotationStatus}</span>
  </div>
  {#if annotationEntries.length > 0}
    <div class="annotation-list">
      {#each groupAnnotationEntriesByPage(annotationEntries) as group (group.page)}
        <section class="annotation-page-group" aria-label={`Page ${group.page} annotations`}>
          <div class="annotation-page-header">
            <span>Page {group.page}</span>
            <span>{itemCountLabel(group.entries.length)}</span>
          </div>
          <ul>
            {#each group.entries as entry (entry.id)}
              <li>
                <button
                  id={`annotation-row-${entry.sourceId}`}
                  class="annotation-item"
                  class:active={selectedAnnotationEntryId === entry.id}
                  data-entry-id={entry.id}
                  data-source-id={entry.sourceId}
                  onclick={() => void locateAnnotationEntry(entry)}
                  title={`${entry.label} on page ${entry.page}`}
                >
                  <span class="annotation-kind">{entry.label}</span>
                  <span class="annotation-detail">{entry.detail}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {:else}
    <p class="empty-state">{annotationStatus}</p>
  {/if}
</div>

<style>
  .nav-content {
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .nav-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px 8px 12px;
    color: #5b6470;
    font-size: 12px;
  }

  .label {
    color: #5b6470;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .nav-heading > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    margin: 0;
    padding: 16px 12px;
    color: #5b6470;
    font-size: 13px;
    line-height: 1.45;
  }

  .annotation-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .annotation-list {
    display: flex;
    flex-direction: column;
  }

  .annotation-page-group + .annotation-page-group {
    border-top: 1px solid #d8dde5;
  }

  .annotation-page-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px 8px;
    color: #2f3742;
    background: #f3f5f8;
    border-bottom: 1px solid #d8dde5;
    font-size: 12px;
  }

  .annotation-page-header span:last-child {
    color: #8a929c;
  }

  .annotation-item {
    display: grid;
    width: 100%;
    min-height: 34px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 0;
    padding: 10px 12px;
    color: #1e2329;
    text-align: left;
    background: transparent;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .annotation-item:hover:not(:disabled) {
    background: var(--outline-hover-bg-color, #edf4ff);
  }

  .annotation-item.active {
    color: #1e2329;
    background: #e5f0ff;
  }

  .annotation-kind {
    font-weight: 700;
  }

  .annotation-detail {
    grid-column: 1 / -1;
    min-width: 0;
    overflow: hidden;
    color: #7a838f;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
