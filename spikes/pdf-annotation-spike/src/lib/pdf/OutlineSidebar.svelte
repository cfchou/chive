<script lang="ts">
  import { hexToRgba, outlinePalette } from "$lib/pdf/colors";
  import { isOutlineEntryNavigable, type OutlineEntry } from "$lib/pdf/outline-tree";

  type Props = {
    outlineEntries: OutlineEntry[];
    outlineStatus: string;
    outlineColorMenuId: string | null;
    isOutlineCollapsed: (id: string) => boolean;
    isActiveOutlineRow: (id: string) => boolean;
    toggleOutlineCollapsed: (id: string) => unknown;
    expandAllOutlineItems: () => unknown;
    collapseAllOutlineItems: () => unknown;
    goToOutlineEntry: (entry: OutlineEntry) => unknown;
    updateOutlineColor: (id: string, color: string | null) => unknown;
  };

  let {
    outlineEntries,
    outlineStatus,
    outlineColorMenuId = $bindable(),
    isOutlineCollapsed,
    isActiveOutlineRow,
    toggleOutlineCollapsed,
    expandAllOutlineItems,
    collapseAllOutlineItems,
    goToOutlineEntry,
    updateOutlineColor,
  }: Props = $props();

  function outlineColorStyle(color: string | null) {
    if (!color) return "--outline-color: transparent; --outline-bg-color: transparent; --outline-hover-bg-color: #edf4ff";
    return `--outline-color: ${color}; --outline-bg-color: ${hexToRgba(color, 0.16)}; --outline-hover-bg-color: ${hexToRgba(color, 0.24)}`;
  }
</script>

<div class="nav-content" role="tabpanel" aria-label="Outline">
  <div class="nav-heading">
    <span class="label">Outline</span>
    <span class="nav-heading-actions">
      <button
        type="button"
        class="nav-heading-icon"
        aria-label="Expand all outline items"
        title="Expand all outline items"
        disabled={outlineEntries.length === 0}
        onclick={expandAllOutlineItems}
      >
        <svg class="nav-heading-svg" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 5.5 10 9.5 14 5.5"></path>
          <path d="M6 10.5 10 14.5 14 10.5"></path>
        </svg>
      </button>
      <button
        type="button"
        class="nav-heading-icon"
        aria-label="Collapse all outline items"
        title="Collapse all outline items"
        disabled={outlineEntries.length === 0}
        onclick={collapseAllOutlineItems}
      >
        <svg class="nav-heading-svg" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 9.5 10 5.5 14 9.5"></path>
          <path d="M6 14.5 10 10.5 14 14.5"></path>
        </svg>
      </button>
      <span class="nav-heading-count">{outlineStatus}</span>
    </span>
  </div>
  {#if outlineEntries.length > 0}
    <ul class="outline-list">
      {@render outlineItems(outlineEntries)}
    </ul>
  {:else}
    <p class="empty-state">{outlineStatus}</p>
  {/if}
</div>

{#snippet outlineItems(entries: OutlineEntry[], depth = 0)}
  {#each entries as entry (entry.id)}
    {@const hasChildren = entry.items.length > 0}
    {@const collapsed = isOutlineCollapsed(entry.id)}
    <li class="outline-row">
      <div
        class="outline-row-main"
        class:outline-active={isActiveOutlineRow(entry.id)}
        class:outline-collapsed-row={hasChildren && collapsed}
        data-outline-id={entry.id}
        style={`${outlineColorStyle(entry.color)}; padding-left: ${12 + depth * 16}px`}
      >
        {#if hasChildren}
          <button
            type="button"
            class="outline-toggle"
            aria-label={`${collapsed ? "Expand" : "Collapse"} outline item ${entry.title}`}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} outline item ${entry.title}`}
            onclick={() => toggleOutlineCollapsed(entry.id)}
          >
            <span class:collapsed aria-hidden="true"></span>
          </button>
        {:else}
          <span class="outline-toggle-spacer" aria-hidden="true"></span>
        {/if}
        <button
          class="outline-item"
          onclick={(event) => {
            event.currentTarget.blur();
            void goToOutlineEntry(entry);
          }}
          disabled={!isOutlineEntryNavigable(entry)}
          title={entry.destinationStatus ? `${entry.title} - ${entry.destinationStatus}` : entry.title}
        >
          <span class="outline-title">{entry.title}</span>
          {#if entry.pageNumber}
            <span class="page-number">{entry.pageNumber}</span>
          {:else if entry.destinationStatus}
            <span class="page-number">{entry.destinationStatus}</span>
          {/if}
        </button>
        <button
          type="button"
          class="outline-color-button"
          style={`--outline-color: ${entry.color ?? "transparent"}`}
          aria-label={`Outline color ${entry.title}`}
          title={`Outline color ${entry.title}`}
          onclick={() => (outlineColorMenuId = outlineColorMenuId === entry.id ? null : entry.id)}
        >
          <span aria-hidden="true"></span>
        </button>
        {#if outlineColorMenuId === entry.id}
          <div class="outline-color-menu outline-color-menu-outline" role="menu" aria-label="Outline colors">
            {#each outlinePalette as option (option.name)}
              <button
                type="button"
                class="outline-color-option"
                style={`--outline-color: ${option.color ?? "transparent"}`}
                aria-label={`Set outline color ${option.label}`}
                title={`Set outline color ${option.label}`}
                onclick={() => updateOutlineColor(entry.id, option.color)}
              >
                <span aria-hidden="true"></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if hasChildren && !collapsed}
        <ul>
          {@render outlineItems(entry.items, depth + 1)}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}

<style>
  button {
    min-height: 34px;
    border: 1px solid #c8d0d9;
    border-radius: 6px;
    padding: 0 12px;
    color: #1e2329;
    background: #ffffff;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #6b8fce;
    background: #f3f7ff;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

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

  .nav-heading-actions {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
  }

  .nav-heading-count,
  .nav-heading > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-heading-icon {
    display: grid;
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    min-height: 0;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0;
    color: #5b6470;
    background: transparent;
  }

  .nav-heading-icon:hover:not(:disabled),
  .nav-heading-icon:focus-visible {
    border-color: #cfd6df;
    background: #ffffff;
  }

  .nav-heading-icon:disabled {
    color: #b5bdc8;
  }

  .nav-heading-svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .empty-state {
    margin: 0;
    padding: 16px 12px;
    color: #5b6470;
    font-size: 13px;
    line-height: 1.45;
  }

  .outline-list,
  .outline-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .outline-row {
    position: relative;
  }

  .outline-row-main {
    position: relative;
    display: grid;
    box-sizing: border-box;
    width: 100%;
    grid-template-columns: 20px minmax(0, 1fr) 34px 32px;
    align-items: stretch;
    min-width: 0;
    background: var(--outline-bg-color, transparent);
  }

  .outline-item {
    display: grid;
    box-sizing: border-box;
    grid-column: 2 / 4;
    width: 100%;
    min-width: 0;
    min-height: 34px;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 0;
    padding: 6px 0 6px 4px;
    text-align: left;
    background: transparent;
  }

  .outline-toggle,
  .outline-toggle-spacer {
    width: 20px;
    min-height: 34px;
  }

  .outline-toggle {
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: #7a8491;
    background: transparent;
  }

  .outline-toggle:hover,
  .outline-toggle:focus-visible {
    color: #2f3742;
    background: rgba(255, 255, 255, 0.5);
  }

  .outline-toggle span {
    width: 7px;
    height: 7px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg);
  }

  .outline-toggle span.collapsed {
    transform: rotate(-45deg);
  }

  .outline-color-button {
    position: static;
    grid-column: 4;
    align-self: center;
    justify-self: center;
    display: grid;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    min-height: 0;
    aspect-ratio: 1;
    place-items: center;
    appearance: none;
    border: 1px solid rgba(17, 24, 39, 0.26);
    border-radius: 50%;
    padding: 0;
    background: var(--outline-color, #ffffff);
    opacity: 0;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.82);
    line-height: 0;
  }

  .outline-row-main:hover > .outline-color-button,
  .outline-row-main:focus-within > .outline-color-button,
  .outline-color-button:focus-visible {
    opacity: 1;
  }

  .outline-color-button span {
    display: none;
  }

  .outline-color-menu-outline {
    top: 30px;
    right: 6px;
  }

  .outline-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .outline-row-main:hover {
    background: var(--outline-hover-bg-color, #edf4ff);
  }

  .outline-row-main.outline-active {
    box-shadow: inset 0 0 0 9999px rgba(47, 111, 203, 0.1);
  }

  .outline-color-menu {
    position: absolute;
    top: 24px;
    right: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(4, 18px);
    gap: 6px;
    border: 1px solid #c8d0da;
    padding: 8px;
    background: #ffffff;
    box-shadow: 0 6px 18px rgba(17, 24, 39, 0.18);
  }

  .outline-row-main .outline-color-menu-outline {
    top: 30px;
    right: 8px;
  }

  .outline-color-option {
    display: grid;
    width: 18px;
    height: 18px;
    min-height: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: transparent;
  }

  .outline-color-option span {
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    border: 1px solid #c8d0da;
    border-radius: 50%;
    background: var(--outline-color, transparent);
  }

  .outline-color-option:hover span,
  .outline-color-option:focus-visible span {
    box-shadow: 0 0 0 2px #d8e8ff;
  }

  .page-number {
    justify-self: end;
    color: #7a838f;
    font-size: 12px;
    white-space: nowrap;
  }
</style>
