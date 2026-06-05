#!/usr/bin/env node
// =============================================================================
// canary.mjs — provider DOM-drift canary (STUB, Node ESM).
// -----------------------------------------------------------------------------
// EVENTUAL JOB (once per-provider parsers exist):
//   1. Capture the LIVE DOM of each supported chat provider (ChatGPT, Claude,
//      Gemini, Grok, Meta) — e.g. via a headless browser against a known
//      conversation, or against a recorded HAR.
//   2. Compute a STRUCTURAL SIGNATURE of that DOM (a stable hash over the
//      tag/role/landmark skeleton and the selectors the parser depends on —
//      NOT over volatile text content).
//   3. DIFF that signature against the committed GOLDEN signature stored beside
//      the provider's fixtures.
//   4. ALERT on drift: a changed signature means the provider shipped a layout
//      change that may have silently broken capture — the canary is the early
//      warning that fires before users notice missing/garbled exports.
//
// TODAY this is a stub: there are no parsers and no live capture wired up. It
// reads the provider list from floor.json, walks test/fixtures/<provider>/ to
// report each fixture's lastVerified age, then states that live capture is not
// yet wired. It performs NO network I/O and ALWAYS exits 0.
//
// No external dependencies — Node stdlib only.
// =============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const FLOOR_PATH = join(REPO_ROOT, 'floor.json');
const FIXTURES_ROOT = join(REPO_ROOT, 'test', 'fixtures');

const NL = '\n';

function readJsonSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

console.log('============================================================');
console.log(' CANARY (provider DOM-drift — STUB)');
console.log(` repo root: ${REPO_ROOT}`);
console.log('============================================================');

const floor = readJsonSafe(FLOOR_PATH);
const providers = floor && floor.providers ? Object.keys(floor.providers) : [];

if (providers.length === 0) {
  console.log(NL + 'no providers found in floor.json (nothing to canary yet)');
} else {
  for (const provider of providers) {
    console.log(NL + `[${provider}]`);
    const dir = join(FIXTURES_ROOT, provider);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      line('fixtures', 'none yet');
      continue;
    }
    let metaFiles = [];
    try {
      metaFiles = readdirSync(dir).filter((f) => f.endsWith('.meta.json'));
    } catch {
      metaFiles = [];
    }
    if (metaFiles.length === 0) {
      line('fixtures', 'none yet');
      continue;
    }
    for (const f of metaFiles) {
      const meta = readJsonSafe(join(dir, f));
      const age = meta ? daysSince(meta.lastVerified) : null;
      line(f, age === null ? 'lastVerified: unknown' : `lastVerified ${age}d ago`);
    }
  }
}

console.log(NL + '------------------------------------------------------------');
console.log(' live capture not yet wired (awaiting parsers)');
console.log(' -> see top-of-file comment for the eventual capture/diff job.');
console.log('============================================================');

process.exit(0);
