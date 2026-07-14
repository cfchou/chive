import { expect, test } from "./coverage";

async function resizeRightSidebarTo(page: import("@playwright/test").Page, targetWidth: number) {
  const resizer = page.locator('.sidebar[data-side="right"] .sidebar-resizer');
  const box = await resizer.boundingBox();
  if (!box) throw new Error("Right sidebar resizer has no bounding box");
  const currentWidth = await page
    .locator('.sidebar[data-side="right"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - (targetWidth - currentWidth), startY, { steps: 8 });
  await page.mouse.up();
}

test("AI Chat opens on the right with the completed static fixture", async ({ page }) => {
  await page.goto("/");

  const tab = page.getByRole("tab", { name: "AI Chat" });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");

  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("What is the main argument?", { exact: true })).toBeVisible();
  await expect(panel.getByText("The document argues", { exact: false })).toBeVisible();
  const pageCitation = panel.getByRole("button", { name: "Page 3" });
  await expect(pageCitation).toBeVisible();
  await expect(pageCitation).toHaveCSS("border-radius", "8px");
  const currentPage = panel.getByRole("button", {
    name: "Remove Current page context; use whole document",
  });
  await expect(currentPage).toBeVisible();
  await expect(currentPage).toHaveCSS("border-radius", "8px");

  await expect(panel.getByRole("button", { name: "Summarize this PDF" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Explain the current page" })).toHaveCount(0);

  await expect(panel.getByRole("textbox", { name: "Message AI Chat" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("AI Chat fixtures expose empty, generating, and error examples", async ({ page }) => {
  await page.goto("/?aiChatFixture=empty");
  let panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await expect(panel.getByText("Ask about this PDF", { exact: true })).toBeVisible();

  await page.goto("/?aiChatFixture=generating");
  panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await expect(panel.getByRole("status")).toHaveText("Generating example response…");
  await expect(panel.getByRole("button", { name: "Stop generating" })).toBeVisible();

  await page.goto("/?aiChatFixture=error");
  panel = page.getByRole("tabpanel", { name: "AI Chat" });
  await expect(panel.getByRole("alert")).toHaveText("The example response could not be generated.");
  await expect(panel.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("AI Chat input context can be removed to use the whole document", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const removeContext = panel.getByRole("button", {
    name: "Remove Current page context; use whole document",
  });

  await expect(removeContext).toBeVisible();
  await removeContext.click();

  await expect(panel.getByText("Current page", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Message AI Chat" })).toHaveAttribute(
    "placeholder",
    "Ask about this PDF",
  );
});

test("AI Chat composer exposes configuration and file actions below the message input", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("tabpanel", { name: "AI Chat" });
  const composer = panel.getByLabel("AI Chat composer");
  const textarea = panel.getByRole("textbox", { name: "Message AI Chat" });
  const actions = composer.getByLabel("Composer actions");
  const provider = actions.getByRole("button", { name: "Change provider: OpenAI" });
  const model = actions.getByRole("button", { name: "Change model: GPT-5" });
  const effort = actions.getByRole("button", { name: "Change effort: Medium" });
  const messageActions = actions.getByLabel("Message actions");
  const addFiles = messageActions.getByRole("button", { name: "Add files" });
  const send = messageActions.getByRole("button", { name: "Send message" });

  await expect(provider).toBeVisible();
  await expect(model).toBeVisible();
  await expect(effort).toBeVisible();
  await expect(addFiles).toBeVisible();
  await expect(send).toBeVisible();

  const [composerBox, textareaBox, actionsBox, providerBox, addFilesBox, sendBox] = await Promise.all([
    composer.boundingBox(),
    textarea.boundingBox(),
    actions.boundingBox(),
    provider.boundingBox(),
    addFiles.boundingBox(),
    send.boundingBox(),
  ]);
  if (!composerBox || !textareaBox || !actionsBox || !providerBox || !addFilesBox || !sendBox) {
    throw new Error("Missing AI Chat composer geometry");
  }
  expect(actionsBox.y).toBeGreaterThanOrEqual(textareaBox.y + textareaBox.height - 1);
  expect(Math.abs(providerBox.y + providerBox.height / 2 - (sendBox.y + sendBox.height / 2))).toBeLessThanOrEqual(2);
  expect(sendBox.x).toBeGreaterThan(addFilesBox.x);
  expect(Math.abs(composerBox.x + composerBox.width - (sendBox.x + sendBox.width) - 8)).toBeLessThanOrEqual(2);

  const chipWidths = await Promise.all([provider, model, effort].map((chip) => chip.evaluate((element) => element.getBoundingClientRect().width)));
  expect(chipWidths).toEqual([72, 72, 72]);
  await expect(model).toHaveCSS("border-radius", "8px");
  await expect(model.locator(".configuration-chip-label")).toHaveCSS("text-overflow", "ellipsis");
  await expect(actions.getByLabel("AI configuration")).toHaveCSS("overflow-x", "auto");
});

test("AI Chat composer stays usable at supported widths and caps at one-third of the panel", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator('.sidebar[data-side="right"]');
  const panel = page.locator('.sidebar[data-side="right"] #panel-ai-chat');
  const composer = panel.getByLabel("AI Chat composer");
  const textarea = panel.getByRole("textbox", { name: "Message AI Chat" });

  for (const width of [260, 600]) {
    await resizeRightSidebarTo(page, width);
    await expect.poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(width);

    const initial = await panel.evaluate((element) => {
      const composerElement = element.querySelector<HTMLElement>('[aria-label="AI Chat composer"]');
      const textareaElement = element.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message AI Chat"]');
      if (!composerElement || !textareaElement) throw new Error("Missing composer elements");
      const lineHeight = Number.parseFloat(getComputedStyle(textareaElement).lineHeight);
      return {
        panelClientWidth: element.clientWidth,
        panelScrollWidth: element.scrollWidth,
        composerHeight: composerElement.getBoundingClientRect().height,
        textareaHeight: textareaElement.getBoundingClientRect().height,
        lineHeight,
      };
    });
    expect(initial.panelScrollWidth).toBeLessThanOrEqual(initial.panelClientWidth);
    expect(initial.textareaHeight).toBeGreaterThanOrEqual(initial.lineHeight * 2 - 1);
    expect(initial.composerHeight).toBeGreaterThan(initial.textareaHeight + 28);
  }

  await textarea.fill(Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n"));
  const grown = await panel.evaluate((element) => {
    const composerElement = element.querySelector<HTMLElement>('[aria-label="AI Chat composer"]');
    const textareaElement = element.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message AI Chat"]');
    if (!composerElement || !textareaElement) throw new Error("Missing composer elements");
    return {
      panelHeight: element.getBoundingClientRect().height,
      composerHeight: composerElement.getBoundingClientRect().height,
      textareaClientHeight: textareaElement.clientHeight,
      textareaScrollHeight: textareaElement.scrollHeight,
      overflowY: getComputedStyle(textareaElement).overflowY,
    };
  });
  expect(Math.abs(grown.composerHeight - grown.panelHeight / 3)).toBeLessThanOrEqual(4);
  expect(grown.textareaScrollHeight).toBeGreaterThan(grown.textareaClientHeight);
  expect(grown.overflowY).toBe("auto");
  await expect(composer).toBeVisible();
});
