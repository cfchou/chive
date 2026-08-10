import * as pdfjsLib from "/node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";

const query = new URLSearchParams(location.search);
const fixtureName = query.get("fixture");
const scale = Number(query.get("scale"));
if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid scale: ${query.get("scale")}`);
const proofs = await fetch("/artifacts/boxes.json").then((response) => response.json());
const proof = proofs.find((candidate) => candidate.name === fixtureName);
if (!proof) throw new Error(`Unknown fixture: ${fixtureName}`);

document.querySelector("#title").textContent = `${proof.name}: /Rotate ${proof.pageRotation}, scale ${scale}`;
const pdf = await pdfjsLib.getDocument({ url: `/${proof.file}` }).promise;
const pdfPage = await pdf.getPage(1);
const viewport = pdfPage.getViewport({ scale });
document.querySelector(".pdfViewer").style.setProperty("--scale-factor", String(scale));
const pageElement = document.querySelector("#page");
pageElement.style.width = `${viewport.width}px`;
pageElement.style.height = `${viewport.height}px`;
pageElement.style.setProperty("--user-unit", String(viewport.userUnit));

const canvas = document.querySelector("#canvas");
const outputScale = devicePixelRatio || 1;
canvas.width = Math.floor(viewport.width * outputScale);
canvas.height = Math.floor(viewport.height * outputScale);
canvas.style.width = `${viewport.width}px`;
canvas.style.height = `${viewport.height}px`;
const context = canvas.getContext("2d");
await pdfPage.render({
  canvasContext: context,
  viewport,
  transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
}).promise;

const textLayerElement = document.querySelector("#text-layer");
const textLayer = new pdfjsLib.TextLayer({
  textContentSource: pdfPage.streamTextContent(),
  container: textLayerElement,
  viewport,
});
await textLayer.render();

function normalizedRect([x0, y0, x1, y1]) {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

function localRect(element) {
  const rect = element.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();
  return {
    left: rect.left - pageRect.left,
    top: rect.top - pageRect.top,
    right: rect.right - pageRect.left,
    bottom: rect.bottom - pageRect.top,
  };
}

function overlapRatio(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const intersection = width * height;
  const leftArea = (left.right - left.left) * (left.bottom - left.top);
  const rightArea = (right.right - right.left) * (right.bottom - right.top);
  return intersection / Math.min(leftArea, rightArea);
}

const results = [];
for (const span of proof.spans) {
  const viewportRect = normalizedRect(viewport.convertToViewportRectangle(span.normalizedBox));
  const overlay = document.createElement("div");
  overlay.className = "proof-box";
  overlay.dataset.label = span.label;
  overlay.style.left = `${viewportRect.left}px`;
  overlay.style.top = `${viewportRect.top}px`;
  overlay.style.width = `${viewportRect.right - viewportRect.left}px`;
  overlay.style.height = `${viewportRect.bottom - viewportRect.top}px`;
  const label = document.createElement("span");
  label.textContent = `${span.label} raw`;
  overlay.append(label);
  pageElement.append(overlay);

  const textIndex = textLayer.textContentItemsStr.findIndex((text) => text.includes(span.text));
  if (textIndex < 0) throw new Error(`${proof.name}: pdf.js did not expose ${span.text}`);
  const textRect = localRect(textLayer.textDivs[textIndex]);
  const ratio = overlapRatio(viewportRect, textRect);
  if (ratio < 0.45) {
    throw new Error(`${proof.name} ${span.label}: overlap ${ratio.toFixed(3)} is below 0.45`);
  }
  results.push({
    label: span.label,
    overlapRatio: Number(ratio.toFixed(4)),
    viewportBox: viewportRect,
    textBox: textRect,
  });
}

window.coordinateProof = {
  fixture: proof.name,
  pageRotation: pdfPage.rotate,
  pageView: pdfPage.view,
  scale,
  userUnit: viewport.userUnit,
  viewportSize: [viewport.width, viewport.height],
  results,
};
