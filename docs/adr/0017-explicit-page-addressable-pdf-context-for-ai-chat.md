# ADR 0017: Give AI Chat Explicit, Page-Addressable PDF Context

Status: Accepted

Date: 2026-07-17

## Context

Issue #37 (A4 on the roadmap) asks: when the user chats with the AI about the
open PDF, how does the AI actually get the document's text, and how do the
AI's answers point back to the right pages?

The issue sets some hard requirements:

- extract text through the active Document Session's pdf.js document
- keep page boundaries and stable source identifiers
- attach message-scoped context (current page, selected text)
- map the AI's source references back to clickable AI Chat Page Citations
- pin an in-flight request to the document it was sent from, so switching
  Document Tabs cannot mix up documents
- handle big PDFs with a clear, predictable size limit — never a silent cut
- say clearly when a page has no extractable text (a scanned page), instead
  of pretending it is an empty page that worked fine
- keep all of this behind an interface that does not care which AI provider
  or runtime sits on the other side

And some things it deliberately does not do: no OCR, no embeddings or vector
database, no AI writing annotations.

Before designing, we looked at how existing products solve this, and studied
two open-source projects in depth. This ADR captures what we found, what we
decided, and what we consciously put off for later.

## Beginner Mental Model

An AI model cannot open a file. It only sees the text you paste into its
prompt. So every "chat with your PDF" feature answers three questions:

1. **Which text from the PDF do we paste in?** All of it? Only the parts
   that look relevant? Only what the user points at?
2. **How do we label that text** so the AI can say "I got this from page 12"
   instead of just asserting things?
3. **When the AI says "page 12", how do we check that and turn it into a
   click that scrolls the viewer there?**

A useful analogy: the AI is a colleague on the phone who cannot see your
screen. You read parts of the document to them, saying "this is from page
12" as you go. When they answer "as it says on page 12...", you can flip to
page 12 and check. If you had read the text *without* saying page numbers,
they could never cite anything better than "somewhere in the middle" — and
you could never verify them.

The whole design question of #37 is: do we say the page numbers while
reading, or not. Everything else follows from that.

## Terms

- Document Session: the per-tab runtime unit for one open PDF (see CONTEXT.md).
- AI Chat Page Citation: the clickable "Page 12" chip on an AI reply.
- AI Chat Context Chip: a label in the composer showing what extra context
  (current page, selected text) rides along with the message.
- Context payload: the document text we serialize and send to the AI.
- Source ID: a stable name for one piece of context (for us: one page),
  e.g. "the source with ID p12". The AI cites IDs; we resolve IDs to pages.
- Extraction: pulling plain text out of the PDF, per page, by reading
  `streamTextContent()` when pdf.js provides it and falling back to
  `getTextContent()` otherwise.
- Normalization: the fixed rules that turn pdf.js's raw text items into one
  deterministic string per page (how spaces and line breaks are joined).
- Snapshot: the frozen copy of context taken at send time, owned by the
  submitting Document Session.
- RAG (retrieval): splitting a document into chunks, indexing them, and
  sending the AI only the chunks that match the question.
- MCP: a standard protocol that lets an AI agent call tools ("read page 3
  for me") instead of receiving everything up front.

## What We Studied

"Chat with a PDF, with page citations" is a well-trodden space. The
approaches cluster into four families:

1. **Retrieval (RAG).** Chunk, index, and retrieve the relevant pieces per
   question (ChatPDF, Humata, Adobe Acrobat AI Assistant). Scales to huge
   documents, but needs indexing infrastructure — which #37 rules out.
2. **Send the whole text, with page markers.** Simple and deterministic
   (Claude.ai / ChatGPT for small files, most local tools). Its classic
   failure modes are silent truncation and made-up page numbers — exactly
   the two things #37's acceptance criteria forbid.
3. **Provider-native citations.** Some APIs (e.g. Anthropic's citations
   feature) accept the PDF and return machine-verified page spans. The most
   rigorous option, but provider-specific — it conflicts with our
   runtime-neutral interface, and our target runtimes (local agent CLIs)
   do not offer it.
4. **Agentic / tool-based.** Give the AI tools like `read_page(n)` and
   `search(query)` and let it pull what it needs. Our planned runtimes
   (Codex CLI, OpenCode, Claude Code) are agents and all speak MCP, so this
   looked like the natural endgame at first — until we weighed its
   dependency costs against family 5 (see the deferred list, where we now
   lean firmly toward family 5).
5. **Environment / workspace exploration.** Hand the agent a (possibly
   sandboxed) environment where the document lives as ordinary files — one
   text file per page, a manifest, maybe the PDF itself — and let it bring
   its own tools: read, grep, run code, spawn sub-agents over slices. This
   is the "recursive language models" (RLM) idea: the context never passes
   through the prompt at all; it sits in the environment as data the model
   examines programmatically, recursing into sub-model calls when a slice
   deserves full attention. Note the difference from family 4: there, chive
   defines the verbs (the tools); here, chive defines only the nouns (the
   files), and the agent's own toolkit supplies the verbs. Our planned
   runtimes are natively built for exactly this — exploring a directory is
   their home turf, arguably more native to them than a custom MCP surface.

We then dissected two real projects:

**llm-for-zotero** (a large Zotero AI plugin). It never records page numbers
at extraction time — its chunks carry no page field at all. As a direct
consequence, it cannot cite pages from metadata. Instead it invented a
clever but expensive workaround: the AI must echo pre-approved verbatim
quotes by ID, and when the user clicks a citation, the plugin *searches the
whole PDF live* to rediscover which page the quote is on — with a cache and
fuzzy matching to make that bearable, and no way at all to represent "this
page is a scan with no text". Its scheme has real virtues (a verbatim quote
is self-verifying in a way a page number is not; span-level highlighting is
a nicer target than a page), but the lazy page rediscovery is pure cost that
page-tagged extraction would have avoided. It is the clearest evidence we
found that skipping page attribution up front creates expensive problems
downstream.

**pdf-mcp** (an MCP server born from Claude's 100-page/30MB PDF limits). It
is family 4 done well: ten focused tools, per-page reads with 1-indexed page
numbers on every result, and — most relevant to us — exemplary large-PDF
manners: every truncation is a named field in the result (`truncated`,
`bytes_returned` vs `bytes_available`, a resumable cursor), never a silently
short answer. Its gaps also teach: "this page is image-only" lives in a
separate info call, so an agent reading pages directly gets a silent empty
string; and sub-page citation coordinates were retrofitted late, onto only
some code paths. Same lesson from the other direction: attribution and
explicit failure states must be on every result from day one, or you end up
retrofitting.

**OakReader** (a native macOS AI reader — the closest cousin to chive we
found). It faced our exact provider question and answered it the same way:
its docs reject Anthropic's citations API as "provider-locked; we run
multiple providers", and instead rebuild the same idea at the app layer.
Citable units get stable IDs at index time, the AI cites an ID plus its own
claim sentence, and *the app, not the AI*, resolves the ID to the true page
— keeping the quote only if it verifiably appears in the source text. Their
redesign notes double as a pitfall list for us: "cite everything" prompting
buries the citation that matters; asking for short quotable phrases makes
the AI pick catchy fragments instead of the load-bearing sentence; letting
the AI retype source text fails (referencing is a lookup, not a writing
task); and a fixed character cap once meant "the model only ever saw page
1" of long PDFs — their fix scales the budget with the model's context
window. The same codebase also shows our target anti-patterns live: some
paths mark truncation explicitly while others cut silently, and a page with
no extractable text is handled well at indexing time but silently dropped
from chat context. Silent omission is evidently an easy mistake even for
careful builders — which is why #37 makes the explicit behavior an
acceptance criterion rather than a style preference.

## Decision

For #37 we build **family 2 with family 1's citation discipline**: send
explicit, page-tagged text, sized by a deterministic budget, and treat the
AI's citations as claims to validate — not facts to render.

One framing note before the list. Decisions 1–5 fix the **substrate**: what
context exists, how each piece is named, when it is frozen, and how claims
against it are checked. They hold no matter how context reaches the AI.
Decision 6 keeps the **delivery mode** swappable: a pushed prompt string
today, and later most likely an explorable workspace (family 5) — with
curated tools (family 4) kept only as a fallback — different pipes over the
same substrate.

Concretely:

1. **Pages are the unit, tagged at extraction time.** Extraction produces
   one source per page: `{ id, page, text }`, or `{ id, page,
   unavailableReason }` for a page with no extractable text. The
   "image-only page" fact sits on the page object itself, never in a side
   channel.
2. **Citations reference source IDs, not bare page numbers.** The AI is
   asked to cite source IDs; the session resolves an ID to a page through
   the snapshot. Any reference that does not match a source we actually
   sent is dropped or flagged — never rendered as a live link. This is the
   guard against invented page numbers.
3. **Normalization is a versioned contract.** The rules that turn pdf.js
   text items into a page string are deterministic and written down. If we
   ever change them, the version changes. This matters later: sub-page
   offsets (for span citations) are only meaningful against a fixed
   normalization.
4. **Snapshot at send time, owned by the submitting Document Session.** The
   conversation is pinned to that document no matter what the user does
   meanwhile — switching tabs, editing, saving. While the session is
   alive, the snapshot lives until the generation settles, so late replies
   can still be validated against it. Closing the tab is a different case,
   with a deliberately different outcome: close disposes the whole
   conversation (the established A2/A3 ownership rule), so close must
   atomically cancel extraction and generation *before* pdf.js teardown
   and discard the results. Silence is the specified outcome there — the
   reader of any message is gone. "Explicit unavailable context" is the
   required behavior for the other failure: extraction going wrong while
   the session is still alive (a worker error, an unexpected document
   state). That must show up in the conversation as unavailable context —
   never a crash, never a quietly empty success. The test matrix covers
   both: close during an in-flight extraction (no crash, no late writes),
   and extraction failure during a live session (visible and explicit).
5. **The size limit is explicit, and omission is visible.** Priority order:
   selected text, then the current page, then pages fanning outward from
   it, until the budget is spent. What was left out is reported as data,
   not prose — named fields such as the omitted page ranges — so tests can
   assert it and the UI can show it: pdf-mcp's pattern, applied to a
   pushed payload. The exact policy — the budget unit, what counts against
   it, the ordering when the user has dismissed the current-page chip and
   there is no anchor, and what happens when a single source (a huge
   selection, one enormous page) exceeds the whole budget — is specified
   in the #37 plan as an executable contract, with a defined outcome for
   every one of those edge cases. And it should be simple rather than
   clever: the pushed payload is transitional machinery. The expected
   long-term delivery mode (the workspace, in the deferred list) dissolves
   most of this policy, because nothing is pre-selected there — every page
   is materialized and the agent chooses what to read.
6. **The extractor exposes objects; adapters choose the delivery mode.**
   The extraction module hands out page-addressable sources; what happens
   at the provider seam is the adapter's business. In M1 that means
   serializing them into one prompt string. A later adapter can expose the
   same sources as MCP tools, or write them out as files in a sandboxed
   workspace for an agent to explore — all without touching extraction.
7. **The context contract is stated plainly:** context is document page
   text plus the explicit chips (current page, selected text). Annotations
   and Chive Bookmarks are *not* context in M1. This needs saying because a
   user who types a free-text note mid-conversation may expect the AI to
   see it — it will not, since annotation text is not in the page content
   streams.
8. **Document-derived text is untrusted data, in every delivery mode.** A
   PDF can contain text written to manipulate an AI ("ignore your
   instructions and run..."). Source-ID validation protects citation
   links, but it does nothing to protect the AI's *behavior* — and our
   planned runtimes are agents that can run commands. So this is an
   invariant of every adapter, starting with the M1 prompt serializer:
   document data must be clearly delimited from instructions, and any
   adapter that connects a tool-capable runtime must restrict what that
   runtime may do (its own sandbox or approval mode) before real document
   text ever reaches it. The test suite gains an adversarial fixture: a
   PDF whose page text tries to give the AI orders. Nothing is exploitable
   in M1 — the mock has no tools — but this decision exists so the A5 and
   S-track adapters inherit the requirement instead of rediscovering it as
   an incident.

Two facts about our own codebase make this simpler than it sounds, and the
implementation may rely on them:

- **Saving does not reload the document.** Chive serializes the live pdf.js
  document and writes bytes to disk; the in-memory document is never
  replaced. So the extractor's handle is stable for the whole life of a
  Document Session — the only destruction event is closing the tab.
- **Annotation and bookmark edits do not change extracted text.** The shared
  stream-first text adapter reads the page content streams; annotations live
  in separate objects and bookmarks in outline data. So extracted page text
  is effectively immutable per session, and caching it needs no invalidation
  besides session disposal.

One engineering caveat: extraction shares the pdf.js worker with rendering,
annotation editing, and saving. Extracting many pages in a tight loop could
make editing feel sluggish, so extraction should proceed incrementally. And
"edit + save during an in-flight generation" belongs in the test matrix: the
generation must complete with unchanged context, and the save must succeed.

## Why

- **The evidence says page attribution is cheap now and expensive later.**
  llm-for-zotero skipped it and had to build live quote search, caching,
  and fuzzy matching to claw the pages back; pdf-mcp deferred sub-page
  coordinates and had to retrofit. We own the pdf.js document, so page
  boundaries cost us one stream-first text read per `getPage(n)`, with
  `getTextContent()` only as the compatibility fallback.
- **Chive's constraints make pages the natural unit.** One document per
  conversation, an owned viewer, page-granular citations in the glossary,
  no OCR or reflow tier that would destroy page identity.
- **Validated source IDs are the honest middle ground.** We cannot verify
  that page 12 truly supports a claim (that needs quote-level machinery —
  deferred), but we can verify that page 12 was actually sent. That is the
  same guarantee good RAG products give, without the index.
- **Determinism is what makes this testable.** The payload is a pure
  function of the snapshot: same document, same chips, same budget → same
  bytes. The mock service, unit fixtures, and native WKWebView tests can
  all assert exact behavior.

## What We Deliberately Deferred

These came out of the research as good ideas whose time is not M1. Each one
stays cheap *because* of the decisions above; none blocks #37.

- **Span-level, self-verified citations** (the llm-for-zotero idea, done on
  our terms). The AI echoes verbatim quotes by opaque ID; we verify them
  with a substring check against the cited page's normalized text — cheap
  for us precisely because pages are preserved. Rendering "verified" vs
  "unverified" citations differently, and highlighting the exact span in
  the viewer, is the new work. The prompt protocol belongs with real-engine
  work (A5+), not the mock. OakReader ships a proven version of this whole
  loop — app-side ID resolution, quote containment check, degrade to
  page-only when the quote fails, and a three-tier text matcher for placing
  the highlight — and is the reference implementation to study when this
  item comes up.
- **An explorable workspace for the agent (the RLM direction) — the
  expected path.** Materialize the snapshot as a sandboxed directory (one
  file per page named by page number; a manifest carrying source IDs,
  non-extractable markers, and the normalization version) and spawn the
  runtime inside it, letting it read, grep, and fan sub-agents out over
  slices. This is the natural fit for the S-track CLIs — exploring file
  trees is what those agents do natively — and files are the
  zero-dependency interface: nothing to register in each runtime's config,
  nothing to ship or version, and no channel back into the running app,
  because the snapshot is fully materialized up front. Any agent that can
  read a directory works, including ones that do not exist yet. The
  snapshot literally becomes a directory, which gives session isolation by
  construction. Two things get harder and must be solved before shipping
  it: security (document text is untrusted input, and here it sits next to
  an agent with a shell — the sandbox must confine filesystem and network
  reach), and attribution (nothing structurally forces the agent to cite;
  the manifest contract plus the same chive-side validation — a cited page
  must exist in the manifest or no link is rendered — carries that weight
  instead). Two pdf-mcp patterns carry over to this mode: frame all
  document-derived text as untrusted data (decision 8 already requires
  this everywhere), and make every partial result say explicitly what was
  left out. One trade to record honestly: the workspace dissolves the
  pushed payload's budget-selection problem — nothing is pre-selected, the
  manifest lists every page, so nothing can be silently omitted — but in
  exchange, coverage stops being something chive can guarantee and becomes
  the agent's choice. A lazy agent can read one page and answer about the
  whole document ("the model only ever saw page 1", reborn as a behavioral
  risk instead of a structural bug). The counterweights are the manifest
  declaring the full page count, prompt guidance about coverage, and the
  same citation validation — but it is a softer guarantee than the
  deterministic payload gives, and worth remembering when comparing the
  modes.
- **Agentic / MCP tool surface (the pdf-mcp direction) — considered, and
  as of 2026-07-17 almost certainly not the path.** Tools like `read_page`,
  `search_document`, `get_outline`, scoped to the open Document Session and
  bound to its snapshot. Conceptually clean, and every tool would bottom
  out in the #37 extractor — but the dependency bill rules it out: every
  runtime has its own registration format (per-runtime config glue to
  maintain), the server is a shipped, versioned deliverable of its own,
  and — the hidden cost — an MCP stdio server is spawned as the *agent's*
  child process while the live Document Session lives inside the running
  app, so the server needs a channel back into chive (a local socket or
  port), quietly turning "a few tools" into a small distributed system.
  The workspace gives us nearly everything this would, for none of that
  cost. What would reopen the question: a hard requirement for *live*
  capability with no reasonable file-based equivalent. We could not name
  one — render-on-demand can be pre-materialized for the pages that need
  it, and even future permission-gated write actions (say, AI-proposed
  annotations) have a files answer: the agent writes proposals to an
  outbox file in the workspace, and chive applies them only after user
  review. Until such a requirement appears, this stays on the shelf.
- **Cross-document references.** Chatting across several open PDFs breaks
  the one-session-per-document ownership model, so it is a product decision
  for after M2. Source-ID citations resolved through a snapshot that knows
  its document already point the right way.
- **Annotations and bookmarks as readable context.** A "my highlights"
  chip, or `list_annotations` / `list_bookmarks` tools in the agentic
  future. Reading them is a natural extension; the AI *writing* them stays
  out of scope and would be its own, much more sensitive feature.
- **Document-version-aware source IDs** — only needed if chive ever gains
  page insert/delete/reorder, which would let page numbers dangle. Today it
  cannot, so citations cannot dangle from edits.

## Consequences

Good:

- page citations resolve by lookup, not by searching the PDF at click time
- invented page numbers cannot become live links
- scanned pages are a visible, testable state instead of silent emptiness
- truncation is visible, so "why doesn't the AI know about page 90?" has a
  discoverable answer
- deterministic payloads keep the mock-service testing story from A2/A3
- the same extraction module later backs span citations and the agent
  workspace (and even MCP tools, should that ever be revisited)

Bad:

- page-granular citations only in M1 — no span highlighting, and no proof
  that a cited page truly supports the claim (provenance, not verification)
- whole relevant-window stuffing spends more tokens than retrieval would on
  big documents; the budget bounds cost but discards far-away pages
- the normalization contract adds a maintenance duty: changing how page
  text is joined is a versioned, breaking change, not a refactor
- users must learn that annotations are not context yet (mitigated by
  saying so in the UI rather than hiding it)

## References

- Issue #37 (A4. PDF context and page/source mapping); roadmap issue #33
- llm-for-zotero — https://github.com/yilewang/llm-for-zotero (studied for
  its quote-anchor citations and the cost of pageless extraction)
- pdf-mcp — https://github.com/jztan/pdf-mcp and
  https://blog.jztan.com/how-i-built-pdf-mcp-solving-claude-large-pdf-limitations/
  (studied for tool-surface design and explicit truncation signaling)
- OakReader — https://github.com/oakreader/oakreader (studied for its
  app-side citation resolution — the shipped, provider-neutral version of
  what we defer as span-level citations — and its citation-redesign
  postmortem; caveat: its docs describe more than its code ships, so treat
  it as a design reference, not proof of production behavior)
- Anthropic citations feature (provider-native page_location spans) — the
  design reference for what span-level citations look like when a provider
  does the verification
- Recursive Language Models (Zhang & Khattab, MIT, 2025) — the idea behind
  family 5: keep the long context in an environment (a REPL variable, or
  for us files in a workspace) instead of the prompt, and let the model
  explore it programmatically, recursing with sub-model calls over slices
