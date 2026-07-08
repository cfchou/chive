export function firstWords(text: string, count: number) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ")
    .replace(/[,:;.!?]+$/, "");
}

export function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function itemCountLabel(count: number) {
  return countLabel(count, "item");
}

export function bookmarkCountLabel(count: number) {
  return countLabel(count, "bookmark");
}

export function annotationCountLabel(count: number) {
  return countLabel(count, "annotation");
}
