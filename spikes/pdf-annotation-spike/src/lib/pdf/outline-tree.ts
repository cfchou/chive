export type PdfDestination = string | unknown[] | null;

export type OutlineEntry = {
  id: string;
  title: string;
  dest: PdfDestination;
  url: string | null;
  pageNumber: number | null;
  targetY: number | null;
  pageHeight: number | null;
  color: string | null;
  colorDirty: boolean;
  destinationStatus: string | null;
  items: OutlineEntry[];
};

export function countOutlineEntries(entries: OutlineEntry[]): number {
  return entries.reduce((count, entry) => count + 1 + countOutlineEntries(entry.items), 0);
}

export function countUnavailableOutlineEntries(entries: OutlineEntry[]): number {
  return entries.reduce(
    (count, entry) =>
      count +
      (isOutlineEntryNavigable(entry) ? 0 : 1) +
      countUnavailableOutlineEntries(entry.items),
    0,
  );
}

export function isOutlineEntryNavigable(entry: OutlineEntry) {
  return Boolean(entry.url || (entry.dest && entry.pageNumber));
}

export function outlineDestinationStatus(dest: PdfDestination, url: string | null, pageNumber: number | null) {
  if (url) return "External link";
  if (!dest) return "No destination";
  if (!pageNumber) return "Destination unavailable";
  return null;
}

export function flattenOutlineEntries(entries: OutlineEntry[]): OutlineEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenOutlineEntries(entry.items)]);
}

export function outlinePathToEntry(entries: OutlineEntry[], id: string): OutlineEntry[] {
  for (const entry of entries) {
    if (entry.id === id) return [entry];
    const childPath = outlinePathToEntry(entry.items, id);
    if (childPath.length > 0) return [entry, ...childPath];
  }
  return [];
}

export function visibleActiveOutlineEntryId(
  entries: OutlineEntry[],
  activeId: string | null,
  isCollapsed: (id: string) => boolean,
) {
  if (!activeId) return null;
  const path = outlinePathToEntry(entries, activeId);
  if (path.length === 0) return null;
  for (let index = 0; index < path.length - 1; index += 1) {
    if (isCollapsed(path[index].id)) {
      return path[index].id;
    }
  }
  return path.at(-1)?.id ?? null;
}

export function explicitDestinationRef(dest: PdfDestination) {
  return Array.isArray(dest) ? dest[0] : null;
}

export function pdfRefString(ref: unknown) {
  if (typeof ref === "object" && ref !== null && "num" in ref) {
    const candidate = ref as { num: unknown; gen?: unknown };
    if (typeof candidate.num === "number") {
      return `${candidate.num} ${typeof candidate.gen === "number" ? candidate.gen : 0} R`;
    }
  }
  return null;
}

export function updateOutlineEntryColor(entries: OutlineEntry[], id: string, color: string | null): OutlineEntry[] {
  return entries.map((entry) =>
    entry.id === id
      ? { ...entry, color, colorDirty: true }
      : { ...entry, items: updateOutlineEntryColor(entry.items, id, color) },
  );
}
