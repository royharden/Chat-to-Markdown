# ADR-0001: Repo-rooted, mechanically-enforced anti-rot architecture

**Status:** Accepted
**Date:** 2026-06-05

## Context
Chat-to-Markdown is maintained almost entirely by AI agents across multiple harnesses (Claude Code, Codex, Cursor, Grok CLI). Verified research shows AI-introduced defects persist, reliability degrades as context fills, model upgrades do not pay down security debt, and AI amplifies existing discipline — so the guardrails, not the model, decide whether the codebase rots. Earlier setups split configuration between the parent folder and the repo and relied on advisory skills only.

## Decision
1. **Layout.** The `Chat-to-Markdown/` git repo root is the single root for all harnesses; all harness folders and skills live there; the parent `C2M/` holds no live config. *In the context of multi-harness agent work, facing split-brain config discovery, we root everything at the repo to achieve one source of truth, accepting a one-time consolidation.*
2. **Memory.** Commit durable truth (architecture, lessons, decisions, plans, fixtures); gitignore scratch (`.agent-work/`); committed ≠ auto-loaded (keep the always-on set tiny). *Accepting that some agent work is not version-controlled, in exchange for a lean context and a durable audit trail.*
3. **Enforcement.** Advisory skills PLUS a committed gauntlet wired into a git pre-commit hook AND CI. *Accepting setup cost, to make guardrails mechanical and unskippable as context degrades.*

## Consequences
- Skills describe intent; the gauntlet + hooks + CI decide what actually lands.
- `floor.json` floors may only be lowered via a future ADR.
- The skill set stays deliberately small (lean context). Optional verifier-review patterns are deferred and labeled unproven.
- Full design: `docs/c2m-skills-architecture.md`.
