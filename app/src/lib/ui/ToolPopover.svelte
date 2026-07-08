<script lang="ts">
  type Props = {
    tool: "text" | "ink" | null;
    anchor: DOMRect | null;
    fontSize: number;
    thickness: number;
    onFontSize: (value: number) => void;
    onThickness: (value: number) => void;
    onClose: () => void;
  };

  let { tool, anchor, fontSize, thickness, onFontSize, onThickness, onClose }: Props = $props();

  const POPOVER_WIDTH = 188;

  const position = $derived.by(() => {
    if (!anchor) return null;
    const left = Math.min(
      window.innerWidth - POPOVER_WIDTH - 12,
      Math.max(12, anchor.left + anchor.width / 2 - POPOVER_WIDTH / 2),
    );
    return { left, top: anchor.bottom + 8 };
  });

  let popoverEl = $state<HTMLDivElement | null>(null);

  function handleWindowPointerDown(event: PointerEvent) {
    if (!tool) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Mock behavior: the popover survives interactions with itself, the mode
    // buttons, and the color swatches/plate; anything else closes it.
    if (
      popoverEl?.contains(target) ||
      target.closest(".mode-btn, .swatch, .color-plate")
    ) {
      return;
    }
    onClose();
  }

  function handleInput(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (tool === "text") onFontSize(value);
    else if (tool === "ink") onThickness(value);
  }
</script>

<svelte:window onpointerdowncapture={handleWindowPointerDown} onresize={onClose} />

{#if tool && anchor && position}
  <div
    class="tool-popover"
    role="dialog"
    aria-label={tool === "text" ? "Free text settings" : "Ink settings"}
    style={`top: ${position.top}px; left: ${position.left}px`}
    bind:this={popoverEl}
  >
    <div class="tool-popover-head">
      <span>{tool === "text" ? "Font size" : "Thickness"}</span>
      <span class="tool-popover-value">{tool === "text" ? fontSize : thickness}px</span>
    </div>
    {#if tool === "text"}
      <input
        type="range"
        min="10"
        max="28"
        step="1"
        value={fontSize}
        aria-label="Free text font size"
        oninput={handleInput}
      />
    {:else}
      <input
        type="range"
        min="2"
        max="18"
        step="1"
        value={thickness}
        aria-label="Ink thickness"
        oninput={handleInput}
      />
    {/if}
  </div>
{/if}

<style>
  .tool-popover {
    position: fixed;
    z-index: 6;
    width: 188px;
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--elev-raised);
  }
  .tool-popover-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .tool-popover-value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tool-popover input[type="range"] {
    width: 100%;
    accent-color: var(--fg);
  }
</style>
