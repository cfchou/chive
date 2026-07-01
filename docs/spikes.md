# Spike Backlog

This file tracks follow-up spikes after the PDF annotation persistence spike.

## Done

### PDF annotation persistence

Status: derisked

Goal: prove that app-created annotations can be saved into the PDF itself and reopened in this app and external readers.

Covered:

- highlight selection create/recolor/delete/save/reopen
- highlight tool create/recolor/delete/save/reopen
- free-text create/edit/recolor/move/delete/save/reopen
- ink create/recolor/thickness/move/delete/save/reopen
- marker-style ink save/reopen
- normal text PDFs
- scanned/image-only PDFs
- PDF.js WASM decoder assets for scanned PDFs
- Playwright browser regression coverage
- WDIO Tauri native smoke coverage for WKWebView-only PDF.js behavior

References:

- `docs/adr/0001-use-pdfjs-tauri-for-pdf-annotation-persistence.md`
- `docs/adr/0002-treat-pdfjs-annotation-editor-lifecycle-as-risky.md`
- `docs/adr/0003-bundle-pdfjs-wasm-decoders-for-scanned-pdfs.md`
- `docs/adr/0004-use-browser-regression-harness-for-pdf-spike.md`
- `docs/adr/0006-test-pdfjs-in-native-tauri-webview-not-only-browser.md`
- `docs/adr/0007-add-native-wkwebview-smoke-tests-with-wdio-tauri.md`

### PDF structure and navigation sidebar

Status: derisked

Covered:

- PDF-native outline/table-of-contents extraction
- nested outline rendering
- outline item click navigation
- no-outline empty state
- invalid outline destination handling without breaking valid outline items
- annotation list page ordering and click-to-locate behavior
- sidebar selection sync for app-created and persisted annotations

Deferred:

- thumbnails, including lazy thumbnail rendering for large/scanned PDFs
- PDF-native bookmark write/edit behavior

## Next Candidates

### 1. PDF-native bookmarks

Goal: prove that PDF-native bookmarks can be read, written, and used as navigation targets.

Questions:

- Can we read and eventually write PDF-native bookmarks?
- Can clicking a PDF-native bookmark scroll to the correct page/location?

Success criteria:

- PDF-native bookmarks are read when available
- PDF-native bookmarks can be created or edited when PDF.js/pdf-lib support is enough
- bookmark data persists after save/reopen
- click bookmark item -> PDF scrolls/selects target

Deferred success criteria:

- thumbnail tab renders first N thumbnails lazily

### 2. Reader shell with two dockable sidebars

Goal: prove the main app shell can support left/right sidebars and dockable tabs.

Questions:

- Can each sidebar be toggled independently?
- Can tabs be moved between left and right sidebars?
- Can layout state be persisted locally?
- Does PDF viewport resize correctly when sidebars open/close?

Initial tabs:

- outline
- thumbnails
- annotations
- bookmarks
- AI chat/history placeholder

Success criteria:

- left and right sidebars can both be visible
- each tab can dock left or right
- active tab/focus state is clear
- PDF viewport remains usable at common widths

### 3. Command registry and configurable keybindings

Goal: prove keyboard control can be centralized and later user-configurable.

Core decision:

Use a command registry instead of ad hoc `keydown` handlers.

Example commands:

- `focus.pdf`
- `focus.leftSidebar`
- `focus.rightSidebar`
- `tab.next`
- `tab.previous`
- `pdf.scrollDown`
- `pdf.scrollUp`
- `pdf.halfPageDown`
- `pdf.halfPageUp`
- `pdf.fullPageDown`
- `pdf.fullPageUp`
- `pdf.firstPage`
- `pdf.lastPage`
- `outline.next`
- `outline.previous`
- `outline.expand`
- `outline.collapse`
- `outline.activate`

Default PDF keybindings:

- `j`: small scroll down
- `k`: small scroll up
- `Ctrl-d`: half-page down
- `Ctrl-u`: half-page up
- `Ctrl-f`: full-page down
- `Ctrl-b`: full-page up
- `Space`: full-page down
- `Shift-Space`: full-page up
- `gg`: first page
- `G`: last page
- `h`: horizontal scroll left when zoomed
- `l`: horizontal scroll right when zoomed
- `0`: horizontal start when zoomed
- `$`: horizontal end when zoomed

Default sidebar keybindings:

- `j`: next item
- `k`: previous item
- `Ctrl-d`: half-panel down
- `Ctrl-u`: half-panel up
- `Ctrl-f`: full-panel down
- `Ctrl-b`: full-panel up
- `h`: collapse outline node
- `l`: expand outline node
- `Enter`: activate item
- `gg`: first item
- `G`: last item

Input bypass rules:

- Do not intercept keys while typing in free-text annotations.
- Do not intercept keys while typing in search.
- Do not intercept keys while typing in AI chat.
- Do not intercept keys inside form fields or contenteditable elements.

Success criteria:

- current focus area is visible: PDF, left sidebar, right sidebar, editor/input
- keybindings work through command registry
- command registry supports remapping later
- keybinding conflicts are explicit

### 4. Vim-like PDF text cursor / visual mode

Goal: determine whether keyboard-only PDF text selection is feasible.

Problem:

PDF.js text is rendered as absolutely positioned text layer spans, not as a normal text editor buffer. A Vim-like cursor is not built in.

Options:

- Logical text cursor: build a text model from PDF.js `getTextContent()`, draw custom caret/selection overlays.
- DOM range cursor: create browser `Range` selections over text layer spans.
- Label/region mode: select words or regions using keyboard labels instead of a true text cursor.

Risks:

- text spans can be fragmented or reordered
- pages can be virtualized/unrendered
- multi-page selection is hard
- DOM selection may conflict with PDF.js highlight creation
- scanned PDFs have no text unless OCR exists

Success criteria:

- keyboard can move cursor by character/word/line on rendered page
- visual selection can create a PDF highlight
- selected text can be passed to AI context
- behavior degrades clearly on scanned PDFs

### 5. AI selection-to-chat

Goal: prove selected PDF content can be sent to an AI chat window as explicit context.

This spike does not include RAG. It only covers content the user explicitly selects.

Selection types:

- selected text
- selected page region image
- current page reference
- annotation-linked selection, if available

Questions:

- Can selected text include page number and bounding boxes?
- Can region screenshots be captured from the PDF canvas at useful resolution?
- Can the chat UI show exactly what content will be sent?
- Can responses show source chips such as PDF name, page number, quote, or region?
- Can the provider interface start with OpenRouter without locking the UI to OpenRouter?

Context payload shape:

- PDF document id
- PDF file name/path
- page number
- selected text or image attachment id
- bounding boxes when available
- annotation id when selection came from an annotation
- provider/model used

Initial provider:

- OpenRouter

Success criteria:

- selected text can be sent to AI chat with page citation
- selected page region image can be sent to AI chat
- chat response shows source chips
- user can see what PDF content is about to be uploaded
- no vector DB or document-wide indexing required

### 6. AI document RAG and artifact storage

Goal: prove whole-document AI questions and persistent AI artifacts can work without weakening PDF portability.

This spike starts after selection-to-chat works. It covers whole-document and longer-term AI memory behavior.

RAG scope:

- extract/index document text
- chunk text with page references
- embeddings/vector search
- retrieve chunks for whole-document questions
- answer with page citations

Central AI artifact storage scope:

- chat history
- selected context payloads
- generated summaries
- extracted text chunks
- embedding metadata
- provider/model metadata
- prompt/result metadata
- deletion/export behavior

Questions:

- What is the stable document id: PDF fingerprint, path, hash, or a combination?
- How does history survive file rename or move?
- Which AI artifacts are app-local and which, if any, are written into the PDF?
- How are embeddings invalidated when a PDF changes?
- Can storage remain portable without becoming a Zotero-style central library requirement?
- How does the user delete all AI data for a document?

Likely storage decision:

- user annotations persist inside the PDF
- chat history, summaries, embeddings, and AI context payloads remain app-local
- do not write chat history into the PDF by default

Success criteria:

- whole-document question can retrieve relevant chunks
- answer cites page numbers
- chat history persists across app restart
- AI artifacts can be deleted for one document
- storage model does not require importing PDFs into a central library

### 7. AI table/context extraction

Goal: determine how much table-like PDF content can be extracted before using OCR or vision models.

Questions:

- Can PDF.js text items be grouped into rows/columns reliably?
- How often do tables appear only as images?
- Should table selection become a region image first?
- When should we send a cropped image to a vision-capable model instead of attempting local table parsing?

Success criteria:

- selected table-like text can become markdown/CSV for simple digitally generated PDFs
- image-only tables fall back to region image context
- limitations are explicit in UI and docs

### 8. Large PDF performance

Goal: prove app remains usable on large documents.

Test PDFs:

- 500+ pages text PDF
- 500+ pages scanned PDF
- PDF with many annotations
- PDF with large images

Questions:

- How much memory do thumbnails consume?
- How many pages can remain rendered?
- Does annotation extraction need lazy paging?
- Does search/indexing need a worker?

Success criteria:

- app opens large PDF without freeze
- thumbnails load lazily
- navigation remains responsive
- annotation/sidebar data can load progressively

### 9. Colored outline/bookmarks

Goal: decide whether colored outline is app-local metadata or portable PDF metadata.

Questions:

- Can PDF.js read outline item color if present?
- Can PDF.js write outline item color back into PDF?
- Do external readers preserve/display outline colors?
- If not portable, is app-local outline coloring enough?

Likely direction:

- Treat outline colors as app metadata first.
- Do not make portable colored PDF outline P0 unless PDF.js write support is proven.

Success criteria:

- outline items can display color in app
- color state can be persisted app-locally
- portability decision is documented
