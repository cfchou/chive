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
One open PDF held in the Document Tab Bar; each tab owns its own live pdf.js viewer and Document Session.
_Avoid_: file tab, window tab

**Document Tab Bar**:
The titlebar-area strip of Document Tabs rendered via Tauri overlay; hidden in macOS fullscreen.
_Avoid_: tab strip (that names the sidebar `TabStrip`), titlebar tabs

**Active Document Tab**:
The tab whose Document Session is rendered and receives tool/menu/keyboard actions.
_Avoid_: current tab, focused tab

**Document Session**:
The per-tab runtime unit: pdf.js instances, per-document reactive state, viewer DOM, and caches.
_Avoid_: viewer instance, document state
