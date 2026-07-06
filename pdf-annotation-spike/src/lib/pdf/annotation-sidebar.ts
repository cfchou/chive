export type AnnotationKind = "highlight" | "freetext" | "ink";

export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PdfAnnotationRaw = Record<string, unknown> & {
  rect?: unknown;
  quadPoints?: unknown;
  subtype?: string;
  it?: string | null;
  id?: string;
};

export type AnnotationEntry = {
  id: string;
  sourceId: string;
  source: "live" | "pdf";
  page: number;
  kind: AnnotationKind;
  label: string;
  detail: string;
  color: string | number[] | null;
  intent?: string | null;
  bounds: RectLike | null;
  targetIndex: number;
  sortTop: number;
  sortLeft: number;
};

type PdfDocumentWithPages = {
  getPage: (pageNumber: number) => Promise<{
    getTextContent?: () => Promise<{ items: Record<string, unknown>[] }>;
    streamTextContent?: () => {
      getReader: () => {
        read: () => Promise<{ done?: boolean; value?: { items?: Record<string, unknown>[] } }>;
      };
    };
    getViewport: (options: { scale: number }) => {
      width?: number;
      height: number;
      transform: number[];
      convertToViewportRectangle: (rect: number[]) => number[];
      convertToViewportPoint?: (x: number, y: number) => number[];
    };
  }>;
};

export function annotationKindForSubtype(subtype: unknown): AnnotationKind | null {
  if (subtype === "Highlight") return "highlight";
  if (subtype === "FreeText") return "freetext";
  if (subtype === "Ink") return "ink";
  return null;
}

export function annotationLabel(kind: AnnotationKind) {
  if (kind === "freetext") return "Free text";
  return kind[0].toUpperCase() + kind.slice(1);
}

export function annotationDetail(annotation: Record<string, unknown>) {
  const text = annotation.textContent;
  if (Array.isArray(text)) {
    return text.join(" ").trim() || "Persisted PDF annotation";
  }
  const contents = annotation.contentsObj;
  if (contents && typeof contents === "object" && "str" in contents) {
    return String((contents as { str?: unknown }).str ?? "").trim() || "Persisted PDF annotation";
  }
  return "Persisted PDF annotation";
}

export async function textForPdfAnnotation(
  pdfDocument: PdfDocumentWithPages | null,
  pageNumber: number,
  annotation: PdfAnnotationRaw,
) {
  const rect = numbersFromUnknown(annotation.rect);
  if (!pdfDocument || rect.length < 4) {
    return "";
  }
  try {
    const page = await pdfDocument.getPage(pageNumber);
    if (!page.getTextContent) {
      return "";
    }
    const viewport = page.getViewport({ scale: 1 });
    const annotationRects = annotationViewportRects(annotation, viewport);
    const rawItems = await getPageTextItems(page as Parameters<typeof getPageTextItems>[0]);
    const chunks = rawItems
      .map((rawItem, index) => {
        const item = rawItem as Record<string, unknown>;
        const text = String(item.str ?? "");
        const transform = numbersFromUnknown(item.transform);
        if (!text.trim() || transform.length < 6) return null;
        const tx = transformMatrix(viewport.transform, transform as number[]);
        const width = Number(item.width ?? 0);
        const height = Number(item.height ?? 0);
        const itemLeft = tx[4];
        const itemTop = tx[5] - height;
        const itemRight = itemLeft + width;
        const itemBottom = tx[5];
        const itemRect = { left: itemLeft, top: itemTop, right: itemRight, bottom: itemBottom };
        if (!annotationRects.some((annotationRect) => rectLikesOverlap(annotationRect, itemRect, 2))) {
          return null;
        }
        const selectedText = textForTextItemRects(text, itemRect, annotationRects);
        return {
          index,
          text: selectedText || text.trim(),
          rect: itemRect,
        };
      })
      .filter((chunk): chunk is { index: number; text: string; rect: RectLike } => Boolean(chunk))
      .sort((leftChunk, rightChunk) => leftChunk.index - rightChunk.index);
    return chunks.map(({ text }) => text).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export async function getPageTextItems(page: {
  getTextContent: () => Promise<{ items: Record<string, unknown>[] }>;
  streamTextContent?: () => {
    getReader: () => {
      read: () => Promise<{ done?: boolean; value?: { items?: Record<string, unknown>[] } }>;
    };
  };
}) {
  if (typeof page.streamTextContent === "function") {
    const reader = page.streamTextContent().getReader();
    const items: Record<string, unknown>[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && Array.isArray(value.items)) {
        items.push(...value.items);
      }
    }
    return items;
  }
  const textContent = await page.getTextContent();
  return Array.isArray(textContent.items) ? textContent.items : [];
}

export async function pdfAnnotationSortPosition(
  pdfDocument: PdfDocumentWithPages | null,
  pageNumber: number,
  annotation: PdfAnnotationRaw,
) {
  const rect = numbersFromUnknown(annotation.rect);
  if (!pdfDocument || rect.length < 4) return null;
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const rects = annotationViewportRects(annotation, viewport);
    const firstLineTop = Math.min(...rects.map((candidate) => candidate.top));
    const firstLineRects = rects.filter((candidate) => Math.abs(candidate.top - firstLineTop) < 2);
    return {
      top: firstLineTop,
      left: Math.min(...firstLineRects.map((candidate) => candidate.left)),
    };
  } catch {
    return null;
  }
}

export async function pdfAnnotationBounds(
  pdfDocument: PdfDocumentWithPages | null,
  pageNumber: number,
  annotation: PdfAnnotationRaw,
) {
  const rect = numbersFromUnknown(annotation.rect);
  if (!pdfDocument || rect.length < 4) return null;
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const width = Number(viewport.width ?? 0);
    return rectToPagePercent(unionRects(annotationViewportRects(annotation, viewport)), width, viewport.height);
  } catch {
    return null;
  }
}

export function normalizeViewportRect(rect: number[]) {
  const [x1, y1, x2, y2] = rect;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

export function annotationViewportRects(
  annotation: PdfAnnotationRaw,
  viewport: {
    transform: number[];
    convertToViewportRectangle: (rect: number[]) => number[];
    convertToViewportPoint?: (x: number, y: number) => number[];
  },
) {
  const quadRects = quadPointViewportRects(annotation.quadPoints, viewport);
  if (quadRects.length > 0) {
    return quadRects;
  }
  const rect = numbersFromUnknown(annotation.rect);
  const [left, top, right, bottom] = normalizeViewportRect(viewport.convertToViewportRectangle(rect));
  return [{ left, top, right, bottom }];
}

export function quadPointViewportRects(
  quadPoints: unknown,
  viewport: {
    transform: number[];
    convertToViewportPoint?: (x: number, y: number) => number[];
  },
) {
  const points = numbersFromUnknown(quadPoints);
  const rects: RectLike[] = [];
  for (let index = 0; index + 7 < points.length; index += 8) {
    const viewportPoints = [
      pointToViewport(viewport, points[index], points[index + 1]),
      pointToViewport(viewport, points[index + 2], points[index + 3]),
      pointToViewport(viewport, points[index + 4], points[index + 5]),
      pointToViewport(viewport, points[index + 6], points[index + 7]),
    ];
    const xs = viewportPoints.map(([x]) => x);
    const ys = viewportPoints.map(([, y]) => y);
    rects.push({
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    });
  }
  return rects;
}

function pointToViewport(
  viewport: {
    transform: number[];
    convertToViewportPoint?: (x: number, y: number) => number[];
  },
  x: number,
  y: number,
) {
  if (typeof viewport.convertToViewportPoint === "function") {
    return viewport.convertToViewportPoint(x, y);
  }
  return applyTransformToPoint(viewport.transform, x, y);
}

export function numbersFromUnknown(value: unknown): number[] {
  if (Array.isArray(value)) {
    const values: number[] = [];
    for (const item of value) {
      values.push(...numbersFromUnknown(item));
    }
    return values;
  }
  if (ArrayBuffer.isView(value) && "length" in value) {
    return Array.from(value as unknown as ArrayLike<number>).filter(Number.isFinite);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [value];
  }
  return [];
}

export function textForTextItemRects(text: string, itemRect: RectLike, annotationRects: RectLike[]) {
  if (text.length === 0 || itemRect.right <= itemRect.left) return "";
  let firstOffset: number | null = null;
  let lastOffset: number | null = null;
  for (let offset = 0; offset < text.length; offset += 1) {
    const charRect = {
      left: itemRect.left + ((itemRect.right - itemRect.left) * offset) / text.length,
      top: itemRect.top,
      right: itemRect.left + ((itemRect.right - itemRect.left) * (offset + 1)) / text.length,
      bottom: itemRect.bottom,
    };
    if (annotationRects.some((annotationRect) => rectLikesOverlap(annotationRect, charRect, 1))) {
      firstOffset ??= offset;
      lastOffset = offset + 1;
    }
  }
  if (firstOffset === null || lastOffset === null) return "";
  const [start, end] = trimPartialWordEdges(text, firstOffset, lastOffset);
  return text.slice(start, end).trim() || text.slice(firstOffset, lastOffset).trim();
}

export function trimPartialWordEdges(text: string, firstOffset: number, lastOffset: number): [number, number] {
  let start = firstOffset;
  let end = lastOffset;
  if (start > 0 && /\S/.test(text[start] ?? "") && /\S/.test(text[start - 1] ?? "")) {
    while (start < end && /\S/.test(text[start] ?? "")) start += 1;
    while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  }
  if (end < text.length && /\S/.test(text[end] ?? "") && /\S/.test(text[end - 1] ?? "")) {
    while (end > start && /\S/.test(text[end - 1] ?? "")) end -= 1;
    while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  }
  return [start, end];
}

export function applyTransformToPoint(transform: number[], x: number, y: number) {
  return [x * transform[0] + y * transform[2] + transform[4], x * transform[1] + y * transform[3] + transform[5]];
}

export function transformMatrix(left: number[], right: number[]) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function rectLikesOverlap(left: RectLike, right: RectLike, padding = 0) {
  return (
    left.left - padding < right.right &&
    left.right + padding > right.left &&
    left.top - padding < right.bottom &&
    left.bottom + padding > right.top
  );
}

export function unionRects(rects: RectLike[]) {
  return rects.reduce(
    (union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
}

export function rectToPagePercent(rect: RectLike, width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    left: rect.left / width,
    top: rect.top / height,
    right: rect.right / width,
    bottom: rect.bottom / height,
  };
}

export function boundsOverlapSignificantly(left: RectLike, right: RectLike) {
  const intersectionWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const intersectionHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const intersectionArea = intersectionWidth * intersectionHeight;
  const smallerArea = Math.min(rectArea(left), rectArea(right));
  return smallerArea > 0 && intersectionArea / smallerArea > 0.55;
}

export function rectArea(rect: RectLike) {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

export function cachedAnnotationDetail(cache: Map<string, string>, entryId: string, detail: string) {
  const cached = cache.get(entryId);
  if (cached) {
    return cached;
  }
  const normalized = detail.trim();
  if (isUsefulAnnotationDetail(normalized)) {
    cache.set(entryId, normalized);
    return normalized;
  }
  return cache.get(entryId) ?? normalized;
}

export function isUsefulAnnotationDetail(detail: string) {
  return Boolean(
    detail &&
      detail !== "Persisted PDF annotation" &&
      detail !== "Unsaved/live highlight" &&
      detail !== "Unsaved/live free text" &&
      detail !== "Unsaved/live ink",
  );
}

export function isDuplicateLiveAnnotation(
  entries: AnnotationEntry[],
  pageNumber: number,
  kind: AnnotationKind,
  bounds: RectLike | null,
  detail: string,
) {
  return entries.some((entry) => {
    if (entry.page !== pageNumber || entry.kind !== kind) return false;
    if (bounds && entry.bounds && boundsOverlapSignificantly(bounds, entry.bounds)) {
      return true;
    }
    return !bounds && !entry.bounds && entry.detail === detail;
  });
}
