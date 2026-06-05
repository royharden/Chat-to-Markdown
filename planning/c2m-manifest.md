# C2M Manifest — current phase

Single source of truth for **what to read first** this phase. The `prime-c2m-chat-to-markdown` skill reads this. Update at each phase change. Paths are relative to the repo root (`Chat-to-Markdown/`).

## Current phase
- **Phase:** Anti-rot foundation (no product code yet).
- **Goal:** Stand up the guardrail system (constitution, memory, skills, enforcement) before the first parser.
- **Next:** A capture spec (`planning/requirements-capture-spec.md`) detailing per-provider elements to preserve, then the extension scaffold and first parser under these guardrails.

## Read first (in order)
1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. This file.
4. Active plan `_status.md` in `planning/` (currently `Plan_c2m-antirot-architecture_v1_status.md`).
5. Top of `LESSONS.md`.

Read on demand only: full plans, `docs/decisions/`, `docs/c2m-skills-architecture.md`, `.agent-work/`.

## Active skills
| Skill | Fires when |
|---|---|
| prime-c2m-chat-to-markdown | Session start. |
| ai-first-persistent-memory-and-planning-framework | Planning, memory, recon, handoffs. |
| testing-discipline-c2m-chrome-ext | Touching capture / parsers / fixtures / snapshots / tests. |
| typescript-chrome-extension-fix-discipline | Commits / pushes; CI fixes. |
| sync-skills-across-agents | Skill / instruction changes. |
| repo-analyzer, agent-browser | Spikes; DOM capture / e2e. |

## Hard gates
- The repo root is the only harness root.
- Commit durable, gitignore `.agent-work/`.
- Gauntlet (hook + CI) green; never `--no-verify`.
- `floor.json` floors lowered only via an ADR.
- Bug → regression test with `what_bug_this_catches`.

## How to update
At each phase change: update Current phase + Read first + Active skills, then run `sync-skills-across-agents` if skills/instructions changed. Do not edit immutable plans; record progress in their `_status`.
