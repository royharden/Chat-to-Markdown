# AGENTS.md — Chat-to-Markdown

**The single, tool-neutral source of truth for every agent and harness in this repository** (Claude Code, Codex, Cursor, Grok CLI, and any other). All tool-specific files point here: `CLAUDE.md` imports it, `.cursor/rules/c2m-skills.mdc` points to it, and the `.codex/` / `.grok/` / `.agents/` skill folders are caches of the canonical skills.

**Version:** 1.0.0 — 2026-06-05 · Changelog at the bottom of this file.

---

## 0. The one rule that prevents split-brain

**This repository — `Chat-to-Markdown/` — is the root for ALL harnesses.** Run every agent with this directory as its working root. The parent `C2M/` folder is a workspace wrapper only and holds no live configuration. Never load config or skills from the parent.

## 1. The project

A TypeScript **Manifest V3** Chromium extension that, on user action ("Save Markdown Copy"), converts the on-page conversation of a frontier LLM web UI into a high-fidelity Markdown file for sharing with other agents.

**Provider targets (priority order):** ChatGPT, Claude, Gemini, Grok, Meta.

Maintained almost entirely by AI agents — these guardrails are the primary thing keeping the codebase from rotting. Full design: `docs/c2m-skills-architecture.md`. Capture invariants: `ARCHITECTURE.md`.

## 2. Read first (lean — do not bulk-load history)

1. This file (`AGENTS.md`).
2. `ARCHITECTURE.md` — capture + anti-rot invariants (the recon target).
3. `planning/c2m-manifest.md` — current phase + what to read this phase.
4. The active plan's `_status.md` in `planning/` (if one is in progress).
5. Top of `LESSONS.md`.

Everything else (full plans, reviews, `docs/decisions/`, `docs/c2m-skills-architecture.md`) is read **on demand**, not every session.

## 3. Skills

Canonical source: `C:\Users\Roy Harden\OneDrive\PJ-OD\skills\<name>\SKILL.md`. The repo folders (`.claude/skills`, `.codex/skills`, `.cursor/skills-cursor`, `.grok/skills`, `.agents/skills`) are **mirrors** — never edit a mirror first.

| Skill | Use when |
|---|---|
| `prime-c2m-chat-to-markdown` | Start of any substantive session. |
| `ai-first-persistent-memory-and-planning-framework` | Planning, memory, recon, handoffs, `.agent-work`. |
| `testing-discipline-c2m-chrome-ext` | Before touching capture logic, parsers, emitters, fixtures, snapshots, tests. |
| `typescript-chrome-extension-fix-discipline` | Before commits/pushes; when lint/type/test/web-ext checks fail. |
| `sync-skills-across-agents` | Whenever a skill or instruction file is created/edited/renamed/removed. |
| `repo-analyzer`, `agent-browser` | Architecture spikes; DOM capture / e2e. |

## 4. Storage policy (commit durable, gitignore scratch)

**Committed:** this file, `CLAUDE.md`, `.cursor/rules`, `ARCHITECTURE.md`, `LESSONS.md`, `planning/` (immutable plans + `_status` + manifest + specs), `docs/`, `test/fixtures/` (golden DOM + Markdown), `floor.json`, `scripts/`, `.github/`.
**Gitignored (`.agent-work/`):** draft plans, reviews, raw notes, generated indexes, receipts, local captures.

Committed ≠ auto-loaded: keep the always-on set tiny (§2); commit durable history but read it on demand. Promote a draft/lesson into committed docs only when it is stable.

## 5. Work rules (every change)

- **Recon before edit** — find the canonical path and cite it; if a change would create a second source of truth, consolidate instead.
- **Small, scoped changes** — one logical unit; never an unattended multi-parser sweep.
- **Bug → regression** — every bug becomes a test that fails before / passes after, with `what_bug_this_catches`.
- **Run the gauntlet** — `scripts/gauntlet.ps1` (or `.sh`) before declaring done; the pre-commit hook runs it too. **Never `--no-verify`.**
- **Report** — files changed, checks run, known gaps.
- **Govern this file** — on any change ask: *does this require updating `AGENTS.md` or a skill?* If yes, update it, bump the version, and run `sync-skills-across-agents`.

## 6. Enforcement (mechanical, not optional)

The same gauntlet runs in every harness, in the git pre-commit hook, and in CI (`.github/workflows/ci.yml`): lint, typecheck, tests, golden-snapshot check, manifest/web-ext lint, secret/PII scan, duplication/dead-selector scan. `floor.json` holds per-provider coverage/fixture floors that may only be lowered via an ADR (`docs/decisions/`). Install hooks once: `scripts/setup-hooks.ps1`.

## 7. Cross-harness discovery

| Harness | Instructions | Skills |
|---|---|---|
| Claude Code | `CLAUDE.md` → `AGENTS.md` | `.claude/skills/` |
| Codex | `AGENTS.md` | `.codex/skills/` |
| Cursor | `.cursor/rules/c2m-skills.mdc` → `AGENTS.md` | `.cursor/skills-cursor/` |
| Grok CLI | `AGENTS.md` (repo-root-down scan) | `.grok/skills/` → `.agents/skills/` |

---

## Changelog
- **1.0.0 (2026-06-05):** Initial constitution under the repo-rooted, mechanically-enforced anti-rot architecture. See `docs/decisions/ADR-0001-anti-rot-architecture.md`.
