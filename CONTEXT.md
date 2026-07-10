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
