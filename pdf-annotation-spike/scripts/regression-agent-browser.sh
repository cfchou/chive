#!/usr/bin/env bash
set -euo pipefail

SESSION="${SESSION:-pdfspike-regression}"
URL="${URL:-http://127.0.0.1:1420/}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
PDF_PATH=""
PDF_PATHS=()
PDF_HTTP_PID=""
PDF_HTTP_PORT="${PDF_HTTP_PORT:-1421}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pdf)
      PDF_PATH="${2:-}"
      if [[ -z "$PDF_PATH" ]]; then
        echo "--pdf needs a path" >&2
        exit 1
      fi
      PDF_PATHS+=("$PDF_PATH")
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if (( ${#PDF_PATHS[@]} > 1 )); then
  base_port="$PDF_HTTP_PORT"
  index=0
  for path in "${PDF_PATHS[@]}"; do
    echo "== Regression PDF: $path =="
    SESSION="${SESSION}-${index}" PDF_HTTP_PORT="$((base_port + index))" "$0" --pdf "$path"
    index="$((index + 1))"
  done
  exit 0
fi

ab() {
  agent-browser --session "$SESSION" "$@"
}

run_eval() {
  local script="$1"
  cat <<EOF | ab eval --stdin
$script
EOF
}

click_button_label() {
  local label="$1"
  run_eval "(async () => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '$label');
    if (!button) {
      throw new Error('Button not found: $label');
    }
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { label: button.textContent?.trim() };
  })()" >/dev/null
}

resolve_pdf_path() {
  local input="$1"
  if [[ "$input" = /* && -f "$input" ]]; then
    printf '%s\n' "$input"
    return
  fi
  if [[ -f "$input" ]]; then
    (cd "$(pwd)" && printf '%s/%s\n' "$(pwd)" "$input")
    return
  fi
  if [[ -f "$REPO_ROOT/$input" ]]; then
    printf '%s/%s\n' "$REPO_ROOT" "$input"
    return
  fi
  echo "PDF not found: $input" >&2
  exit 1
}

urlencode_path() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import quote
print(quote(sys.argv[1]))
PY
}

start_pdf_http_server() {
  if [[ -z "$PDF_PATH" ]]; then
    return
  fi
  if [[ -n "$PDF_HTTP_PID" ]]; then
    return
  fi
  (cd "$REPO_ROOT" && python3 -c '
import http.server
import socketserver
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableTCPServer(("127.0.0.1", int(sys.argv[1])), Handler) as httpd:
    httpd.serve_forever()
' "$PDF_HTTP_PORT" >/tmp/pdfspike-pdf-http.log 2>&1) &
  PDF_HTTP_PID="$!"
  sleep 0.5
}

load_pdf_under_test() {
  if [[ -z "$PDF_PATH" ]]; then
    ab find role button click --name "Load Sample" >/dev/null
    ab wait --text "How Modern Browsers Work" >/dev/null
    return
  fi

  start_pdf_http_server
  local absolute_path
  absolute_path="$(resolve_pdf_path "$PDF_PATH")"
  case "$absolute_path" in
    "$REPO_ROOT"/*) ;;
    *)
      echo "PDF must be inside repo root for browser harness: $absolute_path" >&2
      exit 1
      ;;
  esac
  local relative_path="${absolute_path#"$REPO_ROOT"/}"
  local encoded_path
  encoded_path="$(urlencode_path "$relative_path")"
  local pdf_url="http://127.0.0.1:${PDF_HTTP_PORT}/${encoded_path}"
  local label
  label="$(basename "$absolute_path")"
  local payload
  payload="$(PDF_URL="$pdf_url" PDF_LABEL="$label" node -e 'process.stdout.write(JSON.stringify({ url: process.env.PDF_URL, label: process.env.PDF_LABEL }))')"
  run_eval "(async () => {
    const input = $payload;
    await window.__pdfSpike.loadUrl(input.url, input.label);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const stats = window.__pdfSpike.stats();
      if (stats.pages > 0 && document.querySelector('.page[data-page-number=\"1\"]')) {
        return { ok: true, stats };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('PDF under test did not render page 1');
  })()" >/dev/null
}

detect_selectable_text() {
  run_eval '(() => {
    for (const layer of document.querySelectorAll(".textLayer")) {
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").trim().length >= 12) {
          return true;
        }
      }
    }
    return false;
  })()'
}

assert_visible_page_content() {
  run_eval '(async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const canvas = document.querySelector(".page[data-page-number=\"1\"] canvas");
      if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new Error("Could not read page canvas");
        }
        const width = canvas.width;
        const height = canvas.height;
        const data = context.getImageData(0, 0, width, height).data;
        let dark = 0;
        for (let index = 0; index < data.length; index += 16) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];
          if (a > 0 && (r < 245 || g < 245 || b < 245)) {
            dark += 1;
          }
        }
        const sampled = data.length / 16;
        const ratio = dark / sampled;
        if (ratio <= 0.005) {
          throw new Error(`Page canvas looks blank or broken; non-white ratio=${ratio}`);
        }
        return { width, height, ratio };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Page canvas not ready for visual content check");
  })()' >/dev/null
}

run_outline_navigation_test() {
  echo "== Outline sidebar navigation =="
  run_eval '(async () => {
    await window.__pdfSpike.loadUrl("/outline-sample.pdf", "outline-sample.pdf");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const outline = window.__pdfSpike.outlineSummary();
      const buttons = [...document.querySelectorAll(".outline-item")];
      if (outline.length >= 3 && buttons.length >= 3) {
        const titles = outline.map((entry) => entry.title);
        if (!titles.includes("Outline Page Two")) {
          throw new Error(`Expected Outline Page Two in outline, got ${titles.join(", ")}`);
        }
        buttons[1].click();
        for (let pageAttempt = 0; pageAttempt < 20; pageAttempt += 1) {
          const stats = window.__pdfSpike.stats();
          if (stats.currentPageNumber === 2) {
            return { titles, currentPageNumber: stats.currentPageNumber };
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error(`Outline click did not navigate to page 2; stats=${JSON.stringify(window.__pdfSpike.stats())}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Outline sidebar did not render fixture outline; outline=${JSON.stringify(window.__pdfSpike.outlineSummary())}`);
  })()' >/dev/null
}

run_annotation_sidebar_test() {
  echo "== Annotation sidebar selection =="
  run_eval '(async () => {
    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    await new Promise((resolve) => setTimeout(resolve, 400));
    const selectTextChunk = async (index) => {
      const nodes = [];
      for (const layer of document.querySelectorAll(".textLayer")) {
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          if (text.trim().length >= 20) nodes.push(node);
        }
      }
      const node = nodes[index] ?? nodes[0];
      if (!node) return "";
      const text = node.textContent ?? "";
      const start = Math.max(0, text.search(/\S/));
      const end = Math.min(text.length, start + 20);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    };
    const selectedText = await selectTextChunk(0);
    if (!selectedText) {
      throw new Error("Could not select text for annotation sidebar highlight");
    }
    window.__regression.sidebarHighlightedText = selectedText;
    const highlightButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Highlight Selection");
    highlightButton?.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 21,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
    highlightButton?.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 21,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await window.__pdfSpike.createPageFreeText("Sidebar regression note", 1);
    window.__pdfSpike.setTool("none");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await window.__pdfSpike.saveToPath("/tmp/pdfspike-annotation-sidebar.pdf");
    await window.__pdfSpike.loadPath("/tmp/pdfspike-annotation-sidebar.pdf");

    const tab = [...document.querySelectorAll(".nav-tabs button")]
      .find((button) => button.textContent?.trim() === "Annotations");
    if (!(tab instanceof HTMLElement)) {
      throw new Error("Annotations tab not found");
    }
    tab.click();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const entries = window.__pdfSpike.annotationSidebarSummary();
      const items = [...document.querySelectorAll(".annotation-item")];
      const highlightIndex = entries.findIndex((entry) => entry.kind === "highlight");
      const freeTextIndex = entries.findIndex((entry) => entry.kind === "freetext");
      const highlightedWord = window.__regression.sidebarHighlightedText.split(/\s+/)[0];
      if (highlightIndex >= 0 && freeTextIndex >= 0 && items[highlightIndex] instanceof HTMLElement) {
        const highlightEntry = entries[highlightIndex];
        if (!highlightEntry.detail.includes(highlightedWord)) {
          throw new Error(`Expected highlight sidebar detail to include "${highlightedWord}", got "${highlightEntry.detail}"`);
        }
        window.__regression.sidebarHighlightDetail = highlightEntry.detail;
        items[highlightIndex].click();
        for (let selectAttempt = 0; selectAttempt < 20; selectAttempt += 1) {
          const stats = window.__pdfSpike.stats();
          const box = document.querySelector(".annotation-focus-box");
          if (stats.activeTool === "highlight" && stats.selectedAnnotationKind === "highlight" && box instanceof HTMLElement) {
            const boxRect = box.getBoundingClientRect();
            const containerRect = document.querySelector(".pdf-container").getBoundingClientRect();
            const boxCenterY = boxRect.top + boxRect.height / 2;
            const containerCenterY = containerRect.top + containerRect.height / 2;
            const container = document.querySelector(".pdf-container");
            const atTopBoundary = container instanceof HTMLElement && container.scrollTop === 0;
            if (!atTopBoundary && Math.abs(boxCenterY - containerCenterY) > containerRect.height * 0.25) {
              throw new Error(`Expected highlight focus near viewport middle; boxCenterY=${boxCenterY} containerCenterY=${containerCenterY}`);
            }
            items[freeTextIndex].click();
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        for (let selectAttempt = 0; selectAttempt < 20; selectAttempt += 1) {
          const stats = window.__pdfSpike.stats();
          if (stats.activeTool === "text" && stats.selectedAnnotationKind === "freetext") {
            const secondSelectedText = await selectTextChunk(1);
            if (!secondSelectedText) {
              throw new Error("Could not select second text for sidebar snippet regression");
            }
            const highlightButton = [...document.querySelectorAll("button")]
              .find((button) => button.textContent?.trim() === "Highlight Selection");
            highlightButton?.dispatchEvent(new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 22,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: 1,
            }));
            highlightButton?.dispatchEvent(new PointerEvent("pointerup", {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 22,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: 0,
            }));
            await new Promise((resolve) => setTimeout(resolve, 500));
            tab.click();
            await new Promise((resolve) => setTimeout(resolve, 200));
            const refreshedEntries = window.__pdfSpike.annotationSidebarSummary();
            if (!refreshedEntries.some((entry) => entry.kind === "highlight" && entry.detail === window.__regression.sidebarHighlightDetail)) {
              throw new Error(`Expected existing highlight detail to survive new highlight, got ${JSON.stringify(refreshedEntries.map((entry) => ({ kind: entry.kind, detail: entry.detail })))}`);
            }
            if (!refreshedEntries.some((entry) => entry.kind === "highlight" && entry.detail === secondSelectedText.trim())) {
              throw new Error(`Expected new highlight detail "${secondSelectedText.trim()}" in sidebar, got ${JSON.stringify(refreshedEntries.map((entry) => ({ kind: entry.kind, detail: entry.detail })))}`);
            }
            const highlightDetails = refreshedEntries.filter((entry) => entry.kind === "highlight").map((entry) => entry.detail);
            const firstIndex = highlightDetails.indexOf(window.__regression.sidebarHighlightDetail);
            const secondIndex = highlightDetails.indexOf(secondSelectedText.trim());
            if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
              throw new Error(`Expected highlight rows to stay in page order, got ${JSON.stringify(highlightDetails)}`);
            }
            return { entries: refreshedEntries, selected: stats.selectedAnnotationKind };
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error(`Annotation sidebar click did not select free text; stats=${JSON.stringify(window.__pdfSpike.stats())}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Annotation sidebar did not list highlight/free text; entries=${JSON.stringify(window.__pdfSpike.annotationSidebarSummary())}`);
  })()' >/dev/null
}

run_annotation_sidebar_load_timing_test() {
  echo "== Annotation sidebar load timing =="
  run_eval '(async () => {
    const tab = () => [...document.querySelectorAll(".nav-tabs button")]
      .find((button) => button.textContent?.trim() === "Annotations");
    const waitForUsefulHighlight = async (label) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const entries = window.__pdfSpike.annotationSidebarSummary();
        const highlights = entries.filter((entry) => entry.kind === "highlight");
        const details = highlights.map((entry) => entry.detail);
        const hasPreciseSampleSnippets =
          details.some((detail) => detail.includes("browser\u0027s UI thread") && detail.includes("navigation request")) &&
          details.some((detail) => detail.includes("support preconnect and preload directives")) &&
          details.some((detail) => detail.includes("Chrome\u0027s CORB") || detail.includes("Cross-Origin Read Blocking"));
        const hasBroadSampleSnippet = details.some((detail) => detail.startsWith("ter a URL or click a link"));
        const hasPartialWordSnippet = details.some((detail) => detail.startsWith("e browser\u0027s") || detail.startsWith("ta (Chrome"));
        const allUseful = highlights.length >= 3 && highlights.every((entry) =>
          entry.detail &&
          !entry.detail.includes("Persisted PDF annotation") &&
          !entry.detail.includes("Unsaved/live highlight") &&
          /\s/.test(entry.detail.trim()) &&
          Number.isFinite(entry.sortTop) &&
          entry.sortTop < Number.MAX_SAFE_INTEGER
        ) && hasPreciseSampleSnippets && !hasBroadSampleSnippet && !hasPartialWordSnippet;
        if (allUseful) {
          return { label, highlights: highlights.map((entry) => entry.detail) };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`${label}: not all highlight snippets useful after load; entries=${JSON.stringify(window.__pdfSpike.annotationSidebarSummary())}`);
    };
    const textInsideFocusBox = () => {
      const box = document.querySelector(".annotation-focus-box");
      if (!(box instanceof HTMLElement)) return "";
      const boxRect = box.getBoundingClientRect();
      const chunks = [];
      for (const page of document.querySelectorAll(".page")) {
        const walker = document.createTreeWalker(page.querySelector(".textLayer") ?? page, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          let firstOffset = null;
          let lastOffset = null;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (!text[offset]?.trim()) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            range.detach();
            if (
              rect.width > 0 &&
              rect.height > 0 &&
              boxRect.left - 2 < rect.right &&
              boxRect.right + 2 > rect.left &&
              boxRect.top - 2 < rect.bottom &&
              boxRect.bottom + 2 > rect.top
            ) {
              firstOffset ??= offset;
              lastOffset = offset + 1;
            }
          }
          if (firstOffset !== null && lastOffset !== null) {
            chunks.push(text.slice(firstOffset, lastOffset));
          }
        }
      }
      return chunks.join(" ").replace(/\s+/g, " ").trim();
    };
    const significantTokens = (text) =>
      text
        .replace(/[()".,;:—-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 5);
    const assertHighlightRowsPointToFocusedText = async () => {
      const entries = window.__pdfSpike.annotationSidebarSummary();
      for (const entry of entries) {
        if (entry.source !== "pdf" || entry.kind !== "highlight") continue;
        const rowIndex = window.__pdfSpike.annotationSidebarSummary().findIndex((candidate) => candidate.id === entry.id);
        const row = [...document.querySelectorAll(".annotation-item")][rowIndex];
        if (!(row instanceof HTMLElement)) {
          throw new Error(`Could not find annotation row for ${entry.detail}`);
        }
        row.click();
        await new Promise((resolve) => setTimeout(resolve, 800));
        const focusText = textInsideFocusBox();
        const expectedTokens = significantTokens(entry.detail);
        const matchingTokens = expectedTokens.filter((token) => focusText.includes(token));
        if (matchingTokens.length < Math.min(2, expectedTokens.length)) {
          throw new Error(`Annotation row points to wrong content; expected=${entry.detail}; focus=${focusText}`);
        }
      }
    };
    const assertPageHeadersMatchEntries = () => {
      const groups = [];
      for (const entry of window.__pdfSpike.annotationSidebarSummary()) {
        const last = groups[groups.length - 1];
        if (last?.page === entry.page) {
          last.count += 1;
        } else {
          groups.push({ page: entry.page, count: 1 });
        }
      }
      const headers = [...document.querySelectorAll(".annotation-page-header")].map((header) => header.textContent?.replace(/\s+/g, " ").trim());
      const expected = groups.map((group) => `Page ${group.page} ${group.count} item${group.count === 1 ? "" : "s"}`);
      if (headers.length !== expected.length || !expected.every((text, index) => headers[index] === text)) {
        throw new Error(`Annotation page headers mismatch; expected=${JSON.stringify(expected)} actual=${JSON.stringify(headers)}`);
      }
    };
    const pageCounts = () => {
      const counts = new Map();
      for (const entry of window.__pdfSpike.annotationSidebarSummary()) {
        const current = counts.get(entry.page) ?? { total: 0, pdf: 0, live: 0, details: [] };
        current.total += 1;
        current[entry.source] += 1;
        current.details.push(`${entry.source}:${entry.kind}:${entry.detail}`);
        counts.set(entry.page, current);
      }
      return Object.fromEntries(counts);
    };
    const selectTextOnPage = async (pageNumber) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const page = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
        if (page instanceof HTMLElement) {
          page.scrollIntoView({ block: "center" });
          await new Promise((resolve) => setTimeout(resolve, 250));
          const walker = document.createTreeWalker(page.querySelector(".textLayer") ?? page, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent ?? "";
            const start = text.search(/\S/);
            if (start >= 0 && text.trim().length >= 30) {
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, Math.min(text.length, start + 30));
              const selection = document.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              return selection?.toString() ?? "";
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`Could not select text on page ${pageNumber}`);
    };
    const createHighlightSelectionOnPage = async (pageNumber) => {
      const selected = await selectTextOnPage(pageNumber);
      const button = [...document.querySelectorAll("button")]
        .find((node) => node.textContent?.trim() === "Highlight Selection");
      if (!(button instanceof HTMLElement)) {
        throw new Error("Highlight Selection button not found");
      }
      button.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 31,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      }));
      button.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 31,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
      }));
      await new Promise((resolve) => setTimeout(resolve, 800));
      tab()?.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return selected;
    };
    const clickEntryAndWait = async (predicate, selectedKind) => {
      const entries = window.__pdfSpike.annotationSidebarSummary();
      const rowIndex = entries.findIndex(predicate);
      if (rowIndex < 0) {
        throw new Error(`Annotation entry not found; entries=${JSON.stringify(entries)}`);
      }
      const row = [...document.querySelectorAll(".annotation-item")][rowIndex];
      if (!(row instanceof HTMLElement)) {
        throw new Error(`Annotation row not found at index ${rowIndex}`);
      }
      row.click();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike.stats();
        if (stats.selectedAnnotationKind === selectedKind) {
          return { entry: entries[rowIndex], stats };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`Annotation row did not select ${selectedKind}; stats=${JSON.stringify(window.__pdfSpike.stats())}`);
    };

    tab()?.click();
    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    const first = await waitForUsefulHighlight("first load with annotations tab already selected");
    assertPageHeadersMatchEntries();
    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    const second = await waitForUsefulHighlight("second load with annotations tab still selected");
    assertPageHeadersMatchEntries();
    const beforeClick = window.__pdfSpike.annotationSidebarSummary();
    await window.__pdfSpike.activateFirstAnnotationItem();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const afterClick = window.__pdfSpike.annotationSidebarSummary();
    const liveMirrors = afterClick.filter((entry) => entry.source === "live" && beforeClick.some((before) => before.page === entry.page));
    if (afterClick.length !== beforeClick.length || liveMirrors.length > 0) {
      throw new Error(`Clicking persisted annotation should not add live mirror rows; before=${beforeClick.length} after=${afterClick.length} live=${JSON.stringify(liveMirrors)}`);
    }
    await assertHighlightRowsPointToFocusedText();

    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("delete sync sample reload");
    const beforeDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    if (!window.__pdfSpike.deleteSelected()) {
      throw new Error(`Delete selected returned false; stats=${JSON.stringify(window.__pdfSpike.stats())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterDeleteCounts = pageCounts();
    if (afterDeleteCounts[2]?.total !== beforeDeleteCounts[2]?.total - 1) {
      throw new Error(`Deleting page-2 highlight must reduce page-2 count; before=${JSON.stringify(beforeDeleteCounts)} after=${JSON.stringify(afterDeleteCounts)}`);
    }
    if (afterDeleteCounts[2]?.details.some((detail) => detail.includes("browser process"))) {
      throw new Error(`Deleted page-2 highlight still appears in sidebar; after=${JSON.stringify(afterDeleteCounts)}`);
    }

    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("keyboard delete sync sample reload");
    const beforeKeyboardDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete",
      code: "Delete",
      bubbles: true,
      cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Delete",
      code: "Delete",
      bubbles: true,
      cancelable: true,
    }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const counts = pageCounts();
      if (
        counts[2]?.total === beforeKeyboardDeleteCounts[2]?.total - 1 &&
        !counts[2]?.details.some((detail) => detail.includes("browser process"))
      ) {
        break;
      }
      if (attempt === 29) {
        throw new Error(`Keyboard Delete must remove page-2 highlight from sidebar without tool switch; before=${JSON.stringify(beforeKeyboardDeleteCounts)} after=${JSON.stringify(counts)} stats=${JSON.stringify(window.__pdfSpike.stats())}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("edit sync sample reload");
    const beforeEditCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "freetext", "freetext");
    const edited = await window.__pdfSpike.editSelectedFreeText("Synced free text row");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const afterEditCounts = pageCounts();
    if (!edited) {
      throw new Error("Edit selected free text returned false");
    }
    if (afterEditCounts[2]?.total !== beforeEditCounts[2]?.total) {
      throw new Error(`Editing page-2 free text must keep page-2 count stable; before=${JSON.stringify(beforeEditCounts)} after=${JSON.stringify(afterEditCounts)}`);
    }
    if (!afterEditCounts[2]?.details.some((detail) => detail.includes("Synced free text row"))) {
      throw new Error(`Edited free text does not appear in sidebar; after=${JSON.stringify(afterEditCounts)}`);
    }

    await window.__pdfSpike.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("create sync sample reload");
    const beforeNewHighlightCounts = pageCounts();
    await createHighlightSelectionOnPage(5);
    const afterNewHighlightCounts = pageCounts();
    if (afterNewHighlightCounts[2]?.total !== beforeNewHighlightCounts[2]?.total) {
      throw new Error(`Adding a page-5 highlight must not duplicate page-2 rows; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }
    if ((afterNewHighlightCounts[5]?.total ?? 0) !== (beforeNewHighlightCounts[5]?.total ?? 0) + 1) {
      throw new Error(`Expected one new page-5 annotation; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }
    return { first, second, afterClickCount: afterClick.length };
  })()' >/dev/null
}

click_highlight_swatch() {
  local color="$1"
  run_eval "(async () => {
    const button = document.querySelector('[aria-label=\"Set highlight color to $color\"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Highlight swatch not found: $color');
    }
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { color: '$color', stats: window.__pdfSpike.stats() };
  })()" >/dev/null
}

click_saved_highlight_in_selection_mode() {
  local point
  point="$(run_eval "(async () => {
    const statsBefore = window.__pdfSpike.stats();
    if (statsBefore.activeTool !== 'none') {
      throw new Error(\`Expected selection mode before clicking saved highlight, got \${statsBefore.activeTool}\`);
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const target = document.querySelector('.page[data-page-number=\"1\"] .highlightAnnotation, .page[data-page-number=\"1\"] .highlightEditor.disabled');
      if (target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect();
        return {
          clientX: Math.round(rect.left + Math.min(rect.width / 2, 8)),
          clientY: Math.round(rect.top + Math.min(rect.height / 2, 8)),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Could not select saved highlight from selection mode');
  })()")"
  local client_x
  local client_y
  client_x="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientX)')"
  client_y="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientY)')"
  ab mouse move "$client_x" "$client_y" >/dev/null
  ab mouse down left >/dev/null
  ab mouse up left >/dev/null
  ab wait 300 >/dev/null
  run_eval "(() => {
    const stats = window.__pdfSpike.stats();
    if (!stats.hasSelectedHighlight) {
      throw new Error('Could not select saved highlight from selection mode');
    }
    return stats;
  })()" >/dev/null
}

click_nth_live_highlight_in_selection_mode() {
  local index="$1"
  local point
  point="$(run_eval "(async () => {
    const statsBefore = window.__pdfSpike.stats();
    if (statsBefore.activeTool !== 'none') {
      throw new Error(\`Expected selection mode before clicking live highlight, got \${statsBefore.activeTool}\`);
    }
    const targets = [...document.querySelectorAll('.highlightEditor.disabled')];
    const target = targets[$index];
    if (!(target instanceof HTMLElement)) {
      throw new Error('Live disabled highlight not found at index $index');
    }
    const rect = target.getBoundingClientRect();
    return {
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    };
  })()")"
  local client_x
  local client_y
  client_x="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientX)')"
  client_y="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientY)')"
  ab mouse move "$client_x" "$client_y" >/dev/null
  ab mouse down left >/dev/null
  ab mouse up left >/dev/null
  ab wait 300 >/dev/null
}

click_first_free_text_in_selection_mode() {
  local point
  point="$(run_eval "(async () => {
    const statsBefore = window.__pdfSpike.stats();
    if (statsBefore.activeTool !== 'none') {
      throw new Error(\`Expected selection mode before clicking free text, got \${statsBefore.activeTool}\`);
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const container = document.querySelector('.pdf-container');
      if (container instanceof HTMLElement) {
        container.scrollTop = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const target = document.querySelector('.page[data-page-number=\"1\"] .freeTextEditor, .page[data-page-number=\"1\"] .freeTextAnnotation');
      if (target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          continue;
        }
        return {
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const dom = [...document.querySelectorAll('.freeTextEditor, .freeTextAnnotation')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.id,
        text: node.textContent?.trim(),
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
      };
    });
    throw new Error(\`Could not find free text editor in selection mode; stats=\${JSON.stringify(window.__pdfSpike.stats())}; dom=\${JSON.stringify(dom)}\`);
  })()")"
  local client_x
  local client_y
  client_x="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientX)')"
  client_y="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientY)')"
  ab mouse move "$client_x" "$client_y" >/dev/null
  ab mouse down left >/dev/null
  ab mouse up left >/dev/null
  ab wait 300 >/dev/null
  run_eval "(() => {
    const stats = window.__pdfSpike.stats();
    if (stats.activeTool !== 'text' || stats.selectedAnnotationKind !== 'freetext') {
      throw new Error(\`Expected selected free text after real click, got tool=\${stats.activeTool} kind=\${stats.selectedAnnotationKind}\`);
    }
    return stats;
  })()" >/dev/null
}

hover_first_free_text_and_assert_no_popup() {
  local point
  point="$(run_eval "(async () => {
    const container = document.querySelector('.pdf-container');
    if (container instanceof HTMLElement) {
      container.scrollTop = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const target = document.querySelector('.page[data-page-number=\"1\"] .freeTextEditor, .page[data-page-number=\"1\"] .freeTextAnnotation');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Could not find free text target for popup test');
    }
    const rect = target.getBoundingClientRect();
    return {
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    };
  })()")"
  local client_x
  local client_y
  client_x="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientX)')"
  client_y="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientY)')"
  ab mouse move "$client_x" "$client_y" >/dev/null
  ab wait 500 >/dev/null
  run_eval "(() => {
    const visiblePopups = [...document.querySelectorAll('.popupAnnotation, .popup')].filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    });
    if (visiblePopups.length > 0) {
      throw new Error(\`Expected no visible FreeText popup, got \${visiblePopups.length}\`);
    }
    return { visiblePopups: visiblePopups.length };
  })()" >/dev/null
}

click_first_ink_in_selection_mode() {
  local point
  point="$(run_eval "(async () => {
    const statsBefore = window.__pdfSpike.stats();
    if (statsBefore.activeTool !== 'none') {
      throw new Error(\`Expected selection mode before clicking ink, got \${statsBefore.activeTool}\`);
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const container = document.querySelector('.pdf-container');
      if (container instanceof HTMLElement) {
        container.scrollTop = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const target = document.querySelector('.page[data-page-number=\"1\"] .inkEditor, .page[data-page-number=\"1\"] .inkAnnotation');
      if (target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight || rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        return {
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
      }
    }
    const dom = [...document.querySelectorAll('.inkEditor, .inkAnnotation')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.id,
        cls: String(node.className),
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
      };
    });
    throw new Error(\`Could not find ink in selection mode; stats=\${JSON.stringify(window.__pdfSpike.stats())}; dom=\${JSON.stringify(dom)}\`);
  })()")"
  local client_x
  local client_y
  client_x="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientX)')"
  client_y="$(JSON_INPUT="$point" node -e 'console.log(JSON.parse(process.env.JSON_INPUT).clientY)')"
  ab mouse move "$client_x" "$client_y" >/dev/null
  ab mouse down left >/dev/null
  ab mouse up left >/dev/null
  ab wait 400 >/dev/null
  run_eval "(() => {
    const stats = window.__pdfSpike.stats();
    if (stats.activeTool !== 'ink' || stats.selectedAnnotationKind !== 'ink') {
      throw new Error(\`Expected selected ink after real click, got tool=\${stats.activeTool} kind=\${stats.selectedAnnotationKind}\`);
    }
    return stats;
  })()" >/dev/null
}

pointerdown_button_label() {
  local label="$1"
  run_eval "(async () => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '$label');
    if (!button) {
      throw new Error('Button not found: $label');
    }
    button.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
    button.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { label: button.textContent?.trim() };
  })()" >/dev/null
}

cleanup() {
  ab close >/dev/null 2>&1 || true
  if [[ -n "$PDF_HTTP_PID" ]]; then
    kill "$PDF_HTTP_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

assert_json_expr() {
  local json="$1"
  local expr="$2"
  local message="$3"
  JSON_INPUT="$json" EXPR="$expr" MESSAGE="$message" node - <<'EOF'
const data = JSON.parse(process.env.JSON_INPUT);
const expr = process.env.EXPR;
const message = process.env.MESSAGE;
const fn = new Function("data", `return (${expr});`);
if (!fn(data)) {
  throw new Error(message);
}
EOF
}

echo "== Open app =="
ab open "$URL" >/dev/null
ab wait --load networkidle >/dev/null
load_pdf_under_test
ab errors --clear >/dev/null
ab console --clear >/dev/null

run_eval '(() => {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const stats = window.__pdfSpike.stats();
  assert(stats.pages > 0, "Sample PDF did not load");
  assert(Boolean(document.querySelector(".viewer-toolbar span")?.textContent?.trim()), "Expected loaded PDF label in toolbar");
  window.__regression = {};
  return { ok: true, pages: stats.pages };
})()' >/dev/null
assert_visible_page_content
HAS_SELECTABLE_TEXT="$(detect_selectable_text)"

echo "== Zoom controls =="
run_eval '(async () => {
  const zoomGroup = [...document.querySelectorAll(".group")]
    .find((node) => node.querySelector(".label")?.textContent?.trim() === "Zoom");
  const buttons = [...(zoomGroup?.querySelectorAll(".toolbar button") ?? [])];
  buttons[2]?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const label = buttons[1]?.textContent?.trim();
  if (!label || label === "Fit Width") {
    throw new Error(`Zoom in failed; label=${label}`);
  }
  return { label };
})()' >/dev/null
run_eval '(async () => {
  const zoomGroup = [...document.querySelectorAll(".group")]
    .find((node) => node.querySelector(".label")?.textContent?.trim() === "Zoom");
  const buttons = [...(zoomGroup?.querySelectorAll(".toolbar button") ?? [])];
  buttons[0]?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  buttons[1]?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const label = buttons[1]?.textContent?.trim();
  if (label !== "Fit Width") {
    throw new Error(`Fit width failed; label=${label}`);
  }
  return { label };
})()' >/dev/null

echo "== Tool switching =="
for tool in "Highlight" "Free text" "Ink" "None"; do
  click_button_label "$tool"
  run_eval "(() => {
    const active = [...document.querySelectorAll('.segmented button.active')].map((node) => node.textContent?.trim());
    if (active.length !== 1 || active[0] !== '$tool') {
      throw new Error(\`Expected active tool $tool, got \${active.join(', ')}\`);
    }
    return { active };
  })()" >/dev/null
done
click_button_label "Ink"
run_eval '(() => {
  const layer = document.querySelector(".annotationEditorLayer.inkEditing");
  if (!(layer instanceof HTMLElement)) {
    throw new Error("Expected ink editing layer for cursor test");
  }
  const cursor = getComputedStyle(layer).cursor;
  if (!cursor.includes(" 1 14,")) {
    throw new Error(`Expected ink cursor hotspot 1 14, got ${cursor}`);
  }
  return { cursor };
})()' >/dev/null
click_button_label "None"

if [[ "$HAS_SELECTABLE_TEXT" == "true" ]]; then
echo "== Highlight create / recolor / delete =="
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const page1Highlights = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  const selectedText = window.__pdfSpike.selectFirstText();
  if (!selectedText) throw new Error("Could not select sample text");
  window.__regression.highlightBaseline = page1Highlights;
  return { page1Highlights, selectedTextLength: selectedText.length };
})()' >/dev/null
click_highlight_swatch "green"
pointerdown_button_label "Highlight Selection"
ab wait 400 >/dev/null
click_saved_highlight_in_selection_mode
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.activeTool !== "highlight") {
    throw new Error(`Expected highlight mode after selecting live highlight, got ${stats.activeTool}`);
  }
  if (stats.selectedHighlightColor !== "green") {
    throw new Error(`Expected green live highlight after create, got ${stats.selectedHighlightColor}`);
  }
  const click_button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "None");
  click_button?.click();
  return stats;
})()' >/dev/null
run_eval '(async () => {
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight.pdf");
  const noneButton = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "None");
  noneButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { ok: true };
})()' >/dev/null
click_saved_highlight_in_selection_mode
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.selectedHighlightColor !== "green") {
    throw new Error(`Expected green live-saved highlight before reload, got ${stats.selectedHighlightColor}`);
  }
  const noneButton = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "None");
  noneButton?.click();
  return stats;
})()' >/dev/null
run_eval '(async () => {
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  if (count !== window.__regression.highlightBaseline + 1) {
    throw new Error(`Expected page-1 highlight count ${window.__regression.highlightBaseline + 1}, got ${count}`);
  }
  return { count };
})()' >/dev/null
click_saved_highlight_in_selection_mode
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.activeTool !== "highlight") {
    throw new Error(`Expected highlight mode after selecting saved highlight, got ${stats.activeTool}`);
  }
  if (stats.selectedHighlightColor !== "green") {
    throw new Error(`Expected green highlight after create, got ${stats.selectedHighlightColor}`);
  }
  return stats;
})()' >/dev/null
run_eval '(async () => {
  document.querySelector("[aria-label=\"Set highlight color to blue\"]")?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight.pdf");
  const noneButton = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "None");
  noneButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight.pdf");
  return { ok: true };
})()' >/dev/null
click_saved_highlight_in_selection_mode
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.selectedHighlightColor !== "blue") {
    throw new Error(`Expected blue highlight after reload, got ${stats.selectedHighlightColor}`);
  }
  return stats;
})()' >/dev/null
run_eval '(async () => {
  if (!window.__pdfSpike.deleteSelected()) {
    throw new Error("Delete selected returned false");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  if (count !== window.__regression.highlightBaseline) {
    throw new Error(`Expected page-1 highlight count ${window.__regression.highlightBaseline} after delete, got ${count}`);
  }
  return { count };
})()' >/dev/null

echo "== Multi live highlight selection =="
load_pdf_under_test
run_eval '(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const selectTextChunk = async (index) => {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const nodes = [];
      for (const layer of document.querySelectorAll(".textLayer")) {
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          if (text.trim().length >= 12) nodes.push(node);
        }
      }
      const node = nodes.find((candidate) => {
        const text = candidate.textContent ?? "";
        return text.trim().length >= 12 + index * 30;
      }) ?? nodes[index] ?? nodes[0];
      if (node) {
        const text = node.textContent ?? "";
        const firstNonSpace = Math.max(0, text.search(/\S/));
        const start = Math.min(text.length - 2, firstNonSpace + index * 30);
        const end = Math.min(text.length, start + 24);
        node.parentElement?.scrollIntoView({ block: "center" });
        await sleep(200);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return text.slice(start, end);
      }
      await sleep(200);
    }
    throw new Error(`Selectable text chunk not found at index ${index}`);
  };
  await selectTextChunk(0);
  await sleep(100);
  document.querySelector("[aria-label=\"Set highlight color to green\"]")?.click();
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Highlight Selection");
  button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1 }));
  button?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0 }));
  await sleep(400);
  await selectTextChunk(1);
  await sleep(100);
  document.querySelector("[aria-label=\"Set highlight color to blue\"]")?.click();
  button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 2, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1 }));
  button?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 2, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0 }));
  await sleep(400);
  return window.__pdfSpike.stats();
})()' >/dev/null
click_nth_live_highlight_in_selection_mode 0
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.activeTool !== "highlight") {
    throw new Error(`Expected highlight mode after selecting older live highlight, got ${stats.activeTool}`);
  }
  if (stats.selectedHighlightColor !== "green") {
    throw new Error(`Expected older live highlight to stay green, got ${stats.selectedHighlightColor}`);
  }
  return stats;
})()' >/dev/null

echo "== Highlight tool create / recolor / delete =="
load_pdf_under_test
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const highlightCount = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  const selectedText = window.__pdfSpike.selectFirstText();
  if (!selectedText) throw new Error("Could not select sample text for highlight tool");
  window.__regression.highlightToolBaseline = highlightCount;
  return { highlightCount, selectedTextLength: selectedText.length };
})()' >/dev/null
click_button_label "Highlight"
click_highlight_swatch "pink"
run_eval '(async () => {
  const created = await window.__pdfSpike.createSelectionHighlightInToolMode();
  if (!created) {
    throw new Error("Highlight tool create helper returned false");
  }
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight-tool.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight-tool.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  if (count !== window.__regression.highlightToolBaseline + 1) {
    throw new Error(`Expected page-1 highlight-tool count ${window.__regression.highlightToolBaseline + 1}, got ${count}`);
  }
  return { count };
})()' >/dev/null
click_saved_highlight_in_selection_mode
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.selectedHighlightColor !== "pink") {
    throw new Error(`Expected pink highlight-tool color after create, got ${stats.selectedHighlightColor}`);
  }
  return stats;
})()' >/dev/null
click_highlight_swatch "yellow"
run_eval '(async () => {
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight-tool.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight-tool.pdf");
  return { ok: true };
})()' >/dev/null
click_button_label "Highlight"
run_eval '(async () => {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const editor = document.querySelector(".page[data-page-number=\"1\"] .highlightEditor");
    if (editor instanceof HTMLElement) {
      editor.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      }));
      editor.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
      }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const stats = window.__pdfSpike.stats();
      if (stats.hasSelectedHighlight) {
        if (stats.selectedHighlightColor !== "yellow") {
          throw new Error(`Expected yellow highlight-tool color after recolor, got ${stats.selectedHighlightColor}`);
        }
        return stats;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Could not reselect highlight-tool highlight after recolor");
})()' >/dev/null
run_eval '(async () => {
  if (!window.__pdfSpike.deleteSelected()) {
    throw new Error("Delete selected returned false for highlight-tool flow");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-highlight-tool.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-highlight-tool.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Highlight").length;
  if (count !== window.__regression.highlightToolBaseline) {
    throw new Error(`Expected page-1 highlight-tool count ${window.__regression.highlightToolBaseline} after delete, got ${count}`);
  }
  return { count };
})()' >/dev/null

else
  echo "== Highlight tests skipped: no selectable text =="
fi

echo "== Free text edit lifecycle =="
load_pdf_under_test
run_eval '(() => {
  const container = document.querySelector(".pdf-container");
  if (container instanceof HTMLElement) {
    container.scrollTop = 0;
  }
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const freeTextCount = page1.annotations.filter((annotation) => annotation.subtype === "FreeText").length;
  window.__regression.freeTextBaseline = freeTextCount;
  return { freeTextCount };
})()' >/dev/null
click_button_label "Free text"
run_eval '(async () => {
  window.__pdfSpike.recolorSelectedFreeText("green");
  await window.__pdfSpike.createPageFreeText("Regression free text", 1);
  const stats = window.__pdfSpike.stats();
  if (stats.freeTextEditors < 1) {
    throw new Error(`Expected at least one free-text editor, got ${stats.freeTextEditors}`);
  }
  return stats;
})()' >/dev/null
run_eval '(async () => {
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  return window.__pdfSpike.stats();
})()' >/dev/null
click_first_free_text_in_selection_mode
run_eval '(async () => {
  const edited = await window.__pdfSpike.editSelectedFreeText("Regression edited free text");
  if (!edited) {
    throw new Error("Free-text edit helper returned false");
  }
  window.__pdfSpike.recolorSelectedFreeText("blue");
  const stats = window.__pdfSpike.stats();
  if (stats.selectedAnnotationKind !== "freetext") {
    throw new Error(`Expected selected free text after edit/recolor, got ${stats.selectedAnnotationKind}`);
  }
  return stats;
})()' >/dev/null
run_eval '(async () => {
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-freetext.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-freetext.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "FreeText").length;
  if (count !== window.__regression.freeTextBaseline + 1) {
    throw new Error(`Expected page-1 free-text count ${window.__regression.freeTextBaseline + 1}, got ${count}`);
  }
  const text = page1.annotations
    .filter((annotation) => annotation.subtype === "FreeText")
    .flatMap((annotation) => annotation.textContent ?? [])
    .join("\\n");
  if (!text.includes("Regression edited free text")) {
    throw new Error(`Expected edited free-text content after reopen, got ${text}`);
  }
  const editedFreeText = page1.annotations.find((annotation) =>
    annotation.subtype === "FreeText" && (annotation.textContent ?? []).join("\\n").includes("Regression edited free text")
  );
  if (!editedFreeText?.rect) {
    throw new Error(`Expected edited free-text rect after reopen, got ${JSON.stringify(editedFreeText)}`);
  }
  window.__regression.freeTextRectAfterEdit = editedFreeText.rect;
  return { count, text, rect: editedFreeText.rect };
})()' >/dev/null
click_first_free_text_in_selection_mode
run_eval '(async () => {
  if (!window.__pdfSpike.moveSelected(40, 30)) {
    throw new Error("Move selected free text returned false");
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-freetext.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-freetext.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const editedFreeText = page1.annotations.find((annotation) =>
    annotation.subtype === "FreeText" && (annotation.textContent ?? []).join("\\n").includes("Regression edited free text")
  );
  const rect = editedFreeText?.rect;
  const before = window.__regression.freeTextRectAfterEdit;
  if (!Array.isArray(rect) || !Array.isArray(before)) {
    throw new Error(`Missing free-text rect after move; before=${JSON.stringify(before)} after=${JSON.stringify(rect)}`);
  }
  const moved = Math.abs(rect[0] - before[0]) > 1 || Math.abs(rect[1] - before[1]) > 1;
  if (!moved) {
    throw new Error(`Expected free-text rect to move after reopen; before=${JSON.stringify(before)} after=${JSON.stringify(rect)}`);
  }
  return { before, rect };
})()' >/dev/null
hover_first_free_text_and_assert_no_popup
click_first_free_text_in_selection_mode
run_eval '(async () => {
  if (!window.__pdfSpike.deleteSelected()) {
    throw new Error("Delete selected free text returned false");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-freetext.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-freetext.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "FreeText").length;
  if (count !== window.__regression.freeTextBaseline) {
    throw new Error(`Expected page-1 free-text count ${window.__regression.freeTextBaseline} after delete, got ${count}`);
  }
  return { count };
})()' >/dev/null

echo "== Ink create / persist =="
load_pdf_under_test
run_eval '(() => {
  const container = document.querySelector(".pdf-container");
  if (container instanceof HTMLElement) {
    container.scrollTop = 0;
  }
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const inkCount = page1.annotations.filter((annotation) => annotation.subtype === "Ink").length;
  window.__regression.inkBaseline = inkCount;
  return { inkCount };
})()' >/dev/null
click_button_label "Ink"
run_eval '(() => {
  window.__pdfSpike.recolorSelectedInk("red");
  window.__pdfSpike.setInkThickness(3);
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(async () => {
  const layer = document.querySelector(".page[data-page-number=\"1\"] .annotationEditorLayer");
  if (!(layer instanceof HTMLElement)) {
    throw new Error("No annotation editor layer for ink test");
  }
  const rect = layer.getBoundingClientRect();
  if (rect.width <= 100 || rect.height <= 100) {
    throw new Error(`Bad annotation editor layer box: ${JSON.stringify(rect)}`);
  }
  const point = (x, y) => ({ clientX: Math.round(rect.x + x), clientY: Math.round(rect.y + y) });
  const dispatch = (type, id, x, y, buttons) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: id,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      ...point(x, y),
    });
    layer.dispatchEvent(event);
  };
  dispatch("pointerdown", 11, 140, 220, 1);
  dispatch("pointermove", 11, 200, 270, 1);
  dispatch("pointermove", 11, 260, 320, 1);
  window.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 11,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 0,
    ...point(260, 320),
  }));
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 400));
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(() => {
  const stats = window.__pdfSpike.stats();
  if (stats.inkEditors < 1) {
    throw new Error(`Expected at least one ink editor, got ${stats.inkEditors}`);
  }
  return stats;
})()' >/dev/null
run_eval '(async () => {
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-ink.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-ink.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Ink").length;
  if (count !== window.__regression.inkBaseline + 1) {
    throw new Error(`Expected page-1 ink count ${window.__regression.inkBaseline + 1}, got ${count}`);
  }
  const inks = page1.annotations.filter((annotation) => annotation.subtype === "Ink");
  const hasThickness3 = inks.some((annotation) => (annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width) === 3);
  if (!hasThickness3) {
    throw new Error(`Expected ink thickness 3 after reopen, got ${JSON.stringify(inks.map((annotation) => annotation.borderStyle))}`);
  }
  const createdInk = inks.find((annotation) => (annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width) === 3);
  if (!createdInk?.rect) {
    throw new Error(`Expected ink rect after reopen, got ${JSON.stringify(createdInk)}`);
  }
  window.__regression.inkRectAfterCreate = createdInk.rect;
  return { count, rect: createdInk.rect };
})()' >/dev/null
click_first_ink_in_selection_mode
run_eval '(async () => {
  if (!window.__pdfSpike.moveSelected(45, 25)) {
    throw new Error("Move selected ink returned false");
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-ink.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-ink.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const inks = page1.annotations.filter((annotation) => annotation.subtype === "Ink");
  const movedInk = inks.find((annotation) => (annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width) === 3);
  const rect = movedInk?.rect;
  const before = window.__regression.inkRectAfterCreate;
  if (!Array.isArray(rect) || !Array.isArray(before)) {
    throw new Error(`Missing ink rect after move; before=${JSON.stringify(before)} after=${JSON.stringify(rect)}`);
  }
  const moved = Math.abs(rect[0] - before[0]) > 1 || Math.abs(rect[1] - before[1]) > 1;
  if (!moved) {
    throw new Error(`Expected ink rect to move after reopen; before=${JSON.stringify(before)} after=${JSON.stringify(rect)}`);
  }
  return { before, rect };
})()' >/dev/null
click_first_ink_in_selection_mode
run_eval '(async () => {
  window.__pdfSpike.recolorSelectedInk("blue");
  window.__pdfSpike.setInkThickness(8);
  const stats = window.__pdfSpike.stats();
  if (stats.selectedAnnotationKind !== "ink") {
    throw new Error(`Expected selected ink after recolor, got ${stats.selectedAnnotationKind}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-ink.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-ink.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const inks = page1.annotations.filter((annotation) => annotation.subtype === "Ink");
  const count = inks.length;
  if (count !== window.__regression.inkBaseline + 1) {
    throw new Error(`Expected page-1 ink count ${window.__regression.inkBaseline + 1} after recolor, got ${count}`);
  }
  const hasBlue = inks.some((annotation) => {
    const color = annotation.color;
    return color && color[0] === 47 && color[1] === 110 && color[2] === 203;
  });
  if (!hasBlue) {
    throw new Error(`Expected blue ink after reopen, got ${JSON.stringify(inks.map((annotation) => annotation.color))}`);
  }
  const hasThickness8 = inks.some((annotation) => (annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width) === 8);
  if (!hasThickness8) {
    throw new Error(`Expected ink thickness 8 after reopen, got ${JSON.stringify(inks.map((annotation) => annotation.borderStyle))}`);
  }
  return { count };
})()' >/dev/null
click_first_ink_in_selection_mode
run_eval '(async () => {
  if (!window.__pdfSpike.deleteSelected()) {
    throw new Error("Delete selected ink returned false");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-ink.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-ink.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "Ink").length;
  if (count !== window.__regression.inkBaseline) {
    throw new Error(`Expected page-1 ink count ${window.__regression.inkBaseline} after delete, got ${count}`);
  }
  return { count };
})()' >/dev/null
click_button_label "Ink"
run_eval '(() => {
  window.__pdfSpike.setInkMarkerPreset();
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(async () => {
  const container = document.querySelector(".pdf-container");
  if (container instanceof HTMLElement) {
    container.scrollTop = 0;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const layer = document.querySelector(".page[data-page-number=\"1\"] .annotationEditorLayer");
  if (!(layer instanceof HTMLElement)) {
    throw new Error("No annotation editor layer for marker ink test");
  }
  const rect = layer.getBoundingClientRect();
  const point = (x, y) => ({ clientX: Math.round(rect.x + x), clientY: Math.round(rect.y + y) });
  const dispatch = (type, id, x, y, buttons) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: id,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      ...point(x, y),
    });
    layer.dispatchEvent(event);
  };
  dispatch("pointerdown", 12, 260, 420, 1);
  dispatch("pointermove", 12, 420, 430, 1);
  dispatch("pointermove", 12, 620, 440, 1);
  window.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 12,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 0,
    ...point(620, 440),
  }));
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 400));
  return window.__pdfSpike.stats();
})()' >/dev/null
run_eval '(async () => {
  window.__pdfSpike.setTool("none");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-ink-marker.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-ink-marker.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const inks = page1.annotations.filter((annotation) => annotation.subtype === "Ink");
  const count = inks.length;
  if (count !== window.__regression.inkBaseline + 1) {
    throw new Error(`Expected page-1 marker ink count ${window.__regression.inkBaseline + 1}, got ${count}`);
  }
  const marker = inks.find((annotation) => {
    const color = annotation.color;
    const thickness = annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width;
    return color && color[0] === 255 && color[1] === 243 && color[2] === 92 && thickness === 14;
  });
  if (!marker) {
    throw new Error(`Expected yellow marker thickness 14 after reopen, got ${JSON.stringify(inks.map((annotation) => ({ color: annotation.color, borderStyle: annotation.borderStyle, opacity: annotation.opacity })))}`);
  }
  if (marker.opacity !== null && Math.abs(marker.opacity - 0.45) > 0.01) {
    throw new Error(`Expected marker opacity 0.45 after reopen, got ${marker.opacity}`);
  }
  return { count };
})()' >/dev/null

run_outline_navigation_test
run_annotation_sidebar_load_timing_test
run_annotation_sidebar_test

ERRORS="$(ab errors)"
CONSOLE_LOGS="$(ab console)"

echo "== Browser errors =="
printf '%s\n' "$ERRORS"
printf '%s\n' "$CONSOLE_LOGS"

if [[ -n "${ERRORS//[[:space:]]/}" && "$ERRORS" != "No page errors." ]]; then
  echo "Page errors detected" >&2
  exit 1
fi

echo "Regression pass complete."
