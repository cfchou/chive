# Chive

Chive is a local-first PDF reader and editor for macOS. It stores document changes in the PDF instead of a sidecar file.

The official app uses SvelteKit, Tauri, and pdf.js. The project currently remains in early development.

## Features

- Read local PDF files in a native macOS app.
- Create highlight, free-text, and ink annotations.
- Save annotations into the PDF and retain a `*.bak` backup.
- View Document Outline Entries and create Chive Bookmarks.
- Keep multiple PDFs open as separate Document Tabs.
- Use page context in the AI Chat Sidebar.

The AI Chat Service currently uses a deterministic mock. It does not call a production AI provider.

## Requirements

- macOS
- Node.js 22 and npm
- A stable Rust toolchain
- The [Tauri prerequisites for macOS](https://v2.tauri.app/start/prerequisites/)
- `qpdf` for browser regression tests

## Run the desktop app

Run all app commands from `app/`.

### Development mode

Start the Tauri desktop app with live frontend updates:

```bash
cd app
npm install
npm run tauri -- dev
```

### Packaged app

Build the macOS app bundle:

```bash
cd app
npm install
npm run tauri -- build
```

Open the generated Tauri desktop app:

```bash
open src-tauri/target/release/bundle/macos/chive.app
```

## Run the browser build

Use the browser build for frontend work:

```bash
npm run dev
```

Vite serves the app at <http://127.0.0.1:1430/>. The browser build exposes `window.__pdfSpike` for tests and local development.

## Verify changes

Run the full gate for PDF editor changes:

```bash
cd app
npm run test:unit
npm run check
npm run build
npm run test:e2e
npm run test:native
```

Native verification is required for critical PDF.js behavior. WKWebView can differ from browser test environments.

## Repository map

- [`app/`](app/) contains the official application.
- [`docs/`](docs/) contains the code design and architecture decision records.
- [`spikes/`](spikes/) contains experiments and proofs of concept.
- [`CONTEXT.md`](CONTEXT.md) defines the canonical product language.

Read [`app/README.md`](app/README.md) for app commands and test details. Read [`docs/code-design.md`](docs/code-design.md) for the code map.

## Security

Read [`SECURITY.md`](SECURITY.md) before you report a vulnerability. Do not disclose a vulnerability in a public issue.

## License

Chive uses the [MIT License](LICENSE).
