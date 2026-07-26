const pdfjsInternalIdPrefix = "pdfjs_internal_id_";

export function pdfAnnotationElementId(sourceId: string) {
  return sourceId.startsWith(pdfjsInternalIdPrefix) ? sourceId : `${pdfjsInternalIdPrefix}${sourceId}`;
}

export function sourceIdFromPdfAnnotationElementId(elementId: string) {
  if (!elementId) return null;
  return elementId.startsWith(pdfjsInternalIdPrefix) ? elementId.slice(pdfjsInternalIdPrefix.length) : elementId;
}

export function persistedAnnotationKey(pageNumber: number, sourceId: string) {
  return `${pageNumber}:${sourceId}`;
}

export function persistedAnnotationKeyParts(key: string) {
  if (typeof key !== "string") return null;
  const separator = key.indexOf(":");
  if (separator < 0) return null;
  const pageNumber = Number(key.slice(0, separator));
  const sourceId = key.slice(separator + 1);
  return Number.isInteger(pageNumber) && pageNumber > 0 && sourceId ? { pageNumber, sourceId } : null;
}
