# Chive

Chive is a local-first PDF reader/editor that keeps user document work in Portable PDF state and exposes it through editor tools and sidebars.

## Language

**Annotation**:
Any user-created mark such as a highlight, free-text annotation, or ink annotation stored in a PDF annotation object.
_Avoid_: overlay, UI mark, sidecar mark

**Annotation Sidebar Entry**:
One row in the annotations tab representing one annotation (persisted or live), used for navigation and selection actions.
_Avoid_: annotation row, annotation item

**Persisted Annotation Sidebar Entry**:
An annotation-sidebar entry that is currently represented by an annotation already saved in the PDF bytes.
_Avoid_: saved row, stored row

**Live Annotation Sidebar Entry**:
An annotation-sidebar entry for annotation state created or modified in the current session before a save/reopen cycle completes.
_Avoid_: temporary row, unsaved annotation

**Document Outline Entry**:
One navigation entry that comes from the opened PDF's document outline.
_Avoid_: bookmark, PDF-native bookmark, TOC row

**Outline Sidebar Entry**:
One row in the outline tab representing a Document Outline Entry.
_Avoid_: outline row, table-of-contents row

**Chive Bookmark**:
An app-created navigation target that is written as a bookmark in the PDF under Chive-managed bookmark space.
_Avoid_: document outline entry, browser bookmark, sidecar bookmark

**Bookmark Sidebar Entry**:
One row in the bookmarks tab representing a Chive Bookmark.
_Avoid_: bookmark row, bookmark list item

**Annotation Focus**:
The temporary on-page visual indicator and selected state when an Annotation Sidebar Entry is located.
_Avoid_: selection rectangle, edit mode

**Annotation Snippet**:
A short text excerpt shown in the annotation sidebar for quick identification.
_Avoid_: comment preview, raw annotation text

**Native Outline Color**:
An optional color carried in PDF outline data for document outlines or Chive Bookmarks.
_Avoid_: app theme color, custom palette override

**Outline Destination**:
The target location a Document Outline Entry (or bookmark) points to; if unresolved, the target is not reliably navigable.
_Avoid_: URL, link target

**Document Tab**:
One open PDF held in the window alongside other open PDFs; the user switches between them without closing any. Each keeps its own reading state and unsaved edits.
_Avoid_: file tab, window tab, sidebar tab

**Active Document Tab**:
The Document Tab whose viewer is shown and which receives tool, menu, and keyboard actions; exactly one is active when any PDF is open.
_Avoid_: current tab, focused tab, selected tab

**Document Tab Bar**:
The strip of Document Tabs in the window's titlebar area (sharing the frame with the macOS traffic lights), plus the button that opens another PDF. Hidden in macOS fullscreen.
_Avoid_: tab strip (that is the sidebar TabStrip), titlebar tabs, tab row

**Document Session**:
The per-tab runtime unit backing a Document Tab: its live pdf.js viewer/document/editor-manager, viewer DOM, annotation caches, and — while inactive — a snapshot of its scalar UI state. Inactive sessions stay alive so their editor undo history survives a tab switch.
_Avoid_: viewer instance, document state, tab model

**Application Settings**:
The app-wide modal surface inside the same Tauri window. It is independent of every Document Session and the Active Document Tab, and changes remain drafts until the user explicitly chooses Save.
_Avoid_: preferences window, settings window, PDF settings

**AI Chat Sidebar**:
The dockable sidebar surface for a conversation about the PDF shown by the Active Document Tab. It renders the active document's AI Chat Session.
_Avoid_: chatbot panel, assistant drawer

**AI Chat Session**:
The per-Document-Session conversation state: the messages, the generation status (idle, generating, or error) with the reply currently streaming in, the unsent AI Chat Composer draft, and the chat panel's scroll position. Created with its Document Session and disposed with it; one document → one session → multiple turns, with no persistence across app launches.
_Avoid_: chat history, thread

**AI Chat Service**:
The UI-facing interface that streams assistant replies for an AI Chat Session, and can be cancelled mid-reply. In M1 its only implementation is a deterministic mock; AI Chat Sidebar components never import an implementation, so a real provider can replace the mock without touching them.
_Avoid_: backend, API client

**AI Chat Message**:
One user or AI-authored message rendered in the AI Chat Sidebar.
_Avoid_: bubble, response card

**AI Chat Context Chip**:
A compact label in the AI Chat Composer that identifies PDF context intended to accompany a message, such as the current page.
_Avoid_: tag, filter chip

**AI Chat Page Citation**:
A keyboard-accessible control attached to an AI Chat Message that navigates the PDF to the page it cites.
_Avoid_: source link, footnote

**AI Chat Composer**:
The text-entry surface at the bottom of the AI Chat Sidebar, including its context and AI configuration controls, file attachment action, and trailing Send or Stop action.
_Avoid_: chat box, prompt field

**Application Settings**:
Typed, non-secret, app-wide configuration that persists across launches independently of PDF document state. The current schema stores only local agent runtime choices and never stores credentials or runtime authentication artifacts.
_Avoid_: preferences blob, config dump, credential store

**Runtime Override**:
An explicit user choice of a supported local agent runtime. When absent, Chive derives the selected runtime from its built-in priority rather than persisting that derived selection.
_Avoid_: auto-select setting, provider, authentication choice

**Executable Override**:
An optional executable path explicitly associated with one supported local agent runtime. When a Runtime Override is also present, both overrides must identify the same runtime.
_Avoid_: PATH setting, command, runtime credentials

**Application Settings Repository**:
The application-level interface that loads and saves validated Application Settings while hiding schema versioning, migrations, and raw storage from Settings UI and runtime discovery callers.
_Avoid_: localStorage wrapper, settings database, config service
