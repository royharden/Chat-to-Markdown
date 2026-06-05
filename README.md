# Chat-to-Markdown

A TypeScript **Manifest V3** Chromium extension that saves the on-page conversation from frontier LLM web UIs (ChatGPT, Claude, Gemini, Grok, Meta) as a high-fidelity Markdown file for sharing with other agents.

This is an **AI-first** repository: it is built and maintained almost entirely by AI coding agents, with an anti-rot guardrail system as its foundation.

## Start here
- **`AGENTS.md`** — the single source of truth for every agent / harness. Read it first.
- **`ARCHITECTURE.md`** — capture and anti-rot invariants.
- **`docs/c2m-skills-architecture.md`** — how the anti-rot skill architecture works.
- **`planning/c2m-manifest.md`** — current phase and what to read.

## Develop
- Install the git hooks once: `pwsh scripts/setup-hooks.ps1` (or `sh scripts/setup-hooks.sh`).
- Run the quality gauntlet: `pwsh scripts/gauntlet.ps1` (or `sh scripts/gauntlet.sh`).
- Never bypass checks with `--no-verify`.

> No product code exists yet — by design, the guardrail scaffolding comes first.
