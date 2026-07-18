type PdfPageTextSource = {
  getTextContent: () => Promise<{ items: unknown }>;
  streamTextContent?: () => {
    getReader: () => {
      read: () => Promise<{ done?: boolean; value?: { items?: unknown } }>;
    };
  };
};

/** Read pdf.js text items through the WKWebView-compatible path from ADR 0006. */
export async function getPageTextItems(page: PdfPageTextSource): Promise<unknown[]> {
  if (typeof page.streamTextContent === "function") {
    const reader = page.streamTextContent().getReader();
    const items: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && Array.isArray(value.items)) items.push(...value.items);
    }
    return items;
  }
  const textContent = await page.getTextContent();
  return Array.isArray(textContent.items) ? textContent.items : [];
}
