#!/usr/bin/env bash
set -euo pipefail

SESSION="${SESSION:-pdfspike-regression}"
URL="${URL:-http://127.0.0.1:1420/}"

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
      await new Promise((resolve) => setTimeout(resolve, 100));
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
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
ab errors --clear >/dev/null
ab console --clear >/dev/null

run_eval '(() => {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const stats = window.__pdfSpike.stats();
  assert(stats.pages > 0, "Sample PDF did not load");
  assert(document.querySelector(".viewer-toolbar span")?.textContent === "sample.pdf", "Expected sample.pdf in toolbar");
  window.__regression = {};
  return { ok: true, pages: stats.pages };
})()' >/dev/null

echo "== Zoom controls =="
run_eval '(async () => {
  document.querySelector(".toolbar button:nth-child(3)")?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const label = document.querySelector(".toolbar button:nth-child(2)")?.textContent?.trim();
  if (!label || label === "Fit Width") {
    throw new Error(`Zoom in failed; label=${label}`);
  }
  return { label };
})()' >/dev/null
run_eval '(async () => {
  document.querySelector(".toolbar button:nth-child(1)")?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector(".toolbar button:nth-child(2)")?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const label = document.querySelector(".toolbar button:nth-child(2)")?.textContent?.trim();
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
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
run_eval '(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const selectNeedle = async (needle) => {
    const lower = needle.toLowerCase();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const layers = [...document.querySelectorAll(".textLayer")];
      for (const layer of layers) {
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          const start = text.toLowerCase().indexOf(lower);
          if (start >= 0) {
            node.parentElement?.scrollIntoView({ block: "center" });
            await sleep(200);
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + needle.length);
            const selection = document.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            return;
          }
        }
      }
      window.scrollBy(0, 500);
      await sleep(150);
    }
    throw new Error(`Needle not found: ${needle}`);
  };
  await selectNeedle("DNS lookup");
  await sleep(100);
  document.querySelector("[aria-label=\"Set highlight color to green\"]")?.click();
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Highlight Selection");
  button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1 }));
  button?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0 }));
  await sleep(400);
  await selectNeedle("Establishing a connection");
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
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
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

echo "== Free text create / persist =="
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const freeTextCount = page1.annotations.filter((annotation) => annotation.subtype === "FreeText").length;
  window.__regression.freeTextBaseline = freeTextCount;
  return { freeTextCount };
})()' >/dev/null
click_button_label "Free text"
run_eval '(async () => {
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
  await window.__pdfSpike.saveToPath("/tmp/pdfspike-freetext.pdf");
  await window.__pdfSpike.loadPath("/tmp/pdfspike-freetext.pdf");
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const count = page1.annotations.filter((annotation) => annotation.subtype === "FreeText").length;
  if (count !== window.__regression.freeTextBaseline + 1) {
    throw new Error(`Expected page-1 free-text count ${window.__regression.freeTextBaseline + 1}, got ${count}`);
  }
  return { count };
})()' >/dev/null

echo "== Ink create / persist =="
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
run_eval '(async () => {
  const pages = await window.__pdfSpike.annotationSummary();
  const page1 = pages.find((page) => page.page === 1);
  const inkCount = page1.annotations.filter((annotation) => annotation.subtype === "Ink").length;
  window.__regression.inkBaseline = inkCount;
  return { inkCount };
})()' >/dev/null
click_button_label "Ink"
PAGE_BOX="$(run_eval '(() => {
  const rect = document.querySelector(".page[data-page-number=\"1\"]")?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
})()')"
assert_json_expr "$PAGE_BOX" 'typeof data.x === "number" && typeof data.y === "number" && data.width > 100 && data.height > 100' "Could not read page box for ink test"
START_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 140)));')"
START_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 220)));')"
MID_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 200)));')"
MID_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 270)));')"
END_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 260)));')"
END_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 320)));')"
ab mouse move "$START_X" "$START_Y" >/dev/null
ab mouse down left >/dev/null
ab mouse move "$MID_X" "$MID_Y" >/dev/null
ab mouse move "$END_X" "$END_Y" >/dev/null
ab mouse up left >/dev/null
ab wait 300 >/dev/null
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
  return { count };
})()' >/dev/null

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
