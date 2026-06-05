# LESSONS.md — Chat-to-Markdown (append-only)

One short section per lesson: Situation → root cause / what surprised → how to codify next time. Append new lessons directly under this header. Promote only stable, behavior-changing lessons here; raw notes live in `.agent-work/memory/notes/`.

---

## Evidence base — why these guardrails exist

Confidence labels and sources are from an independent, adversarially-verified research pass. Treat preprints and vendor research as directional, not exact.

- **AI defects persist; nobody cleans them up.** [High] ~24% of AI-introduced issues survive to repository HEAD, and security defects are the most persistent; AI introduces nearly 2× the security issues it fixes. → Later agents will not clean up after earlier ones; gates must be mechanical and every bug must become a regression test. *(arXiv 2603.28592, large-scale commit study; preprint.)*
- **Context rot is real and general.** [High] Model reliability degrades non-uniformly as the context window fills, even on trivial tasks; *how* information is presented matters more than how much. → Keep the always-on context tiny, read on demand, decompose long runs. *(Chroma "Context Rot"; replicated by arXiv 2510.05381 and 2602.16069.)*
- **A newer/bigger model does not pay down security debt.** [High] Security pass rates have been ~flat (~55%) for two years across model size and recency. → Do not wait for a model upgrade; the gates do the work. *(Veracode 2025/2026; corroborated by arXiv 2506.23034.)*
- **AI is an amplifier.** [High] It magnifies existing engineering discipline or the lack of it. → Guardrails, not the model, are the decisive variable. *(DORA 2025.)*
- **Agent context files are living configuration.** [High] They are edited continuously; govern them like code — version + changelog + a review-checklist item. → `AGENTS.md` carries a version/changelog and the "does this need updating?" rule. *(arXiv 2511.12884, "Agent READMEs".)*
- **Duplication up, consolidation down in the AI era.** [Medium] Copy/paste rose from ~8.3% to ~12.3% of changed lines. → Watch for duplicate parsers/selectors; no second source of truth. *(GitClear 2025; vendor research.)*

**Myths to NOT repeat** (failed adversarial verification): "DORA proved AI hurts delivery" (refuted — only the amplifier framing held); "45% of AI code fails security" (use the ~55% *pass*-rate framing); "context files inevitably become unmaintainable" (they need governance, not a funeral).

## Quarantined / unverified claims (techniques sound, numbers unconfirmed)

Earlier project research cited X-sourced benchmarks — **SlopCodeBench** (arXiv 2603.24755), **SWE-CI** (arXiv 2603.03823), and **Agentic Code Reasoning** (arXiv 2603.01896) — with figures such as "75% of agents break working code," "agent code 2–2.3× worse than human histories," and "semi-formal reasoning ~50% fewer errors." These were **not independently verified** and some identifiers may be confabulated. Keep the *techniques* they motivated (immutable plans, recon-before-edit, deterministic guardrails, golden snapshots) — those are well supported above — but do not cite the specific numbers as fact.

## Sound techniques (adopt regardless of citation)
- Immutable plans as contracts; progress only in `_status`.
- Recon-before-edit with cited evidence; semi-formal traces over the real DOM.
- Small scoped changes; no second source of truth.
- Golden fixtures + golden Markdown snapshots + adversarial DOM cases; bug → regression.
- Deterministic gauntlets (lint / type / test / snapshot / secret-scan) over LLM self-review.
- Persistent repo-as-memory (committed) + fresh-context handoffs; lean always-on context.

## Environment notes (Windows / OneDrive / PowerShell)
- OneDrive paths contain spaces and long prefixes; quote paths, prefer the PowerShell wrappers, watch CRLF/LF. Record reusable path gotchas in `.agent-work/memory/notes/` and promote only stable rules here.

---
**How to use:** prime and the memory framework load the top of this file. When you hit a surprise or a correction, add a section directly under the header.
