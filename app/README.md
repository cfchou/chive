# Chive

Official Chive PDF editor implementation.

`pdf-annotation-spike/` remains the reference implementation for de-risking. Do not edit the spike when changing this app unless the task explicitly asks for spike work.

## Runtime

- SvelteKit SPA for Tauri (`ssr = false`, static adapter fallback).
- Vite dev server is pinned to `http://127.0.0.1:1440/`.
- Vite HMR client port is pinned to `1441`.
- Tauri dev URL is pinned to `http://localhost:1440`.
- PDF.js owns `.page` DOM. Keep route assumptions browser-side.

## Commands

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 1440
npm run check
npm run build
npm run test:unit
npm run test:e2e
npm run test:native
npm run test:regression
npm run tauri -- dev
npm run tauri -- build
```

When touching UI or type-level code, run `npm run check` before `npm run build`.

## PDF Behavior Notes

- `src-tauri/src/lib.rs` owns local filesystem reads/writes through Tauri commands.
- `write_pdf_atomic` writes through a hidden temp file, atomically renames, and keeps `*.bak`.
- `src/routes/+page.svelte` keeps the transplanted PDF.js integration, debug API, save pipeline, annotation lifecycle, outline/bookmark behavior, and bookmark rail geometry.
- `src/lib/pdf/colors.ts` owns the shared row palette for outline rows and bookmarks. Bookmark creation defaults to red; choosing default clears native `/C`.
- Browser tests do not fully prove WKWebView behavior. Run `npm run test:native` for critical PDF.js text extraction, annotation, bookmark, or save-flow changes.

## Reference Inputs

- UI reference: `../tmp/index.html`
- UI spec: `../tmp/ui-spec.md`
- Transplant plan: `../tmp/transplant-plan.md`
- Reference app: `../pdf-annotation-spike/`
