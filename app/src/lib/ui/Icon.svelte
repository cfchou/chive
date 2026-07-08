<script lang="ts">
  type IconName = "outline" | "bookmarks" | "annotations" | "highlight" | "text" | "ink";

  export let name: IconName;
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  {#if name === "outline"}
    <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />
  {:else if name === "bookmarks"}
    <path d="M7 4h10v16l-5-3-5 3z" />
  {:else if name === "annotations"}
    <path d="M4 20h5l10-10a3 3 0 0 0-5-5L4 15zM13 6l5 5" />
  {:else if name === "highlight"}
    <path d="M4 19h16" />
    <path d="M7 15l-2-2 8-8 4 4-8 8H7z" />
    <path d="M15 3l6 6" />
    <path d="M13 17l3 2" />
  {:else if name === "text"}
    <path d="M6 5h12" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
    <path d="M18 9v6" />
    <path d="M20 9v6" />
  {:else if name === "ink"}
    <path d="M4 18c3-7 6-7 8 0 2 5 5 2 8-7" />
    <path d="M15 5l4 4" />
    <path d="M16 4h4v4" />
  {/if}
</svg>

<style>
  svg {
    width: 18px;
    height: 18px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
