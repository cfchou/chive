import { numbersFromUnknown } from "./annotation-sidebar";

export type AnnotationColorName = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "rose";
export type HighlightColorName = AnnotationColorName | "pink";
export type FreeTextColorName = AnnotationColorName | "black" | "pink";
export type InkColorName = AnnotationColorName | "black" | "pink";
export type OutlinePaletteColorName = "default" | "red" | "orange" | "yellow" | "blue" | "purple";

export type PaletteOption<Name extends string> = {
  name: Name;
  label: string;
  color: string | null;
};

export type AnnotationPaletteOption = {
  name: AnnotationColorName;
  label: string;
  value: string;
  highlightValue: string;
};

export const annotationPalette: AnnotationPaletteOption[] = [
  { name: "red", label: "Red", value: "#d73337", highlightValue: "#ffb3b5" },
  { name: "orange", label: "Orange", value: "#e57600", highlightValue: "#ffd4a3" },
  { name: "yellow", label: "Yellow", value: "#f2cf3b", highlightValue: "#fff35c" },
  { name: "green", label: "Green", value: "#409d48", highlightValue: "#7cf2aa" },
  { name: "cyan", label: "Cyan", value: "#00aebe", highlightValue: "#9ceff5" },
  { name: "blue", label: "Blue", value: "#3280dd", highlightValue: "#8ecbff" },
  { name: "purple", label: "Purple", value: "#925ac9", highlightValue: "#d8bdff" },
  { name: "rose", label: "Rose", value: "#d456a5", highlightValue: "#ffb6de" },
];

export const highlightColors: Record<HighlightColorName, string> = {
  red: "#ffb3b5",
  orange: "#ffd4a3",
  yellow: "#fff35c",
  green: "#7cf2aa",
  cyan: "#9ceff5",
  blue: "#8ecbff",
  purple: "#d8bdff",
  rose: "#ffb6de",
  pink: "#ffb6de",
};

export const freeTextColors: Record<FreeTextColorName, string> = {
  black: "#1e2329",
  red: "#d73337",
  orange: "#e57600",
  yellow: "#f2cf3b",
  green: "#409d48",
  cyan: "#00aebe",
  blue: "#3280dd",
  purple: "#925ac9",
  rose: "#d456a5",
  pink: "#d456a5",
};

export const inkColors: Record<InkColorName, string> = {
  black: "#1e2329",
  red: "#d73337",
  orange: "#e57600",
  yellow: "#f2cf3b",
  green: "#409d48",
  cyan: "#00aebe",
  blue: "#3280dd",
  purple: "#925ac9",
  rose: "#d456a5",
  pink: "#d456a5",
};

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
