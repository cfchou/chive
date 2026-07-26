export type PdfOutlineWriteEntry = {
  color: string | null;
  colorDirty: boolean;
  items: PdfOutlineWriteEntry[];
};

export type PdfBookmarkWriteEntry = {
  title: string;
  pageRef: string;
  destinationY: number;
  color: string | null;
};

export type PdfOutlineWriteState = {
  bookmarkRootTitle: string;
  documentOutlineEntries: PdfOutlineWriteEntry[];
  bookmarks: PdfBookmarkWriteEntry[];
};

type PdfObjectWrite = {
  objectNumber: number;
  body: string;
};

const latin1 = new TextDecoder("latin1");

export function writePdfOutlineState(bytes: Uint8Array, state: PdfOutlineWriteState) {
  const withoutBookmarks = removeBookmarkOutline(bytes, state.bookmarkRootTitle);
  const withOutlineColors = applyOutlineColorPatches(withoutBookmarks, state.documentOutlineEntries);
  return appendBookmarkOutline(withOutlineColors, state.bookmarks, state.bookmarkRootTitle);
}

export function applyOutlineColorPatches(bytes: Uint8Array, entries: PdfOutlineWriteEntry[]) {
  const dirtyEntries = flattenOutlineEntries(entries).filter((entry) => entry.colorDirty);
  if (dirtyEntries.length === 0) return bytes;

  const text = latin1.decode(bytes);
  const trailerInfo = readTrailerInfo(text, "outline color update");
  const catalog = readObjectBody(text, trailerInfo.rootObject);
  const outlinesObject = Number(catalog.match(/\/Outlines\s+(\d+)\s+\d+\s+R/)?.[1]);
  if (!outlinesObject) {
    throw new Error("PDF has no outline tree for outline color update");
  }

  const outlineObjects = outlineItemObjectNumbers(text, outlinesObject);
  const flatEntries = flattenOutlineEntries(entries);
  if (outlineObjects.length !== flatEntries.length) {
    throw new Error("Could not match PDF outline objects for outline color update");
  }

  const objectWrites = flatEntries.flatMap((entry, index) => {
    if (!entry.colorDirty) return [];
    const objectNumber = outlineObjects[index];
    const body = readObjectBody(text, objectNumber);
    return [
      {
        objectNumber,
        body: entry.color
          ? rewritePdfDictionary(body, { C: formatPdfColor(entry.color) })
          : removePdfDictionaryKeys(body, ["C"]),
      },
    ];
  });

  return appendIncrementalPdfUpdate(
    bytes,
    objectWrites,
    trailerInfo.size,
    trailerInfo.rootObject,
    trailerInfo.previousXref,
  );
}

export function appendBookmarkOutline(
  bytes: Uint8Array,
  bookmarks: PdfBookmarkWriteEntry[],
  bookmarkRootTitle: string,
) {
  const baseBytes = removeBookmarkOutline(bytes, bookmarkRootTitle);
  if (bookmarks.length === 0) return baseBytes;

  const text = latin1.decode(baseBytes);
  const trailerInfo = readTrailerInfo(text, "bookmark outline update");
  const catalog = readObjectBody(text, trailerInfo.rootObject);
  const outlinesObject = Number(catalog.match(/\/Outlines\s+(\d+)\s+\d+\s+R/)?.[1]);
  if (!outlinesObject) {
    throw new Error("PDF has no outline tree for bookmark insertion");
  }

  const outlineRoot = readObjectBody(text, outlinesObject);
  const oldFirstObject = Number(outlineRoot.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
  const oldLastObject = Number(outlineRoot.match(/\/Last\s+(\d+)\s+\d+\s+R/)?.[1]);
  const oldCount = Number(outlineRoot.match(/\/Count\s+(-?\d+)/)?.[1] ?? 0);
  if (!oldFirstObject || !oldLastObject) {
    throw new Error("PDF outline tree has no top-level entries");
  }

  const bookmarkRootObject = trailerInfo.size;
  const firstBookmarkObject = trailerInfo.size + 1;
  const nextSize = trailerInfo.size + 1 + bookmarks.length * 2;
  const objectWrites: PdfObjectWrite[] = [];

  const childObjects = bookmarks.map((bookmark, index) => {
    const itemObject = firstBookmarkObject + index * 2;
    const destObject = itemObject + 1;
    const previousObject = index === 0 ? null : firstBookmarkObject + (index - 1) * 2;
    const nextObject = index === bookmarks.length - 1 ? null : firstBookmarkObject + (index + 1) * 2;
    objectWrites.push({
      objectNumber: destObject,
      body: `[ ${bookmark.pageRef} /XYZ 0 ${formatPdfNumber(bookmark.destinationY)} 0 ]`,
    });
    objectWrites.push({
      objectNumber: itemObject,
      body: [
        "<<",
        `/Title ${pdfString(bookmark.title)}`,
        `/Dest ${destObject} 0 R`,
        bookmark.color ? `/C ${formatPdfColor(bookmark.color)}` : "",
        `/Parent ${bookmarkRootObject} 0 R`,
        previousObject ? `/Prev ${previousObject} 0 R` : "",
        nextObject ? `/Next ${nextObject} 0 R` : "",
        ">>",
      ]
        .filter(Boolean)
        .join(" "),
    });
    return itemObject;
  });

  objectWrites.push({
    objectNumber: bookmarkRootObject,
    body: [
      "<<",
      `/Title ${pdfString(bookmarkRootTitle)}`,
      `/Parent ${outlinesObject} 0 R`,
      `/First ${childObjects[0]} 0 R`,
      `/Last ${childObjects.at(-1)} 0 R`,
      `/Count ${bookmarks.length}`,
      `/Next ${oldFirstObject} 0 R`,
      ">>",
    ].join(" "),
  });
  objectWrites.push({
    objectNumber: outlinesObject,
    body: rewritePdfDictionary(outlineRoot, {
      First: `${bookmarkRootObject} 0 R`,
      Count: String(oldCount + 1),
    }),
  });
  objectWrites.push({
    objectNumber: oldFirstObject,
    body: rewritePdfDictionary(readObjectBody(text, oldFirstObject), {
      Prev: `${bookmarkRootObject} 0 R`,
    }),
  });

  return appendIncrementalPdfUpdate(
    baseBytes,
    objectWrites,
    nextSize,
    trailerInfo.rootObject,
    trailerInfo.previousXref,
  );
}

export function removeBookmarkOutline(bytes: Uint8Array, bookmarkRootTitle: string) {
  const text = latin1.decode(bytes);
  const trailerInfo = readOptionalTrailerInfo(text);
  if (!trailerInfo) return bytes;

  const catalog = readObjectBody(text, trailerInfo.rootObject);
  const outlinesObject = Number(catalog.match(/\/Outlines\s+(\d+)\s+\d+\s+R/)?.[1]);
  if (!outlinesObject) return bytes;

  const bookmarkRootObject = findBookmarkRootObject(text, outlinesObject, bookmarkRootTitle);
  if (!bookmarkRootObject) return bytes;

  const outlineRoot = readObjectBody(text, outlinesObject);
  const bookmarkRoot = readObjectBody(text, bookmarkRootObject);
  const oldFirstObject = Number(outlineRoot.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
  const oldLastObject = Number(outlineRoot.match(/\/Last\s+(\d+)\s+\d+\s+R/)?.[1]);
  const oldCount = Number(outlineRoot.match(/\/Count\s+(-?\d+)/)?.[1] ?? 0);
  const previousObject = Number(bookmarkRoot.match(/\/Prev\s+(\d+)\s+\d+\s+R/)?.[1]);
  const nextObject = Number(bookmarkRoot.match(/\/Next\s+(\d+)\s+\d+\s+R/)?.[1]);
  const objectWrites: PdfObjectWrite[] = [];

  const outlineReplacements: Record<string, string> = {
    Count: String(Math.max(0, oldCount - 1)),
  };
  if (oldFirstObject === bookmarkRootObject && nextObject) {
    outlineReplacements.First = `${nextObject} 0 R`;
  }
  if (oldLastObject === bookmarkRootObject && previousObject) {
    outlineReplacements.Last = `${previousObject} 0 R`;
  }
  objectWrites.push({
    objectNumber: outlinesObject,
    body: rewritePdfDictionary(outlineRoot, outlineReplacements),
  });

  if (previousObject) {
    const previousBody = readObjectBody(text, previousObject);
    objectWrites.push({
      objectNumber: previousObject,
      body: nextObject
        ? rewritePdfDictionary(previousBody, { Next: `${nextObject} 0 R` })
        : removePdfDictionaryKeys(previousBody, ["Next"]),
    });
  }
  if (nextObject) {
    const nextBody = readObjectBody(text, nextObject);
    objectWrites.push({
      objectNumber: nextObject,
      body: previousObject
        ? rewritePdfDictionary(nextBody, { Prev: `${previousObject} 0 R` })
        : removePdfDictionaryKeys(nextBody, ["Prev"]),
    });
  }

  return appendIncrementalPdfUpdate(
    bytes,
    objectWrites,
    trailerInfo.size,
    trailerInfo.rootObject,
    trailerInfo.previousXref,
  );
}

function readTrailerInfo(pdfText: string, context: string) {
  const trailerInfo = readOptionalTrailerInfo(pdfText);
  if (!trailerInfo) {
    throw new Error(`Could not find PDF trailer for ${context}`);
  }
  return trailerInfo;
}

function readOptionalTrailerInfo(pdfText: string) {
  const startxrefMatch = [...pdfText.matchAll(/startxref\s+(\d+)\s+%%EOF/g)].at(-1);
  const trailerMatch = [...pdfText.matchAll(/trailer\s*<<(.*?)>>\s*startxref/gs)].at(-1);
  if (!startxrefMatch || !trailerMatch) return null;

  const trailer = trailerMatch[1];
  const size = Number(trailer.match(/\/Size\s+(\d+)/)?.[1]);
  const rootObject = Number(trailer.match(/\/Root\s+(\d+)\s+\d+\s+R/)?.[1]);
  const previousXref = Number(startxrefMatch[1]);
  if (!size || !rootObject || Number.isNaN(previousXref)) return null;
  return { size, rootObject, previousXref };
}

function flattenOutlineEntries(entries: PdfOutlineWriteEntry[]): PdfOutlineWriteEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenOutlineEntries(entry.items ?? [])]);
}

function outlineItemObjectNumbers(pdfText: string, outlinesObject: number) {
  const root = readObjectBody(pdfText, outlinesObject);
  const firstObject = Number(root.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
  if (!firstObject) return [];
  const objectNumbers: number[] = [];
  const seen = new Set<number>();
  const visit = (objectNumber: number) => {
    let current = objectNumber;
    while (current) {
      if (seen.has(current)) throw new Error("PDF outline tree contains a cycle");
      seen.add(current);
      objectNumbers.push(current);
      const body = readObjectBody(pdfText, current);
      const firstChild = Number(body.match(/\/First\s+(\d+)\s+\d+\s+R/)?.[1]);
      if (firstChild) visit(firstChild);
      current = Number(body.match(/\/Next\s+(\d+)\s+\d+\s+R/)?.[1]);
    }
  };
  visit(firstObject);
  return objectNumbers;
}

function findBookmarkRootObject(pdfText: string, outlinesObject: number, bookmarkRootTitle: string) {
  const objectPattern = /(?:^|\n)(\d+)\s+0\s+obj\s*([\s\S]*?)\s*endobj/g;
  let match: RegExpExecArray | null;
  let found: number | null = null;
  while ((match = objectPattern.exec(pdfText))) {
    const body = match[2];
    if (
      body.includes(`/Title ${pdfString(bookmarkRootTitle)}`) &&
      body.includes(`/Parent ${outlinesObject} 0 R`)
    ) {
      found = Number(match[1]);
    }
  }
  return found;
}

function readObjectBody(pdfText: string, objectNumber: number) {
  const matches = [...pdfText.matchAll(new RegExp(`(?:^|\\n)${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`, "g"))];
  const match = matches.at(-1);
  if (!match) throw new Error(`Could not find PDF object ${objectNumber}`);
  return match[1].trim();
}

function rewritePdfDictionary(body: string, replacements: Record<string, string>) {
  let rewritten = body.trim();
  for (const [key, value] of Object.entries(replacements)) {
    const keyPattern = new RegExp(`/${key}\\s+(?:-?\\d+|\\[[^\\]]*\\]|\\([^)]*\\)|<<[\\s\\S]*?>>|/\\w+)(?:\\s+\\d+\\s+R)?`);
    if (keyPattern.test(rewritten)) {
      rewritten = rewritten.replace(keyPattern, `/${key} ${value}`);
    } else {
      rewritten = rewritten.replace(/>>\s*$/, `/${key} ${value} >>`);
    }
  }
  return rewritten;
}

function removePdfDictionaryKeys(body: string, keys: string[]) {
  let rewritten = body.trim();
  for (const key of keys) {
    const keyPattern = new RegExp(`\\s*/${key}\\s+(?:-?\\d+|\\[[^\\]]*\\]|\\([^)]*\\)|<<[\\s\\S]*?>>|/\\w+)(?:\\s+\\d+\\s+R)?`);
    rewritten = rewritten.replace(keyPattern, "");
  }
  return rewritten;
}

function appendIncrementalPdfUpdate(
  bytes: Uint8Array,
  objectWrites: PdfObjectWrite[],
  size: number,
  rootObject: number,
  previousXref: number,
) {
  let update = "\n";
  const offsets = new Map<number, number>();
  for (const objectWrite of objectWrites.sort((left, right) => left.objectNumber - right.objectNumber)) {
    offsets.set(objectWrite.objectNumber, bytes.length + update.length);
    update += `${objectWrite.objectNumber} 0 obj\n${objectWrite.body}\nendobj\n`;
  }
  const xrefOffset = bytes.length + update.length;
  update += "xref\n";
  for (const objectNumber of [...offsets.keys()].sort((left, right) => left - right)) {
    update += `${objectNumber} 1\n${String(offsets.get(objectNumber)).padStart(10, "0")} 00000 n \n`;
  }
  update += `trailer\n<< /Size ${size} /Root ${rootObject} 0 R /Prev ${previousXref} >>\n`;
  update += `startxref\n${xrefOffset}\n%%EOF\n`;

  const encodedUpdate = new TextEncoder().encode(update);
  const output = new Uint8Array(bytes.length + encodedUpdate.length);
  output.set(bytes);
  output.set(encodedUpdate, bytes.length);
  return output;
}

function pdfString(value: string) {
  return `(${value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

function formatPdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatPdfColor(color: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return "[0 0 0]";
  const hex = match[1];
  const components = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) =>
    (Number.parseInt(part, 16) / 255).toFixed(3),
  );
  return `[${components.join(" ")}]`;
}
