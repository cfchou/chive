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

echo "== Free text edit lifecycle =="
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
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
  return { count, text };
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
ab find role button click --name "Load Sample" >/dev/null
ab wait --text "How Modern Browsers Work" >/dev/null
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
  const inks = page1.annotations.filter((annotation) => annotation.subtype === "Ink");
  const hasThickness3 = inks.some((annotation) => (annotation.borderStyle?.rawWidth ?? annotation.borderStyle?.width) === 3);
  if (!hasThickness3) {
    throw new Error(`Expected ink thickness 3 after reopen, got ${JSON.stringify(inks.map((annotation) => annotation.borderStyle))}`);
  }
  return { count };
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
PAGE_BOX="$(run_eval '(() => {
  const container = document.querySelector(".pdf-container");
  if (container instanceof HTMLElement) {
    container.scrollTop = 0;
  }
  const rect = document.querySelector(".page[data-page-number=\"1\"]")?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
})()')"
START_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 260)));')"
START_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 420)));')"
MID_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 420)));')"
MID_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 430)));')"
END_X="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.x + 620)));')"
END_Y="$(JSON_INPUT="$PAGE_BOX" node -e 'const data = JSON.parse(process.env.JSON_INPUT); process.stdout.write(String(Math.round(data.y + 440)));')"
ab mouse move "$START_X" "$START_Y" >/dev/null
ab mouse down left >/dev/null
ab mouse move "$MID_X" "$MID_Y" >/dev/null
ab mouse move "$END_X" "$END_Y" >/dev/null
ab mouse up left >/dev/null
ab wait 300 >/dev/null
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
