<script lang="ts">
  import type { BookmarkEntry } from "$lib/pdf/bookmarks";
  import { bookmarkPalette } from "$lib/pdf/colors";

  // Bookmark creation is rail-only (ui-spec): there is no sidebar add button.
  // The page keeps createBookmarkForCurrentPage for the rail and the debug API.
  type Props = {
    bookmarkEntries: BookmarkEntry[];
    bookmarkStatus: string;
    editingBookmarkId: string | null;
    hoveredBookmarkId: string | null;
    activeBookmarkId: string | null;
    bookmarkColorMenuId: string | null;
    bookmarkColorStyle: (entry: BookmarkEntry) => string;
    updateBookmarkTitle: (id: string, title: string) => unknown;
    handleBookmarkTitleKey: (event: KeyboardEvent) => unknown;
    goToBookmarkEntry: (entry: BookmarkEntry) => unknown;
    editBookmarkAndGoToEntry: (entry: BookmarkEntry) => unknown;
    updateBookmarkColor: (id: string, color: string | null) => unknown;
    deleteBookmark: (id: string) => unknown;
  };

  let {
    bookmarkEntries,
    bookmarkStatus,
    editingBookmarkId = $bindable(),
    hoveredBookmarkId = $bindable(),
    activeBookmarkId,
    bookmarkColorMenuId = $bindable(),
    bookmarkColorStyle,
    updateBookmarkTitle,
    handleBookmarkTitleKey,
    goToBookmarkEntry,
    editBookmarkAndGoToEntry,
    updateBookmarkColor,
    deleteBookmark,
  }: Props = $props();
</script>

<div class="nav-content" role="tabpanel" aria-label="Bookmarks">
  <div class="nav-heading">
    <span class="label">Bookmarks</span>
    <span class="nav-heading-actions">
      <span class="nav-heading-count">{bookmarkStatus}</span>
    </span>
  </div>
  {#if bookmarkEntries.length > 0}
    <ul class="bookmark-list">
      {#each bookmarkEntries as entry (entry.id)}
        <li>
          <div class="bookmark-row">
            {#if editingBookmarkId === entry.id}
              <div
                class="bookmark-item bookmark-item-editing"
                class:bookmark-hovered={hoveredBookmarkId === entry.id}
                class:bookmark-active={activeBookmarkId === entry.id}
                role="group"
                aria-label={`Editing bookmark ${entry.title}`}
                onmouseenter={() => (hoveredBookmarkId = entry.id)}
                onmouseleave={() => (hoveredBookmarkId = null)}
              >
                <button
                  type="button"
                  class="bookmark-color-button"
                  style={bookmarkColorStyle(entry)}
                  aria-label={`Bookmark color ${entry.title}`}
                  title={`Bookmark color ${entry.title}`}
                  onpointerdown={(event) => event.preventDefault()}
                  onclick={() => (bookmarkColorMenuId = bookmarkColorMenuId === entry.id ? null : entry.id)}
                >
                  <span class="bookmark-icon" aria-hidden="true"></span>
                </button>
                <input
                  aria-label="Bookmark title"
                  value={entry.title}
                  oninput={(event) => updateBookmarkTitle(entry.id, event.currentTarget.value)}
                  onkeydown={handleBookmarkTitleKey}
                  onblur={() => (editingBookmarkId = null)}
                />
              </div>
            {:else}
              <div
                class="bookmark-item"
                class:bookmark-hovered={hoveredBookmarkId === entry.id}
                class:bookmark-active={activeBookmarkId === entry.id}
                role="group"
                aria-label={`Bookmark ${entry.title}`}
                onmouseenter={() => (hoveredBookmarkId = entry.id)}
                onmouseleave={() => (hoveredBookmarkId = null)}
                title={`${entry.title} on page ${entry.pageNumber}`}
              >
                <button
                  type="button"
                  class="bookmark-color-button"
                  style={bookmarkColorStyle(entry)}
                  aria-label={`Bookmark color ${entry.title}`}
                  title={`Bookmark color ${entry.title}`}
                  onclick={() => (bookmarkColorMenuId = bookmarkColorMenuId === entry.id ? null : entry.id)}
                >
                  <span class="bookmark-icon" aria-hidden="true"></span>
                </button>
                <button
                  type="button"
                  class="bookmark-title-button"
                  onclick={() => void goToBookmarkEntry(entry)}
                  ondblclick={() => void editBookmarkAndGoToEntry(entry)}
                  aria-label={entry.title}
                  title={`${entry.title} on page ${entry.pageNumber}`}
                >
                  {entry.title}
                </button>
              </div>
            {/if}
            {#if bookmarkColorMenuId === entry.id}
              <div class="outline-color-menu bookmark-color-menu" role="menu" aria-label="Bookmark colors">
                {#each bookmarkPalette as option (option.name)}
                  <button
                    type="button"
                    class="outline-color-option"
                    style={`--outline-color: ${option.color ?? "transparent"}`}
                    aria-label={`Set bookmark color ${option.label}`}
                    title={`Set bookmark color ${option.label}`}
                    onpointerdown={(event) => event.preventDefault()}
                    onclick={() => updateBookmarkColor(entry.id, option.color)}
                  >
                    <span aria-hidden="true"></span>
                  </button>
                {/each}
              </div>
            {/if}
            <button
              class="bookmark-delete"
              onclick={() => deleteBookmark(entry.id)}
              aria-label={`Delete bookmark ${entry.title}`}
              title={`Delete bookmark ${entry.title}`}
            >
              ⊖
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-state">{bookmarkStatus}</p>
  {/if}
</div>

<style>
  button {
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
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
    padding: 12px 20px 8px 16px;
    color: var(--muted);
    font-size: var(--text-xs);
    border-bottom: 1px solid var(--border-soft);
  }

  .label {
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .nav-heading-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
    gap: 6px;
  }

  .nav-heading-count {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    margin: 0;
    padding: 16px;
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .bookmark-list {
    margin: 0;
    padding: 8px 0;
    list-style: none;
  }

  .bookmark-row {
    display: grid;
    position: relative;
    grid-template-columns: minmax(0, 1fr) 48px;
    align-items: stretch;
  }

  .bookmark-item {
    display: grid;
    width: 100%;
    min-height: 42px;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    border: 0;
    border-radius: 0;
    padding: 6px 10px 6px 16px;
    text-align: left;
    background: transparent;
  }

  .bookmark-item-editing {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .bookmark-item:hover:not(:disabled),
  .bookmark-item.bookmark-hovered,
  .bookmark-item.bookmark-active {
    background: color-mix(in oklab, var(--accent), transparent 92%);
  }

  .bookmark-delete {
    justify-self: center;
    align-self: center;
    width: 24px;
    height: 24px;
    min-height: 0;
    border: 0;
    border-radius: var(--radius-pill);
    padding: 0;
    color: var(--muted);
    background: transparent;
  }

  .bookmark-delete:hover:not(:disabled) {
    color: var(--danger);
    background: color-mix(in oklab, var(--danger), transparent 92%);
  }

  .bookmark-icon {
    width: 12px;
    height: 18px;
    background: var(--bookmark-color, #f04444);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 74%, 0 100%);
  }

  .bookmark-color-button {
    display: grid;
    width: 22px;
    height: 24px;
    min-height: 0;
    place-items: center;
    appearance: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
  }

  .bookmark-title-button {
    min-width: 0;
    min-height: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
    overflow: hidden;
    color: inherit;
    background: transparent;
    font: inherit;
    font-family: var(--font-display);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmark-item input {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 3px 5px;
    color: var(--fg);
    background: var(--surface);
    font: inherit;
  }

  .bookmark-item input:focus {
    outline: none;
    border-color: var(--fg);
    box-shadow: var(--focus-ring);
  }

  .outline-color-menu {
    position: absolute;
    top: 24px;
    right: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(6, 18px);
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 8px;
    background: var(--bg);
    box-shadow: var(--elev-raised);
  }

  .bookmark-color-menu {
    top: 28px;
    left: 6px;
    right: auto;
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
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--outline-color, transparent);
  }

  .outline-color-option:hover,
  .outline-color-option:focus-visible {
    background: var(--surface);
  }
</style>
