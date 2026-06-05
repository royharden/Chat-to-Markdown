# Plan: C2M Anti-Rot Architecture Bootstrap

**Level:** Whole · **Status file:** `Plan_c2m-antirot-architecture_v1_status.md` (all progress/receipts there).
**Immutable:** This file is the contract. Never edit it; record execution only in the status companion.

## Objective
Stand up the complete anti-AI-code-rot guardrail system for Chat-to-Markdown — repo-rooted and mechanically enforced — before any product code.

## Locked decisions (see ADR-0001)
1. Memory: commit durable, gitignore scratch (`.agent-work/`).
2. Enforcement: skills + git hooks + CI gates.
3. Layout: the `Chat-to-Markdown/` repo root is the single root for all harnesses; no parent duplication.

## Scope / phases
1. **Foundation** — repo-rooted constitution (`AGENTS.md` with version + changelog), `ARCHITECTURE.md`, re-grounded `LESSONS.md`, manifest, this plan + status, ADR template + ADR-0001, README.
2. **Skills** — refine the 5 canonical skills (parameterize paths; close gaps: context-window hygiene, ADR convention, resume-from-handoff, floor.json, secret/PII scrub, drift canary, dependency pinning, gauntlet parity, repo-root-only sync); mirror to the repo harness folders.
3. **Enforcement substrate** — `scripts/gauntlet.{ps1,sh}`, pre-commit hook + `setup-hooks`, `.github/workflows/ci.yml`, `rot-metrics`, `canary`, `floor.json`; all tolerant of the no-product-code state.
4. **Verify** — simulate a fresh prime read; confirm cross-harness parity; run the gauntlet (graceful skips); record the handoff.

## Success criteria
- Single repo-rooted source of truth; no parent harness duplication; no contradictory instructions.
- 5 refined skills in canonical + repo mirrors; no hard-coded user paths in skill bodies.
- Gauntlet runs identically in hook + CI and exits clean today.
- `LESSONS.md` grounded in verified sources; shaky claims quarantined.

## What we do NOT do
- Write extension / product code.
- Edit this immutable plan.
- Push to any remote (local commits only, and only on the user's request).

## Verification
Read back every artifact; list the repo tree; run the gauntlet; confirm a fresh agent would orient correctly from the manifest's Read-first list.
