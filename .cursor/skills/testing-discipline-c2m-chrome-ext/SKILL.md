---
name: testing-discipline-c2m-chrome-ext
description: Use before writing, changing, refactoring, reviewing, or deleting Chat-to-Markdown Chrome extension capture logic, per-provider parsers, turn differentiation, thinking/source extraction, Markdown emission, fixtures, golden snapshots, adversarial DOM cases, the drift canary, coverage floors, or test config. Enforces DOM and Markdown fidelity tests, bug-to-regression coverage with what_bug_this_catches, numeric per-provider floors, fixture secret/PII scrubbing, provider-drift detection, and separation of capture from export.
---

# C2M Chrome Extension Testing Discipline

Protects the feature that matters most: high-fidelity Markdown capture from fragile browser chat UIs.

## Applies to
Provider parsers (ChatGPT, Claude, Gemini, Grok, Meta, fallback); turn differentiation; code/thinking/source/table/list/formatting extraction; the Markdown emitter; golden DOM fixtures, adversarial DOM fixtures, golden Markdown snapshots; tooling (Playwright, agent-browser, Vitest, jsdom/happy-dom, web-ext).

## Test layers
- **L1 unit** — pure parser/emitter functions; no I/O.
- **L2 DOM integration** — archived/synthetic DOM: multi-turn, expanded + collapsed thinking, appended sources, code blocks with language labels.
- **L3 extension/browser** — load the extension, trigger "Save Markdown Copy", verify saved structure.
- **L4 adversarial DOM + golden snapshots** — mutated selectors, UI churn, long conversations, regenerated replies, lazy-loaded turns; normalized snapshots (structure, not whitespace); every case carries `what_bug_this_catches`.
- **L5 live smoke** — real provider pages when available; non-blocking unless the plan says otherwise.

## If you touch X
- A provider parser → run that provider's L1/L2/L4; add/refresh an adversarial fixture if behavior changed; update its `lastVerified`.
- Turn differentiation, thinking, or sources → add a fixture proving roles + sections are preserved (`what_bug_this_catches`).
- The emitter → update normalized golden Markdown snapshots; show code/links/tables/sources stay structurally correct.
- Fallback capture → ≥2 provider-like DOM shapes + 1 mutation; confirm provider-specific parsers still win.
- A bug → a regression case that fails before / passes after, or document why impossible.

## Floors (`floor.json`)
Per-provider `minCoverage` and `minFixtures`, plus `global.minCoverage`. Floors ratchet UP as parsers land; **lowering any floor requires an ADR** in `docs/decisions/`. The gauntlet and CI read `floor.json`.

## Provider drift detection
Each provider's fixtures carry a `lastVerified` date. `scripts/canary.mjs` diffs live DOM against the committed golden signature and flags drift; `scripts/rot-metrics.mjs` reports fixture staleness. Treat a drift alert as a real defect, not noise.

## Privacy (mandatory)
Never store real private conversation content in fixtures — use synthetic or sanitized captures. The gauntlet's secret/PII scan must pass; do not commit a fixture it flags.

## Minimum contract
- Capture is tested independently from the export/download UI.
- Golden snapshots are behavioral contracts.
- No provider parser may silently drop turns, code, thinking, or sources to make a test pass.
- Do not lower coverage, snapshots, or floors without an ADR + a `_status` note.

## Cross-skill
Use `prime-c2m-chat-to-markdown` for scope; `ai-first-persistent-memory-and-planning-framework` for recon/receipts; `typescript-chrome-extension-fix-discipline` for the gauntlet.
