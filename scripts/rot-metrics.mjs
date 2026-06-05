#!/usr/bin/env node
// =============================================================================
// rot-metrics.mjs — NON-BLOCKING anti-rot observability report (Node ESM).
// -----------------------------------------------------------------------------
// Prints a snapshot of "code rot" indicators so drift is visible long before it
// becomes a failure. This is a REPORT, not a gate: it ALWAYS exits 0 and never
// blocks CI or commits (the blocking gate is scripts/gauntlet.sh).
//
// Metrics (each degrades gracefully to "no data yet" when its input is absent):
//   - duplication %        : from a future scripts/scan-dupes.mjs report.
//   - dead-selector count  : DOM selectors with zero fixture matches.
//   - coverage drift       : current coverage vs. floor.json minCoverage.
//   - fixture staleness     : per-provider days since each
//                            test/fixtures/<provider>/*.meta.json lastVerified.
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
// Optional machine-readable inputs a future toolchain may emit. Absent today.
const DUP_REPORT = join(REPO_ROOT, '.agent-work', 'metrics', 'duplication.json');
const DEAD_SELECTORS_REPORT = join(REPO_ROOT, '.agent-work', 'metrics', 'dead-selectors.json');
const COVERAGE_SUMMARY = join(REPO_ROOT, 'coverage', 'coverage-summary.json');

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
  const ms = Date.now() - then;
  return Math.floor(ms / 86_400_000);
}

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

console.log('============================================================');
console.log(' ROT METRICS (non-blocking observability)');
console.log(` repo root: ${REPO_ROOT}`);
console.log('============================================================');

// --- duplication % -----------------------------------------------------------
console.log(NL + '[duplication]');
{
  const dup = readJsonSafe(DUP_REPORT);
  if (dup && typeof dup.percentage === 'number') {
    line('duplication %', `${dup.percentage.toFixed(2)}%`);
  } else {
    line('duplication %', 'no data yet (awaiting scripts/scan-dupes.mjs)');
  }
}

// --- dead-selector count -----------------------------------------------------
console.log(NL + '[dead selectors]');
{
  const dead = readJsonSafe(DEAD_SELECTORS_REPORT);
  if (dead && Array.isArray(dead.selectors)) {
    line('dead-selector count', String(dead.selectors.length));
  } else if (dead && typeof dead.count === 'number') {
    line('dead-selector count', String(dead.count));
  } else {
    line('dead-selector count', 'no data yet (awaiting scripts/scan-dupes.mjs)');
  }
}

// --- coverage drift ----------------------------------------------------------
console.log(NL + '[coverage drift]');
{
  const floor = readJsonSafe(FLOOR_PATH);
  const cov = readJsonSafe(COVERAGE_SUMMARY);
  const floorMin =
    floor && floor.global && typeof floor.global.minCoverage === 'number'
      ? floor.global.minCoverage
      : null;

  // Istanbul-style coverage-summary.json: total.lines.pct, etc.
  let current = null;
  if (cov && cov.total && cov.total.lines && typeof cov.total.lines.pct === 'number') {
    current = cov.total.lines.pct;
  }

  if (current === null) {
    const floorStr = floorMin === null ? 'unknown' : `${floorMin}%`;
    line('current coverage', 'no data yet (awaiting coverage run)');
    line('floor minCoverage', floorStr);
    line('drift vs floor', 'no data yet');
  } else {
    line('current coverage', `${current}%`);
    line('floor minCoverage', floorMin === null ? 'unknown' : `${floorMin}%`);
    if (floorMin === null) {
      line('drift vs floor', 'no floor set');
    } else {
      const drift = current - floorMin;
      const sign = drift >= 0 ? '+' : '';
      line('drift vs floor', `${sign}${drift.toFixed(2)} pts`);
    }
  }
}

// --- per-provider fixture staleness -----------------------------------------
console.log(NL + '[fixture staleness]');
{
  const floor = readJsonSafe(FLOOR_PATH);
  const providers =
    floor && floor.providers ? Object.keys(floor.providers) : [];

  if (!existsSync(FIXTURES_ROOT)) {
    line('fixtures root', 'no data yet (test/fixtures/ absent)');
  } else if (providers.length === 0) {
    line('providers', 'no data yet (floor.json has no providers)');
  } else {
    for (const provider of providers) {
      const dir = join(FIXTURES_ROOT, provider);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        line(provider, 'no fixtures yet');
        continue;
      }
      let metaFiles = [];
      try {
        metaFiles = readdirSync(dir).filter((f) => f.endsWith('.meta.json'));
      } catch {
        metaFiles = [];
      }
      if (metaFiles.length === 0) {
        line(provider, 'no fixtures yet');
        continue;
      }
      const ages = [];
      for (const f of metaFiles) {
        const meta = readJsonSafe(join(dir, f));
        const age = meta ? daysSince(meta.lastVerified) : null;
        if (age !== null) ages.push(age);
      }
      if (ages.length === 0) {
        line(provider, `${metaFiles.length} fixture(s), none with lastVerified`);
      } else {
        const oldest = Math.max(...ages);
        line(
          provider,
          `${metaFiles.length} fixture(s), oldest verified ${oldest}d ago`,
        );
      }
    }
  }
}

console.log(NL + '============================================================');
console.log(' rot-metrics complete (non-blocking; exit 0)');
console.log('============================================================');

process.exit(0);
