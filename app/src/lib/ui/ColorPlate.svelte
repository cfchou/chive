<script lang="ts">
  import { annotationPalette, type AnnotationColorName } from "../pdf/colors";

  type Props = {
    anchor: DOMRect | null;
    activeName: AnnotationColorName | null;
    onChoose: (name: AnnotationColorName) => void;
    onClose: () => void;
  };

  let { anchor, activeName, onChoose, onClose }: Props = $props();

  // 8 chips of 18px + 7 gaps of 8px + 8px padding each side + 1px borders.
  const PLATE_WIDTH = 8 * 18 + 7 * 8 + 2 * 8 + 2;

  const position = $derived.by(() => {
    if (!anchor) return null;
    const left = Math.min(
      window.innerWidth - PLATE_WIDTH - 12,
      Math.max(12, anchor.left),
    );
    return { left, top: anchor.bottom + 6 };
  });

  let plateEl = $state<HTMLDivElement | null>(null);

  function handleWindowPointerDown(event: PointerEvent) {
    if (!anchor) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Mock behavior: clicking outside closes the plate, but interactions with
    // the plate itself or any header swatch (which may re-open it for another
    // slot) do not.
    if (plateEl?.contains(target) || target.closest(".swatch")) return;
    onClose();
  }
</script>

<svelte:window onpointerdowncapture={handleWindowPointerDown} onresize={onClose} />

{#if anchor && position}
  <div
    class="color-plate"
    role="dialog"
    aria-label="Annotation color plate"
    style={`top: ${position.top}px; left: ${position.left}px`}
    bind:this={plateEl}
  >
    {#each annotationPalette as entry (entry.name)}
      <button
        class="color-choice"
        type="button"
        aria-label={entry.label}
        title={entry.label}
        aria-pressed={entry.name === activeName}
        style={`--choice-color: ${entry.value}`}
        onclick={() => onChoose(entry.name)}
      ></button>
    {/each}
  </div>
{/if}

<style>
  .color-plate {
    position: fixed;
    z-index: 7;
    display: grid;
    grid-template-columns: repeat(8, 18px);
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--elev-raised);
  }
  .color-choice {
    width: 18px;
    height: 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--choice-color, transparent);
    cursor: pointer;
    padding: 0;
  }
  .color-choice[aria-pressed="true"],
  .color-choice:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-color: var(--fg);
  }
</style>
