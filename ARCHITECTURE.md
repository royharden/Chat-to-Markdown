# ARCHITECTURE.md — Chat-to-Markdown

**Sacred design and invariants.** Recon against this file (read the relevant sections and cite them) before any edit to code, tests, parsers, build config, or memory files. If this file and the code disagree, the code is wrong until reconciled here. Changing an invariant requires an ADR in `docs/decisions/`.

## Goal
A Manifest V3 Chromium extension that, on user action, extracts the current conversation from a frontier LLM web UI and writes a high-fidelity Markdown file. Provider priority: ChatGPT, Claude, Gemini, Grok, Meta. Maintained by AI agents; the guardrails are the maintenance process.

## Non-goals (for now)
- Cross-session history or cloud export.
- Editing the conversation or round-tripping Markdown back into the UI.
- Enterprise/self-hosted UIs before the top five.
- Heavy in-extension UI (a save action plus minimal options only).

## Capture principles (invariant)
1. **Structure over beauty.** If the page shows it, the Markdown must retain it: turn roles, code boxes (language + content), thinking/reasoning, sources, tables, lists, emphasis, links.
2. **Capture ⟂ emit.** Parsing (DOM → normalized intermediate representation) is separate from emission (IR → Markdown); each is tested independently.
3. **Robust to churn.** No fragile single selectors. Per-provider strategy plus layered fallbacks (role / attribute / text / landmark). Adversarial DOM tests and golden fixtures enforce this.
4. **Evidence from the page, not assumption.** Reason about capture with explicit traces over the actual (live or fixture) DOM; cite real elements.
5. **Deterministic + replayable.** The same fixture yields the same Markdown. Golden snapshots are the structural contract.
6. **Minimal permissions.** activeTab + scripting + downloads; avoid broad host permissions.
7. **Fidelity is the product.** Output is consumed by other agents, so a silent fidelity regression (dropped thinking, mis-attributed turn) is a real defect, not cosmetic.

## The #1 rot vector: provider DOM drift
Providers will silently change their HTML and break parsers quietly. Defenses: golden DOM fixtures plus golden Markdown snapshots per provider/scenario; structural contract tests; a drift **canary** (`scripts/canary.mjs`) that diffs live DOM against fixtures; a per-provider `lastVerified` date; numeric floors in `floor.json`.

## Tech constraints (recon before changing)
- Manifest V3: service worker + content script(s) + minimal action UI.
- TypeScript strict. Bundler chosen via a spike + ADR (candidates: CRXJS/Vite, Plasmo).
- Tests: Vitest (unit + DOM via jsdom/happy-dom), Playwright/agent-browser for e2e against archived and real pages, normalized structural snapshots for Markdown.
- Windows / OneDrive / PowerShell is the primary dev environment; scripts handle spaces and CRLF (see `typescript-chrome-extension-fix-discipline`).

## Anti-rot invariants (non-negotiable)
- Recon-before-edit with citation.
- Immutable plans; progress only in `_status`.
- Small scoped changes; no second source of truth.
- Bug → regression test with `what_bug_this_catches`.
- Floors in `floor.json`; lowering requires an ADR.
- The gauntlet (hook + CI) is mechanical and never bypassed (`--no-verify` forbidden).
- Skill / instruction changes trigger `sync-skills-across-agents`.

## Evidence base
See `LESSONS.md` for the verified research grounding these invariants (defect persistence, context rot, the amplifier effect, governing context files as code).
