---
name: prime-c2m-chat-to-markdown
description: Use at the start of any session that will plan, build, test, review, or modify the C2M Chat-to-Markdown Chrome extension. Establishes the repo root as the single harness root, the lean read-first list, the committed-docs versus gitignored .agent-work policy, provider priorities, capture-fidelity requirements, a resume-from-handoff checklist, and which anti-rot skills to load next.
---

# Prime — C2M Chat-to-Markdown

Run once at the start of a substantive C2M session.

## Repo root
`Chat-to-Markdown/` is the root for ALL harnesses; run here. The parent `C2M/` folder is a wrapper with no live config — never load config or skills from it.

## Read first (lean — do not bulk-load history)
1. `AGENTS.md` (repo root).
2. `ARCHITECTURE.md` — capture + anti-rot invariants.
3. `planning/c2m-manifest.md` — current phase + read-first list.
4. The active plan's `_status.md` in `planning/` (if any).
5. Top of `LESSONS.md`.

Read on demand only: full plans, `docs/decisions/`, `docs/c2m-skills-architecture.md`, `.agent-work/`.

## Resume from a handoff (continuation session — first 5 minutes)
1. Open the active `_status.md`; read its Handoff section and the unchecked tasks.
2. Read only the files that handoff names.
3. Re-run recon on the exact area you'll touch and cite it — do not trust stale memory.
4. Confirm the gauntlet is green before building on prior work (`scripts/gauntlet.ps1`).
5. Continue the next unchecked task; do not restart finished ones.

## Capture priorities
Providers (priority): ChatGPT, Claude, Gemini, Grok, Meta. Markdown must preserve: user vs model turns; code blocks (language + content); thinking/reasoning (including collapsed); sources/citations/links; lists, tables, headings, emphasis, links. **Structure fidelity beats pretty output**, and the output is consumed by other agents — a silent fidelity loss is a real defect.

## Skill chain
1. `ai-first-persistent-memory-and-planning-framework` — planning, memory, recon, handoffs.
2. `testing-discipline-c2m-chrome-ext` — before capture/parser/emitter/fixture/test changes.
3. `typescript-chrome-extension-fix-discipline` — before commits/pushes or CI fixes.
4. `sync-skills-across-agents` — whenever skills or instruction files change.

## Session rules
- Recon before edits; keep changes small and scoped.
- No duplicate parser/emitter strategies as a shortcut.
- Agent-only notes in `.agent-work/`; promote only stable truth to committed docs.
- Run the gauntlet before done; never `--no-verify`.
- Report files changed, checks run, and gaps.
