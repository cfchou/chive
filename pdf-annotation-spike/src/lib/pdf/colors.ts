import { numbersFromUnknown } from "./annotation-sidebar";

export type HighlightColorName = "yellow" | "green" | "blue" | "pink";
export type FreeTextColorName = "black" | "green" | "blue" | "pink";
export type InkColorName = "black" | "red" | "yellow" | "blue" | "pink";
export type OutlinePaletteColorName = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export type PaletteOption<Name extends string> = {
  name: Name;
  label: string;
  color: string | null;
};

export const highlightColors: Record<HighlightColorName, string> = {
  yellow: "#fff35c",
  green: "#7cf2aa",
  blue: "#8ecbff",
  pink: "#ffb6de",
};

export const freeTextColors: Record<FreeTextColorName, string> = {
  black: "#1e2329",
  green: "#4f7a29",
  blue: "#2f6ecb",
  pink: "#b82f76",
};

export const inkColors: Record<InkColorName, string> = {
  black: "#1e2329",
  red: "#e32400",
  yellow: "#fff35c",
  blue: "#2f6ecb",
  pink: "#b82f76",
};

export const outlinePalette: PaletteOption<OutlinePaletteColorName>[] = [
  { name: "default", label: "default", color: null },
  { name: "red", label: "red", color: "#f04444" },
  { name: "orange", label: "orange", color: "#f97316" },
  { name: "yellow", label: "yellow", color: "#eab308" },
  { name: "green", label: "green", color: "#22c55e" },
  { name: "blue", label: "blue", color: "#3b82f6" },
  { name: "purple", label: "purple", color: "#a855f7" },
];

export const bookmarkPalette = [
  { name: "pink", label: "pink", color: "#ec4899" },
  ...outlinePalette.filter((option) => option.color !== null),
];

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
