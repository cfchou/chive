<script lang="ts">
  import type { AnnotationColorName, AnnotationPaletteEntry } from "../pdf/colors";
  import type { EditorTool } from "../pdf/pdfjs-quirks";

  type ToolId = Exclude<EditorTool, "none">;

  type Props = {
    canAnnotate: boolean;
    activeTool: EditorTool;
    headerColors: AnnotationPaletteEntry[];
    selectedColorName: AnnotationColorName | null;
    onToggleTool: (tool: ToolId, event: PointerEvent) => void;
    onSelectColor: (name: AnnotationColorName) => void;
    onOpenPlate: (slotIndex: number, anchor: HTMLElement) => void;
  };

  let {
    canAnnotate,
    activeTool,
    headerColors,
    selectedColorName,
    onToggleTool,
    onSelectColor,
    onOpenPlate,
  }: Props = $props();

  const LONG_PRESS_MS = 480;

  const tools: { tool: ToolId; label: string; icon: string }[] = [
    {
      tool: "highlight",
      label: "Highlight",
      icon: "M4 19h16 M7 15l-2-2 8-8 4 4-8 8H7z M15 3l6 6 M13 17l3 2",
    },
    {
      tool: "text",
      label: "Free text",
      icon: "M6 5h12 M12 5v14 M9 19h6 M18 9v6 M20 9v6",
    },
    {
      tool: "ink",
      label: "Ink",
      icon: "M4 18c3-7 6-7 8 0 2 5 5 2 8-7 M15 5l4 4 M16 4h4v4",
    },
  ];

  // Long-press (or right-click) on a swatch opens the color plate for that
  // slot; a plain click selects the slot's color (mock behavior).
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;

  function handleSwatchPointerDown(index: number, event: PointerEvent) {
    if (event.button !== 0) return;
    longPressed = false;
    clearTimeout(pressTimer);
    const anchor = event.currentTarget as HTMLElement;
    pressTimer = setTimeout(() => {
      longPressed = true;
      onOpenPlate(index, anchor);
    }, LONG_PRESS_MS);
  }

  function cancelSwatchPress() {
    clearTimeout(pressTimer);
  }

  function handleSwatchContextMenu(index: number, event: MouseEvent) {
    event.preventDefault();
    clearTimeout(pressTimer);
    longPressed = true;
    onOpenPlate(index, event.currentTarget as HTMLElement);
  }

  function handleSwatchClick(entry: AnnotationPaletteEntry) {
    if (longPressed) {
      longPressed = false;
      return;
    }
    onSelectColor(entry.name);
  }
</script>

<div class="toolbar-group" aria-label="Annotation mode">
  {#each tools as toolOption (toolOption.tool)}
    <button
      class="mode-btn"
      type="button"
      aria-pressed={activeTool === toolOption.tool}
      aria-label={toolOption.label}
      title={toolOption.label}
      disabled={!canAnnotate}
      onpointerdown={(event) => onToggleTool(toolOption.tool, event)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={toolOption.icon}></path>
      </svg>
    </button>
  {/each}
</div>
<div class="toolbar-group" role="radiogroup" aria-label="Annotation color">
  {#each headerColors as entry, index (index)}
    <button
      class="swatch"
      type="button"
      role="radio"
      aria-checked={selectedColorName === entry.name}
      aria-label={entry.label}
      title={entry.label}
      disabled={!canAnnotate}
      style={`--swatch-color: ${entry.value}`}
      onpointerdown={(event) => handleSwatchPointerDown(index, event)}
      onpointerup={cancelSwatchPress}
      onpointercancel={cancelSwatchPress}
      onpointerleave={cancelSwatchPress}
      oncontextmenu={(event) => handleSwatchContextMenu(index, event)}
      onclick={() => handleSwatchClick(entry)}
    ></button>
  {/each}
</div>

<style>
  .toolbar-group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding-right: var(--space-2);
    border-right: 1px solid var(--border);
  }
  .mode-btn {
    display: inline-flex;
    width: 34px;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg-2);
    transition:
      background var(--motion-fast) var(--ease-standard),
      border-color var(--motion-fast) var(--ease-standard);
  }
  .mode-btn svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .mode-btn:hover:not(:disabled) {
    border-color: var(--fg);
  }
  .mode-btn:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
  .mode-btn[aria-pressed="true"] {
    background: var(--fg);
    color: var(--accent-on);
    border-color: var(--fg);
  }
  .mode-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .swatch {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--swatch-color, var(--surface-warm));
    cursor: pointer;
    padding: 0;
    touch-action: none;
  }
  .swatch:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
  .swatch[aria-checked="true"] {
    box-shadow: var(--focus-ring);
    border-color: var(--fg);
  }
  .swatch:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
