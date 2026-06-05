# C2M Anti-Rot Skills Architecture

This document explains how the skill architecture that protects the **Chat-to-Markdown (C2M)** project against AI-induced code rot is structured and how it operates.

C2M is a TypeScript **Manifest V3** Chromium extension that converts the in-browser conversations of the major frontier LLM web UIs — **ChatGPT, Claude, Gemini, Grok, and Meta** — into high-fidelity Markdown files meant to be shared with other agents. It is built and maintained almost entirely by AI coding agents working from several different harnesses (**Claude Code, Codex, Cursor, Grok CLI**). Because there are effectively no human coders in the maintenance loop, the guardrails described here are the primary thing keeping the codebase coherent over long, largely autonomous runs.

- **Part A** describes the architecture itself.
- **Part B** describes how it differs from the earlier Grok and Codex skill designs.

---

## Part A — How the architecture works

### A.1 Guiding philosophy

Four principles drive every design choice.

1. **Mechanical beats advisory.** Skills describe *what to do and why*. Committed scripts, git hooks, and CI decide *whether it actually happened*. The guardrails that actually block bad code are deterministic and run outside the agent, so they hold even when an agent's judgment degrades deep into a long session.

2. **Lean always-on context.** Agent reliability falls as the context window fills. The material auto-loaded into every session is therefore kept deliberately small. Durable history is committed for audit and reconnaissance, but it is read on demand — never bulk-loaded.

3. **One source of truth, rooted in the repo.** Each piece of knowledge lives in exactly one place. The git repository root is the single root for every harness, and the canonical skills live in one shared directory; every tool-specific copy is a cache.

4. **Defend the real failure mode.** The largest rot risk for this product is external: the chat sites silently change their HTML and the per-provider parsers break *quietly*. The architecture concentrates its strongest defenses — golden fixtures, drift detection, and structural snapshots — at exactly that boundary.

### A.2 The repo is the root

The git repository root, `Chat-to-Markdown/`, is the authoritative root for **all agents and all harnesses**. Every harness runs with that directory as its working root, reads its instructions from files there, and loads its skills from mirror folders there. The surrounding `C2M/` folder is a workspace wrapper only; it holds no live configuration that any agent depends on.

This single fact is baked into every skill: **the repo root is `Chat-to-Markdown/`, never the parent wrapper.**

### A.3 Layout: committed vs gitignored

```
Chat-to-Markdown/                     ← repo root = root for ALL harnesses
│
│  ── committed (durable truth, kept lean) ──
├─ AGENTS.md                 tool-neutral constitution (carries a version + changelog block)
├─ CLAUDE.md                 imports AGENTS.md
├─ .cursor/rules/c2m.mdc     points at AGENTS.md
├─ ARCHITECTURE.md           sacred design + capture invariants (the recon target)
├─ LESSONS.md                append-only, durable lessons (verified citations only)
├─ planning/                 immutable Plan_*.md + their _status.md companions, manifest, specs
├─ docs/decisions/           ADR-NNNN-*.md decision records
├─ test/fixtures/<provider>/ golden DOM samples + golden Markdown snapshots
├─ floor.json                numeric per-provider coverage / fixture floors
├─ scripts/                  gauntlet.ps1, gauntlet.sh, setup-hooks, canary
├─ .github/workflows/        CI gauntlet + rot-metrics
├─ .claude/skills/  .codex/skills/  .cursor/  .grok/skills/  .agents/skills/   ← skill mirrors (caches)
│
│  ── gitignored (scratch, rebuildable) ──
└─ .agent-work/
   ├─ plans/        draft plans before promotion
   ├─ reviews/      critiques, PR-style reviews
   ├─ memory/notes/ raw session notes, lesson candidates
   ├─ memory/index/ generated SQLite / FTS / vector / graph indexes
   ├─ receipts/     command transcripts, diffs
   └─ captures/     local raw DOM grabs
```

**Committed** means durable truth, kept lean enough that an agent can read it without drowning. **Gitignored** means scratch or rebuildable.

**Promotion rule:** work begins in `.agent-work/`. Only when a plan becomes a contract, a lesson proves stable, or a decision is durable is it *promoted* into committed `planning/`, `LESSONS.md`, or `docs/decisions/`. Committing something does not mean it is auto-loaded every session (see A.9).

### A.4 The layered model

The skills and the machinery beneath them form four layers. The top three are what agents read; the bottom layer is what mechanically enforces quality regardless of what any agent reads.

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1 · ORIENTATION                                             │
│  prime-c2m-chat-to-markdown                                        │
│  → run once at session start: establishes repo root, the tiny     │
│    read-first list, the capture contract, and hands off downward.  │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2 · MEMORY & PLANNING "OS"                                  │
│  ai-first-persistent-memory-and-planning-framework                │
│  → recon-before-edit + cite, immutable plans + _status,           │
│    no second source of truth, context-window hygiene, ADRs,       │
│    lessons capture, receipts.                                     │
├──────────────────────────────────────────────────────────────────┤
│  Layer 3 · BUILD DISCIPLINES (per touch)                          │
│  testing-discipline-c2m-chrome-ext                                │
│  typescript-chrome-extension-fix-discipline                       │
│  → test pyramid, golden snapshots, adversarial DOM, coverage      │
│    floors; pre-commit gauntlet, strict types, dependency pinning. │
├──────────────────────────────────────────────────────────────────┤
│  Layer 4 · ENFORCEMENT SUBSTRATE (mechanical, agent-independent)  │
│  scripts/gauntlet · git hooks · GitHub Actions CI · rot-metrics   │
│  · canary drift detection                                         │
│  → the deterministic floor under everything above.                │
└──────────────────────────────────────────────────────────────────┘

   Cross-cutting:  sync-skills-across-agents (keeps Layers 1–3 identical
                   across every harness)
   Utilities:      repo-analyzer, agent-browser (spikes, DOM capture, e2e)
```

The defining property is the **inversion** between Layers 1–3 and Layer 4: the skills *reference* the enforcement substrate, but the substrate does **not** depend on the skills. An agent that ignores every skill still cannot land code that fails the gauntlet.

### A.5 The skills

| Skill | When it fires | What it enforces |
|---|---|---|
| **prime-c2m-chat-to-markdown** | Start of any substantive session | Repo root; a minimal read-first list; the capture contract (providers + what fidelity to preserve); a resume-from-handoff checklist; hand-off to the framework and disciplines. |
| **ai-first-persistent-memory-and-planning-framework** | Planning, memory updates, recon, handoffs | Reconnaissance-before-edit with cited evidence; immutable plans whose progress lives only in a `_status` companion; "stop and consolidate rather than create a second source of truth"; an explicit context-window hygiene policy; a defined ADR convention; lessons capture; receipts for meaningful work. |
| **testing-discipline-c2m-chrome-ext** | Before touching capture logic, parsers, emitters, fixtures, snapshots, or test config | The 5-layer test pyramid; golden DOM + golden Markdown snapshots as behavioral contracts; adversarial DOM mutation cases; a bug becomes a regression case carrying a `what_bug_this_catches` note; numeric per-provider floors in `floor.json`; automated secret/PII scrubbing of fixtures; capture tested independently from the export/download path. |
| **typescript-chrome-extension-fix-discipline** | Before commits/pushes and when lint/type/test/web-ext checks fail | The pre-commit gauntlet; strict TypeScript with guards over `any`/non-null assertions; dependency pinning, lockfile review, `npm audit`, and Manifest V3 API-currency checks; Windows/OneDrive path care; **no `--no-verify`**; scoped, justified suppressions only. |
| **sync-skills-across-agents** | Whenever a skill or an instruction file is created, edited, renamed, or removed | Canonical skill is edited first, then mirrored to every harness folder at the repo root; instruction files updated in lockstep; verification that all mirrors match and that no stray duplicate skill folders exist outside the repo root. |
| **c2m-change-review** *(optional)* | Before merging a parser/emitter change *(if adopted)* | A portable review checklist with **explicit, checkable criteria** (vague criteria cause rubber-stamping). Treated as a helpful-but-unproven aid, not a load-bearing gate. |

Two general utilities round out the set: **repo-analyzer** for architecture spikes and **agent-browser** for driving a real browser to capture provider DOM and run end-to-end tests.

### A.6 The enforcement substrate

A single **gauntlet** is the spine of all mechanical enforcement, and the same script is invoked everywhere — by each harness, by the git hook, and by CI — so "what I run locally" and "what CI runs" can never diverge.

- **`scripts/gauntlet.ps1` and `scripts/gauntlet.sh`** run, in order: lint → strict typecheck → unit tests → DOM/integration tests → golden-snapshot check → web-ext/manifest lint → **secret/PII scan** → duplication & dead-selector scan.
- **A git pre-commit / pre-push hook** (installed by `scripts/setup-hooks`) runs the gauntlet and blocks the commit on any failure. Bypassing it with `--no-verify` is forbidden by policy.
- **GitHub Actions CI** re-runs the *identical* gauntlet on every push and pull request. This is the real floor: it holds even if a local hook is skipped.
- **A rot-metrics reporter** runs in CI as a non-blocking trend: duplication percentage, dead-selector count, coverage drift, and **fixture staleness per provider**.
- **A canary** re-captures live provider DOM on a cadence, diffs its structural signature against the committed golden fixtures, and raises an alert when a provider's UI has drifted — before a user ever hits a broken export.

Because the secret/PII scan is part of the gauntlet, the privacy risk specific to this product — fixtures or captures accidentally carrying real conversation content — is caught mechanically rather than by remembering to check.

### A.7 Cross-harness wiring

Every harness is rooted at the repo and enforced by the same gauntlet. Only the discovery paths differ.

| Harness | Reads instructions from | Loads skills from | Enforced by |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` → imports `AGENTS.md` | `.claude/skills/` | hook + gauntlet + CI |
| **Codex** | `AGENTS.md` | `.codex/skills/` | hook + gauntlet + CI |
| **Cursor** | `.cursor/rules/c2m.mdc` → `AGENTS.md` | `.cursor/` | hook + gauntlet + CI |
| **Grok CLI** | repo-root-down `AGENTS.md` scan | `.grok/skills/` (highest), then `.agents/skills/` | hook + gauntlet + CI |

`AGENTS.md` is the one tool-neutral constitution; every other instruction file points at it rather than restating it. The gauntlet is harness-agnostic, so the *quality bar is identical* no matter which agent or tool is driving.

### A.8 Canonical source and sync

The skills have a single canonical home in the shared `PJ-OD/skills/` directory, outside any individual project. Each skill's `SKILL.md` is edited there first. The **sync-skills-across-agents** skill then mirrors it outward into the repo-root harness folders (`.claude`, `.codex`, `.cursor`, `.grok`, `.agents`) and updates the instruction files together. Mirrors are caches and are never edited directly; if a mirror and the canonical copy disagree, the canonical copy wins. Sync also verifies that no duplicate skill folders exist anywhere except the repo root, so the single-root rule cannot quietly erode.

### A.9 Memory and context model

- **Commit durable, gitignore scratch.** `ARCHITECTURE.md`, `LESSONS.md`, decision records, specs, golden fixtures, `floor.json`, and the immutable plans (and their `_status` companions) are committed. Active scratch plans, reviews, raw notes, generated indexes, and local captures live in gitignored `.agent-work/`.
- **Commit ≠ auto-load.** Durable history is committed for audit and reconnaissance, but the *always-on* context is tiny. The `prime` step loads only the manifest, `AGENTS.md`, `ARCHITECTURE.md`, the active plan's `_status`, and the top of `LESSONS.md`. Everything else — full plans, reviews, historical lessons — is read on demand during reconnaissance. This is how the project keeps a durable "repo as memory" without paying the reliability cost of a bloated context window.
- **Context files are governed like code.** `AGENTS.md` carries a version and a changelog, and the review checklist asks, on every change, *"does this require updating `AGENTS.md` or a skill?"* The constitution evolves deliberately rather than drifting.
- **Lessons are durable, not raw.** A lesson is recorded only when it changes future behavior. Raw observations start in `.agent-work/`; only stable, high-signal conclusions are promoted into `LESSONS.md`, so the committed memory stays small and trustworthy.

### A.10 Lifecycle of a typical change

1. **Prime.** The agent runs `prime`, which orients it to the repo root, the read-first list, and the capture contract, then hands off to the framework.
2. **Recon.** Before editing, the agent identifies the canonical implementation path, checks for competing patterns, and cites the files or docs establishing the rule. If the change would create a second source of truth, it consolidates instead.
3. **Plan.** For anything spanning multiple files or affecting future agents, the agent drafts a plan in `.agent-work/`; once it is a contract, it is promoted to an immutable `planning/Plan_*.md` whose progress is tracked only in the `_status` companion.
4. **Implement.** One scoped logical change at a time, preferring existing patterns, deleting obsolete paths rather than leaving duplicates.
5. **Discipline + gauntlet.** The testing and fix disciplines apply; the agent runs the gauntlet locally. The pre-commit hook runs it again and blocks on failure.
6. **CI.** The identical gauntlet runs in CI on push/PR; rot-metrics update; the canary continues watching for provider drift.
7. **Memory.** The `_status` is updated, durable lessons are promoted to `LESSONS.md`, and any durable decision is recorded as an ADR.
8. **Sync.** If a skill or instruction file changed, sync mirrors it across all harnesses.

### A.11 Defending the product's main rot vector

Because the providers will silently change their HTML, the capture layer gets the heaviest protection:

- **Golden DOM fixtures** freeze real captured HTML per provider and per scenario (plain chat, code blocks with language labels, expandable/collapsed thinking panels, appended sources/citations, tables, multi-turn, regenerated replies).
- **Golden Markdown snapshots** pin the expected output for each fixture. Any diff is either a deliberate, reviewed improvement or a caught regression — and since the output is consumed by other agents, a silent fidelity regression is treated as a real defect.
- **Structural contract tests** assert invariants on the parsed result (every turn has a role; assistant turns may carry thinking; no empty turns; sources resolve), catching the "parser ran but produced garbage" case that a stale snapshot might miss.
- **The canary** detects live provider drift proactively, and each provider parser records the date it was last verified against the live site.
- **`floor.json`** holds numeric per-provider coverage and fixture-count floors that cannot be lowered without a recorded decision.

---

## Part B — How this differs from the Grok and Codex versions

Two earlier skill designs preceded this one: a **Grok** design and a **Codex** design. Both were thoughtful and did real research, and this architecture keeps their best ideas — the persistent-memory-as-repo discipline, the immutable-plan-plus-status pattern, the 5-layer test pyramid, the portable `SKILL.md` standard, and cross-tool sync. The differences below are where this version reconciles their disagreements and extends past both.

### B.1 Enforcement is mechanical, not advisory

This is the biggest difference. Both prior designs expressed their guardrails almost entirely as *skill instructions* — things an agent was asked to follow (recon before edit, run the gauntlet, don't `--no-verify`, add a regression test). Neither shipped a mechanical layer that makes those rules impossible to skip.

This version adds **Layer 4**: a single committed gauntlet wired into a git hook *and* GitHub Actions CI, plus rot-metrics and a drift canary. The research backing the project is blunt that advisory-only guardrails are the wrong bet — AI is an *amplifier* of existing discipline, agent reliability *degrades* as context fills, and defects, once introduced, tend to *persist* rather than get cleaned up. So the load-bearing guardrails were moved out of the agent's discretion and into deterministic machinery that runs the same way for every harness and in CI.

### B.2 The repo root is settled, with no duplicated configuration

The Grok design placed planning, the constitution, and the skill folders at the **parent `C2M/`** level; the Codex design assumed the **`Chat-to-Markdown/` extension repo** was the root. In practice both sets of folders ended up existing at once, which meant an agent could discover a *different* configuration depending on which directory it happened to start in — a split-brain that is itself a rot vector, and a self-contradicting constitution that pointed two different ways within one file.

This version settles it: the **`Chat-to-Markdown/` repo root is the single root for every harness**, all harness folders live only there, and the parent wrapper holds no live config. The rule is baked into every skill so it cannot quietly regrow, and sync actively verifies that duplicate skill folders do not reappear.

### B.3 The memory model is reconciled

The two prior designs disagreed about where agent memory should live. The Grok design leaned toward **committing almost everything** (git-as-memory: durable, auditable, always visible during recon). The Codex design leaned toward **gitignoring everything** under `.agent-work/`, with a rebuildable SQLite/FTS/vector hybrid and a hot/warm/cold retrieval scheme, to keep the committed surface tiny.

This version takes the defensible middle: **commit the durable truth, gitignore the scratch.** Architecture, lessons, decision records, specs, golden fixtures, and the immutable plans are committed for a real audit trail; active scratch, reviews, raw notes, and generated indexes are gitignored and rebuildable. Crucially, it separates *committing* from *auto-loading* — the durable history is committed but only read on demand, which neither prior framing made explicit.

### B.4 Context-rot awareness

Because the Grok instinct was to commit and surface a lot of memory, and the manifests encouraged reading a broad "read-first" list, both prior designs risked growing the always-on context over time. The research finding that reliability *degrades as the context window fills* makes that a direct hazard.

This version makes leanness an explicit rule: `prime` auto-loads only a tiny orientation set, the framework carries a context-window hygiene policy (when to compact, summarize, or start a fresh session), and lessons are promoted into committed memory only when stable. The goal is a small, trustworthy working set with everything else one reconnaissance step away.

### B.5 Closed coverage gaps

Several concrete anti-rot concerns were not covered by either prior design and are now first-class:

- **Proactive DOM-drift detection** — a canary that re-captures live provider DOM and diffs it against golden fixtures, plus a per-provider "last verified" date. (Both prior designs covered fixtures and adversarial tests as *obligations*, but nothing *detected* live drift before a user hit it.)
- **Numeric floors** — a committed `floor.json` with real per-provider coverage and fixture-count numbers, rather than a prose instruction not to lower coverage.
- **Automated secret/PII scrubbing** of fixtures and captures, given the product handles real conversation content.
- **Dependency pinning, lockfile review, `npm audit`, and Manifest V3 API-currency** checks.
- **A defined decision-record convention** (numbered ADRs with a template and a "when required" rule) instead of an undefined "decision note."
- **A resume-from-handoff checklist** for continuation sessions.
- **Gauntlet parity** — one script shared by local runs, the hook, and CI, so the documented checks and the enforced checks are guaranteed to be the same.
- **Path portability** — the repo root is expressed as a rule rather than hard-coded user-specific absolute paths.

### B.6 Verified-citation memory

The earlier `LESSONS.md` was seeded with benchmark claims and citations gathered from social/web research, some of which carry forward-dated identifiers and suspiciously round figures that could not be independently verified. Treating unverified numbers as committed "truth" is itself a form of precedent pollution.

This version keeps the *techniques* (which are sound and widely echoed) but re-grounds the committed memory in independently corroborated sources, and quarantines anything unverifiable as explicitly "directional, unverified" rather than stating it as fact.

### B.7 Honest calibration of unproven patterns

Multi-agent review and verifier-agent patterns appear in both prior designs as recommended practice. The evidence that these *measurably* reduce rot is, at present, weak. This version keeps such a reviewer only as an **optional, clearly-labeled-unproven** aid with explicit checkable criteria, rather than presenting it as a load-bearing guarantee — so the architecture's confidence matches the actual evidence.

### B.8 A deliberately lean skill count

The improvement here is not *more* skills. The core roster stays small — five skills plus two utilities — because a large set of always-relevant skills is itself a context-bloat (and therefore rot) risk. The added robustness comes almost entirely from the mechanical substrate beneath the skills, not from multiplying the skills themselves.
