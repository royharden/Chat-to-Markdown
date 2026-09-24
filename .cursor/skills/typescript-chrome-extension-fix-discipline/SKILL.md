---
name: typescript-chrome-extension-fix-discipline
description: Use before committing, pushing, or fixing CI for the Chat-to-Markdown TypeScript Chrome extension, and before or after edits to TypeScript, JavaScript, JSON, YAML, TOML, Markdown snapshots, manifest, build config, dependencies, test config, or scripts. Enforces the shared gauntlet, strict TypeScript, lint/format/test/web-extension checks, dependency pinning and audit, Manifest V3 API currency, Windows/OneDrive path care, scoped suppressions, and no --no-verify.
---

# TypeScript Chrome Extension Fix Discipline

The cheap local hygiene layer for the C2M extension.

## When to run
Before committing/pushing; after changing `.ts/.tsx/.js/.json/.yaml/.toml`, `.md` snapshots, manifest, build/test config, dependencies, or scripts; when any check or CI fails.

## The gauntlet (one script, everywhere)
Run `scripts/gauntlet.ps1` (Windows) or `scripts/gauntlet.sh` (POSIX/CI). It is the SAME script the pre-commit hook and CI run — never maintain a separate local check list. It runs: lint → typecheck → unit → DOM/integration → golden-snapshot → web-ext/manifest lint → secret/PII scan → duplication/dead-selector scan, skipping any step whose tooling isn't scaffolded yet. Install the hook once: `scripts/setup-hooks.ps1`.

## Fix order
1. Reproduce locally.
2. Run auto-fixers first (eslint --fix, prettier, whitespace/EOF).
3. Fix strict TypeScript with guards/narrowing.
4. Re-run the narrow failing command, then the full gauntlet.
5. Record residual risk in `.agent-work/receipts/` or the final summary.

## Preferred fixes
- `any` → `unknown` + type guards.
- Non-null assertions → explicit guards that explain UI drift.
- Remove unused imports rather than hiding them.
- Suppressions one-line, scoped, justified.
- Keep `manifest.json` permissions minimal (activeTab / scripting / downloads).
- Treat golden Markdown snapshot diffs as behavior changes.

## Dependencies & Manifest V3 currency
- Pin versions; commit the lockfile; review lockfile diffs.
- Run `npm audit` (or the project's audit script) and address high/critical findings before shipping.
- Watch for deprecated Manifest V3 / Chrome APIs; a Chrome API change is a drift event — record it in `LESSONS.md`.

## Windows / OneDrive
Quote paths with spaces; prefer the PowerShell wrappers; avoid `~`/`/tmp`/POSIX assumptions; let the formatter normalize CRLF/LF. Record reusable path lessons in `.agent-work/memory/notes/`.

## Do not
- Use `--no-verify`.
- Add broad `eslint-disable`/`@ts-ignore`/casts to force green.
- Change tests to match broken behavior.
- Commit `.agent-work/`, SQLite indexes, vector stores, or local captures.

## Cross-skill
`testing-discipline-c2m-chrome-ext` for test obligations; `ai-first-persistent-memory-and-planning-framework` for receipts/decisions; `sync-skills-across-agents` if this file or instructions change.
