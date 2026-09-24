# ADR-0002: Extension Tooling and Module Boundaries

Status: proposed for user review.
Date: 2026-06-05.

## Context

Chat-to-Markdown needs a small Manifest V3 Chromium extension with strict TypeScript, deterministic tests, minimal permissions, and parser/emitter boundaries that can survive provider DOM churn. The existing guardrail substrate expects npm scripts named `lint`, `typecheck`, `test`, `webext:lint`, `scan:secrets`, and `scan:dupes` to activate checks as soon as product code is scaffolded.

The main tooling options considered for the scaffold are CRXJS/Vite and Plasmo.

## Decision

Use CRXJS with Vite, strict TypeScript, Vitest, and jsdom/happy-dom for the initial scaffold. Do not use Plasmo for v1.

Use this module boundary:

- `content-script`: reads the current page DOM and calls the selected provider parser.
- `capture/*`: provider parsers convert DOM to normalized IR only.
- `emit/*`: Markdown emitter converts normalized IR to Markdown only.
- `service-worker`: owns extension action handling, activeTab/scripting injection, and downloads.
- `shared/*`: IR types, provider detection, warnings, and fixture helpers.

Use this MV3 layout:

- Permissions: `activeTab`, `scripting`, `downloads`.
- Host permissions: none in v1 unless an ADR adds them.
- Extension action: "Save Markdown Copy".
- Content script: injected on user action rather than always-on broad host matching.
- Download: service worker creates a Markdown blob/data URL and calls the Downloads API.

## Rationale

CRXJS/Vite keeps the extension scaffold close to standard Vite and Chrome MV3 primitives. That makes the build transparent for future agents, keeps permissions explicit, and avoids framework-specific abstractions around content scripts and service workers before the product needs them.

Plasmo is attractive for faster extension ergonomics, but its conventions add another layer future agents must learn and debug. The current project risk is parser fidelity and test discipline, not UI complexity. A minimal CRXJS/Vite scaffold better matches the anti-rot architecture.

The capture/emit split follows `ARCHITECTURE.md`: DOM parsing and Markdown emission must be independently testable. Provider-specific parsers should never write files or call extension APIs, and the emitter should never query live DOM.

## Consequences

- The scaffold phase must add `package.json`, a lockfile, `manifest.json`, Vite config, strict `tsconfig`, Vitest config, ESLint/Prettier config, and the scripts expected by `scripts/gauntlet.ps1`.
- Golden DOM fixtures and Markdown snapshots become regular test inputs, not extension runtime assets.
- The first provider parser can be developed as a pure library before the browser download flow exists.
- If CRXJS/Vite cannot support MV3 service worker output cleanly after the scaffold spike, a replacement requires a new ADR.
