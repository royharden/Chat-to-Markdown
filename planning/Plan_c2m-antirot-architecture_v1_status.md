# Plan Status: C2M Anti-Rot Architecture Bootstrap

**For:** `Plan_c2m-antirot-architecture_v1.md` (immutable). Record everything here.
**Last updated:** 2026-09-24.
**Overall:** Phases 1–4 complete and verified; first commit made (`a4fe66a`, 2026-06-05); follow-up work committed 2026-09-24 (see Receipts).

## Tasks
- [x] Phase 1 — Foundation docs: `AGENTS.md` (v1.0.0), `ARCHITECTURE.md`, `LESSONS.md` (re-grounded), `README.md`, `CLAUDE.md`, `.cursor/rules/c2m-skills.mdc`, `planning/c2m-manifest.md`, this plan + status, `docs/decisions/ADR-template.md` + `ADR-0001`.
- [x] Phase 1 — File ops: `docs/c2m-skills-architecture.md` moved into the repo; parent `C2M/` reduced to redirect pointers + `_archive/`; parent duplicate harness folders removed.
- [x] Phase 2 — 5 canonical skills refined (paths parameterized, gaps closed); mirrored to all five repo harness folders (parity 25/25).
- [x] Phase 3 — Enforcement substrate: `scripts/gauntlet.{ps1,sh}`, `.githooks/pre-commit` + `setup-hooks`, `.github/workflows/ci.yml`, `rot-metrics.mjs`, `canary.mjs`, `floor.json`. Hook installed (`core.hooksPath=.githooks`).
- [x] Phase 4 — Verify: gauntlet PASS (exit 0, all steps SKIP pre-scaffold); 25/25 skill parity; node guardrail scripts run; read-first chain intact.
- [x] Ask the user before the first git commit. Done: first commit `a4fe66a` on 2026-06-05.

## Receipts
- Phases 1–4 complete. Repo carries: constitution + memory (`AGENTS.md`, `ARCHITECTURE.md`, `LESSONS.md`, `README.md`, `CLAUDE.md`), `planning/` (manifest + immutable plan + status), `docs/` (decisions + architecture explainer), `floor.json`, `scripts/`, `.github/`, `.githooks/`, `test/`, gitignored `.agent-work/`, and harness mirrors (`.claude/.codex/.cursor/.grok/.agents`).
- Gauntlet verified exit 0; node v24.14.1 present; git hook active.
- Parent `C2M/` reduced to `.hide`, `_archive/`, `Chat-to-Markdown/`, and `AGENTS.md`/`README.md` redirects.
- Committed: everything above went in as `a4fe66a` (2026-06-05), except `test/` (first committed with the fixtures below) and the gitignored `.agent-work/`.
- 2026-09-24 follow-up commits: AgentNamer adoption and the `skills-bts` canonical-path move (`AGENTS.md` 1.0.1); ADR-0002 (proposed) and `planning/requirements-capture-spec.md` (draft) — both still awaiting user review; 11 golden DOM fixtures under `test/fixtures/` with `floor.json` ratcheted to their real counts. The gauntlet still skips every step (no `package.json`), including the secret/PII scan, so fixtures were checked by hand for private data before publishing.

## Handoff
A fresh agent should read `AGENTS.md` → `ARCHITECTURE.md` → `planning/c2m-manifest.md` → this status → top of `LESSONS.md`, then continue the unchecked tasks.
