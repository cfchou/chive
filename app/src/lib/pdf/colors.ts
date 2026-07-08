import { numbersFromUnknown } from "./annotation-sidebar";

// One global annotation palette (ui-spec): the header shows five swatch slots,
// and a long-press color plate offers all eight. Every entry carries two
// values: `value` is the saturated color used for free text, ink strokes, and
// the swatch chips; `highlightValue` is a pastel used for highlights and
// highlighter-intent ink (dark saturated fills over text are unreadable under
// multiply blending). The yellow/green/blue/rose pastels are the spike's
// original highlight hexes so persisted-color regression pins stay
// byte-identical.
export type AnnotationColorName =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "rose";
export type HighlightColorName = AnnotationColorName;
export type FreeTextColorName = AnnotationColorName;
export type InkColorName = AnnotationColorName;
export type OutlinePaletteColorName = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export type PaletteOption<Name extends string> = {
  name: Name;
  label: string;
  color: string | null;
};

export type AnnotationPaletteEntry = {
  name: AnnotationColorName;
  label: string;
  value: string;
  highlightValue: string;
};

export const annotationPalette: AnnotationPaletteEntry[] = [
  { name: "red", label: "Red", value: "#d73337", highlightValue: "#ffb3ab" },
  { name: "orange", label: "Orange", value: "#e57600", highlightValue: "#ffd1a1" },
  { name: "yellow", label: "Yellow", value: "#f2cf3b", highlightValue: "#fff35c" },
  { name: "green", label: "Green", value: "#409d48", highlightValue: "#7cf2aa" },
  { name: "cyan", label: "Cyan", value: "#00aebe", highlightValue: "#a5ecf2" },
  { name: "blue", label: "Blue", value: "#3280dd", highlightValue: "#8ecbff" },
  { name: "purple", label: "Purple", value: "#925ac9", highlightValue: "#d7bfff" },
  { name: "rose", label: "Rose", value: "#d456a5", highlightValue: "#ffb6de" },
];

// The five swatch slots the header starts with (ui-spec); the plate can
// rewrite any slot to any palette entry.
export const defaultHeaderColorNames: AnnotationColorName[] = [
  "red",
  "yellow",
  "green",
  "blue",
  "purple",
];

export function annotationPaletteEntry(name: AnnotationColorName): AnnotationPaletteEntry {
  const entry = annotationPalette.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Unknown annotation color: ${name}`);
  return entry;
}

const annotationValueByName = Object.fromEntries(
  annotationPalette.map((entry) => [entry.name, entry.value]),
) as Record<AnnotationColorName, string>;
const annotationHighlightValueByName = Object.fromEntries(
  annotationPalette.map((entry) => [entry.name, entry.highlightValue]),
) as Record<AnnotationColorName, string>;

export const highlightColors: Record<HighlightColorName, string> = annotationHighlightValueByName;

export const freeTextColors: Record<FreeTextColorName, string> = annotationValueByName;

export const inkColors: Record<InkColorName, string> = annotationValueByName;

export function annotationColorNameForValue(color: string | null): AnnotationColorName | null {
  return colorNameForValue(annotationValueByName, color) ?? colorNameForValue(annotationHighlightValueByName, color);
}

// Shared row palette (ui-spec): outline rows and bookmark rows use the same
// choices — no-color plus red/orange/yellow/blue/purple. Stored values stay
// saturated (they become native PDF /C colors readable in other viewers);
// rows render them as tints.
export const outlinePalette: PaletteOption<OutlinePaletteColorName>[] = [
  { name: "default", label: "default", color: null },
  { name: "red", label: "red", color: "#f04444" },
  { name: "orange", label: "orange", color: "#f97316" },
  { name: "yellow", label: "yellow", color: "#eab308" },
  { name: "blue", label: "blue", color: "#3b82f6" },
  { name: "purple", label: "purple", color: "#a855f7" },
];

export const bookmarkPalette = outlinePalette;

export const defaultBookmarkColor = "#f04444";

export function colorNameForValue<Name extends string>(
  palette: Record<Name, string>,
  color: string | null,
): Name | null {
  if (!color) return null;
  const normalized = color.toLowerCase();
  for (const [name, value] of Object.entries(palette) as [Name, string][]) {
    if (value === normalized) {
      return name;
    }
  }
  return null;
}

export function highlightColorNameForValue(color: string | null) {
  return colorNameForValue(highlightColors, color);
}

export function freeTextColorNameForValue(color: string | null) {
  return colorNameForValue(freeTextColors, color);
}

export function inkColorNameForValue(color: string | null) {
  return colorNameForValue(inkColors, color);
}

export function hexToRgba(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return "transparent";
  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function normalizeOutlineColor(color: Uint8ClampedArray | number[] | undefined) {
  const components = numbersFromUnknown(color);
  if (!components || components.length < 3) return null;
  const rgb = components.slice(0, 3).map((component) => Math.max(0, Math.min(255, Math.round(component))));
  if (rgb.every((component) => component === 0)) return null;
  return `#${rgb.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
}
