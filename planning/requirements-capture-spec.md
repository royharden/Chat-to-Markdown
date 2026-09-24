# Requirements: Capture Spec

Status: draft for user review.
Date: 2026-06-05.
Scope: TypeScript Manifest V3 Chromium extension planning only. No product code exists yet.

## Purpose

Chat-to-Markdown captures the visible conversation in supported frontier LLM web UIs and emits deterministic Markdown for other agents. The product is fidelity, not prettiness: role attribution, code, reasoning/thinking UI, sources/citations, generated artifacts, attachments, lists, tables, headings, emphasis, and links must survive capture.

## Provider URLs

- ChatGPT: <https://chatgpt.com/>
- Claude: <https://claude.ai/>
- Gemini: <https://gemini.google.com/app>
- Grok: <https://grok.com/>
- Meta AI: <https://www.meta.ai/>

Live reconnaissance generated conversation DOM for Gemini, ChatGPT, and signed-in Claude. Claude previously showed Cloudflare verification in `agent-browser` and a Google OAuth login page in the Browser plugin before the user signed in. Grok showed a signup continuation gate after submitting a prompt, and Meta showed a login dialog after submitting a prompt. Those gate states are captured as fixtures, but the parser contract must not treat them as complete provider coverage.

## Normalized IR Contract

Provider parsers return a pure data structure. Emission is a separate pure step.

```ts
interface ChatExport {
  provider: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'meta' | 'fallback';
  capturedAt: string;
  sourceUrl: string;
  title?: string;
  turns: Turn[];
  artifacts: Artifact[];
  warnings: CaptureWarning[];
}

interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
  ordinal: number;
  blocks: MarkdownBlock[];
  thinking?: ThinkingBlock[];
  sources?: SourceRef[];
  attachments?: AttachmentRef[];
  variants?: RegeneratedVariant[];
}

interface MarkdownBlock {
  kind: 'paragraph' | 'heading' | 'list' | 'table' | 'blockquote' | 'code' | 'html' | 'math';
  markdown: string;
  language?: string;
}

interface ThinkingBlock {
  label: string;
  expanded: boolean;
  visibleText?: string;
  status?: string;
}

interface SourceRef {
  label: string;
  url?: string;
  ordinal?: number;
  rawText?: string;
}

interface Artifact {
  id: string;
  kind: 'download' | 'generated-file' | 'canvas' | 'code-file' | 'attachment';
  label: string;
  filename?: string;
  mimeType?: string;
  visibleText?: string;
  downloadUrl?: string;
}
```

## Markdown Output Contract

Output shape:

```md
# <conversation title>

Provider: <provider>
Source: <source URL>
Captured: <ISO timestamp>

---

## Turn 1 - User

...

## Turn 2 - Assistant

...

### Thinking

State: collapsed|expanded
Label: ...
Status: ...

### Sources

1. [label](url)

### Artifacts

- <filename or label> (<kind>)
```

Rules:

- Preserve turn order exactly as rendered in the page.
- Never merge adjacent user and assistant turns.
- Preserve fenced code blocks with language when available; use an empty fence language only when the page does not expose one.
- Preserve inline code separately from fenced code.
- Preserve links as Markdown links with original hrefs.
- Preserve headings, lists, tables, blockquotes, emphasis, and hard line breaks where they are structural.
- Preserve visible reasoning/thinking controls even when collapsed; include expanded visible text only if the page exposes it.
- Preserve generated files/canvas/document affordances as artifacts even if the extension cannot download them in v1.
- Include warnings when a parser falls back, a role is unknown, a turn is partially lazy-loaded, or gated/authenticated DOM blocks capture.

## Provider Requirements

### ChatGPT

Live state observed: <https://chatgpt.com/> generated unauthenticated conversation DOM in the Browser plugin. The separate `agent-browser` CLI session had shown Cloudflare verification, so both a real conversation fixture and an access-gate fixture are retained.

Observed anchors:

- Turn wrappers use `section[data-testid="conversation-turn-N"]`.
- Role evidence appears both as screen-reader labels (`h4.sr-only` with "You said:" / "ChatGPT said:") and inner message nodes with `data-message-author-role="user"` or `data-message-author-role="assistant"`.
- Code responses include visible language labels such as "Python", nearby `button[aria-label="Copy"]`, nested `pre` containers, and a final `code` node with the code text. Parser must extract the real code node and avoid duplicating wrapper `pre` text.
- Math can appear as `<math>` plus adjacent fallback text; parser should prefer preserving a readable Markdown/math representation rather than flattening it into prose.
- Response actions include `button[aria-label="Copy response"]`, `button[aria-label="Share"]`, and sometimes `button[aria-label="Sources"]`.
- Research/file prompts can create a writing block under `data-testid="writing-block-container"` with header/action controls and editable document-like content rather than a downloadable file.
- Web citations can appear as `span[data-testid="webpage-citation-pill"]` wrapping an anchor, e.g. a `pypi.org` source link with a `utm_source=chatgpt.com` URL.
- Sponsored/ad cards can appear near the response area, e.g. `data-testid="image-card-v2"` plus "Sponsored"; parser must exclude them from transcript content unless they are explicitly part of a turn.

Must preserve:

- User turns and assistant turns with stable role markers, not just visual order.
- Code blocks with language labels and copy controls.
- Math blocks or math fallback text.
- Reasoning/thinking UI, including collapsed state, visible summaries, and generated thinking sections when available.
- Search/browse citations and source chips/links.
- Writing blocks, canvas, or generated document side panels as artifacts, including open/edit/copy/download affordances when present.
- Attachments and uploaded files shown in user turns.
- Regenerated assistant variants, including which variant is active.
- Exclusion of ads, login banners, sidebars, and composer UI from captured turns.

Required fixtures before parser work:

- `test/fixtures/chatgpt/code-basic.html` (captured)
- `test/fixtures/chatgpt/research-writing-block-sources.html` (captured)
- `test/fixtures/chatgpt/canvas-or-generated-doc.html`
- `test/fixtures/chatgpt/regenerated-variant.html`

Current additional fixture:

- `test/fixtures/chatgpt/access-gate-cloudflare.html` documents the blocked 2026-06-05 recon state only.

### Claude

Live state observed: <https://claude.ai/> initially showed Cloudflare verification in the `agent-browser` automation session and a Google OAuth login page in the Browser plugin. After user sign-in on 2026-06-08, the Browser plugin reached signed-in Claude chat and captured code plus document-artifact behavior.

Observed anchors:

- New chat URL is `https://claude.ai/new`; generated chats use `https://claude.ai/chat/<uuid>`.
- The signed-in composer is `div[role="textbox"][aria-label="Write your prompt to Claude"][data-testid="chat-input"]`.
- User turns expose an `h2.sr-only` label like "You said: ..." and a message body under `data-testid="user-message"`.
- Assistant turns expose an `h2.sr-only` label like "Claude responded: ...".
- Thinking/reasoning summary appears as a clickable button directly after the assistant role label, with matching `role="status"` text. Example labels: "Identified straightforward educational request requiring clear explanation" and "Synthesized sources and structured markdown documentation".
- Code blocks appear as `div[role="group"][aria-label="<language> code"]` with a visible language token, a `button[aria-label="Copy to clipboard"]`, `pre.code-block__code`, and `code.language-python`.
- Assistant action bars use `role="group"[aria-label="Message actions"]` with buttons such as Copy, Read aloud, feedback, and Retry.
- File upload is exposed as `input[data-testid="file-upload"][aria-label="Upload files"]`; add/connectors affordance is a button with `aria-label="Add files, connectors, and more"`.
- Source links in the assistant response appear as ordinary anchors styled like citation/source tags.
- Generated documents appear as artifact cards with:
  - `button[aria-label="View <document title>"]`
  - visible label `<document title>`
  - visible type `Document · MD`
  - `button[aria-label="Open in Drive"]`
  - `button[aria-label="Download <document title>"]`
- Opening the artifact creates a right-side file/document panel with:
  - `radiogroup[aria-label="File view mode"]`
  - radios "Preview" and "Code"
  - title heading like `<document title> · MD`
  - Open in Drive, Copy, More options, Refresh, and Go back controls
  - rendered Markdown content with footnote references (`#user-content-fn-*`) and backrefs (`#user-content-fnref-*`)

Must preserve:

- User and assistant turns with screen-reader role labels and message bodies.
- Thinking/reasoning summary label and visible status, including collapsed/expanded state if a later UI exposes it.
- Code blocks with `aria-label="<language> code"`, language class, and copy controls.
- Citations/sources from web-enabled responses, including source tag links and footnotes inside artifacts.
- Artifacts/documents, including title, type, visible body, view mode, Open in Drive, Copy, More options, Refresh, Go back, and Download controls.
- Uploaded attachments and attachment summaries in user turns.
- Long conversation virtualization and lazy-loaded prior turns.
- Download button presence; Codex's in-app Browser could not observe the actual browser download event, so parser implementation should use visible artifact controls plus Chrome extension APIs rather than relying on test-time Browser download events.

Required fixtures before parser work:

- `test/fixtures/claude/code-basic.html` (captured)
- `test/fixtures/claude/research-sources.html`
- `test/fixtures/claude/document-artifact.html` (captured as `research-document-artifact.html`)
- `test/fixtures/claude/attachment-turn.html`

Current additional fixtures:

- `test/fixtures/claude/access-gate-cloudflare.html` documents the blocked 2026-06-05 recon state only.
- `test/fixtures/claude/login-google-oauth.html` documents the Browser-plugin login state only.

### Gemini

Live state observed: <https://gemini.google.com/app> allowed unauthenticated prompt submission. A generated code response and a separate research/file prompt were captured.

Observed anchors:

- User turns use a `user-query` custom element with a visually hidden "You said" label and visible `.query-text` / `role="heading"` text.
- Assistant turns use a `model-response` custom element with `message-content`, plus a visually hidden `h2.screen-reader-model-response-label` of "Gemini said".
- Fenced code appears as `pre > code.code-container.formatted[role="text"]` with nearby buttons `aria-label="Download code"` and `aria-label="Copy code"`.
- The visible language may be a text label preceding the `pre` rather than a code class.
- Reasoning/search metadata appears under a `processing-state` custom element. The "Analysis" button carries `aria-expanded`, and expanded state adds `processing-state_container--expanded`; details can include "Query successful". A `thoughts-container` may be present even with no visible thought text.
- Sources can be ordinary anchors under a visible "References & Sources" heading, plus an empty or populated `sources-list` custom element.
- Generated file behavior can appear inside code/result blocks with text such as `file-tag: code-generated-file-...` and "Your Markdown file is ready", with nearby download/copy code controls rather than a separate document panel.

Fixtures captured:

- `test/fixtures/gemini/code-basic.html`
- `test/fixtures/gemini/research-sources-generated-file.html`

Parser requirements:

- Prefer custom elements (`user-query`, `model-response`, `message-content`, `processing-state`, `sources-list`) over volatile Angular classes.
- Use visually hidden labels as role evidence.
- Extract `pre > code` blocks before inline `code` nodes to avoid duplicating inline code as fenced blocks.
- Capture `aria-expanded` from the Analysis control even if no reasoning text is visible.
- Treat `file-tag:` and "Download code" controls as artifact evidence.

### Grok

Live state observed: <https://grok.com/> exposed a textbox "Ask Grok anything" and model selector while unauthenticated. After submitting the synthetic code prompt, it showed "Continue your conversation" and "Sign up for free" instead of an assistant response.

Must preserve once real DOM is captured:

- Prompt and response turns, including whether Grok exposes role labels or only ordered message containers.
- Code blocks and generated files; the gate advertises "Generate files", so file artifacts must be inspected.
- Reasoning/thinking controls, model mode labels such as "Fast", and search/source chips.
- Attachments via the visible Attach control.
- Image/video generation links or generated media if they appear in chat.

Required fixtures before parser work:

- `test/fixtures/grok/code-basic.html`
- `test/fixtures/grok/research-sources.html`
- `test/fixtures/grok/generated-file.html`
- `test/fixtures/grok/attachment-turn.html`

Current fixture:

- `test/fixtures/grok/free-submit-signup-gate.html` documents the 2026-06-05 unauthenticated gate only.

### Meta AI

Live state observed: <https://www.meta.ai/> exposed an input placeholder "Ask Meta AI..." and attachment button while unauthenticated. After submitting the synthetic code prompt, a modal dialog "Log in to Meta AI" blocked conversation output.

Must preserve once real DOM is captured:

- User and assistant turns, including any role labels hidden for screen readers.
- Code blocks and language labels.
- Sources/citations from current-information prompts.
- Attachments via the visible Add attachment control.
- Generated images/video or media cards if chat responses include them.
- Login/gated state as a warning, not as an empty successful capture.

Required fixtures before parser work:

- `test/fixtures/meta/code-basic.html`
- `test/fixtures/meta/research-sources.html`
- `test/fixtures/meta/generated-media-or-file.html`
- `test/fixtures/meta/attachment-turn.html`

Current fixture:

- `test/fixtures/meta/free-submit-login-gate.html` documents the 2026-06-05 unauthenticated gate only.

## Cross-Provider Edge Cases

- Regenerated responses: preserve all discoverable variants and active variant.
- Long conversations: scroll to load prior turns before capture; warn if virtualization prevents complete capture.
- Infinite scroll/lazy loading: capture should attempt deterministic scroll-up loading with a bounded retry count.
- Collapsed reasoning: preserve label and collapsed state even if body text is hidden.
- Expanded reasoning: preserve visible text/status only; never infer hidden chain-of-thought.
- Attachments: include filename, MIME/type label, thumbnail alt text, and relation to the user turn.
- Generated artifacts: include visible document/canvas/file title, available filename, generated text when visible, and download URL only when browser-accessible.
- Tool/search calls: preserve tool labels, status, source links, and any "query successful" metadata.
- Provider gates: emit a warning with provider, URL, and gate text; do not produce an empty transcript as success.
- Shadow DOM/iframes: parser may inspect open shadow roots; closed or cross-origin frames become warnings plus visible accessible text.

## Verification Required Before Build Approval

- Each provider has at least one code fixture, one research/source fixture, and one artifact or attachment fixture before its parser starts.
- Gemini may be the first reference provider because it already has live unauthenticated conversation fixtures.
- ChatGPT, Claude, Grok, and Meta require authenticated/manual live recon before their provider parsers start.
- Every fixture needs a `.meta.json` with `lastVerified`, scenario, privacy note, and `what_bug_this_catches`, plus the `prompt` whenever one was submitted.
- Golden Markdown snapshots must be added with the first parser/emitter implementation, not during this planning-only pass.
