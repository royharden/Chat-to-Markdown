#!/usr/bin/env sh
# =============================================================================
# gauntlet.sh — deterministic anti-rot enforcement substrate (POSIX sh)
# -----------------------------------------------------------------------------
# Runs the full pre-commit / CI quality gauntlet for the Chat-to-Markdown
# Manifest V3 extension. This script is SCAFFOLDING: there is no product code
# yet (no package.json, no src/). Every step is gated on the existence of its
# tooling + npm script, so each step gracefully SKIPs when not yet scaffolded
# and the overall gauntlet exits 0. As real code and npm scripts land, the
# matching steps light up automatically with zero edits to this file.
#
# Step order (each gated on existence):
#   (a) lint
#   (b) typecheck
#   (c) unit tests
#   (d) integration / DOM tests
#   (e) golden-snapshot check
#   (f) web-ext / manifest lint
#   (g) secret / PII scan
#   (h) duplication & dead-selector scan
#
# Exit semantics:
#   - A step that EXECUTES and fails -> recorded FAIL, gauntlet exits 1.
#   - A step whose tooling/script is absent -> SKIP (never fails the gauntlet).
#   - If nothing executed (pure scaffolding state) -> exit 0.
#   - Exception: (g) runs scripts/scan-secrets.mjs directly whenever it exists (no
#     package.json needed) and is FAIL-CLOSED: if node is missing the step FAILS.
#
# Idempotent and side-effect-free except for writing its own stdout/stderr.
# Portable: runs under POSIX sh on Linux CI, macOS, and Git-for-Windows.
# =============================================================================

set -u

# --- Locate repo root as the parent of this script's directory ---------------
# Resolve the directory containing this script without relying on GNU readlink.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT" || {
  echo "FATAL: cannot cd into repo root: $REPO_ROOT" >&2
  exit 1
}

PKG_JSON="$REPO_ROOT/package.json"

# --- Result tracking ---------------------------------------------------------
# We avoid bash arrays (not POSIX). Accumulate a newline-delimited summary and
# a single failure counter instead.
SUMMARY=""
FAIL_COUNT=0
EXEC_COUNT=0

record() {
  # record <status> <step-label>
  _status="$1"
  shift
  _label="$*"
  SUMMARY="${SUMMARY}${_status}\t${_label}
"
}

# has_script <npm-script-name>
# Returns 0 if package.json exists AND defines the given npm script.
# Uses a tolerant grep for "\"<name>\"\s*:" within the file. This is a
# scaffolding-grade check (no JSON parser dependency); the authoritative
# validation is `npm run` itself failing fast if the script is missing.
has_script() {
  _name="$1"
  [ -f "$PKG_JSON" ] || return 1
  grep -Eq "\"${_name}\"[[:space:]]*:" "$PKG_JSON"
}

# run_npm_step <step-label> <npm-script-name>
# If the npm script exists, run it and record PASS/FAIL on its exit code.
# Otherwise record SKIP.
run_npm_step() {
  _label="$1"
  _script="$2"
  if has_script "$_script"; then
    echo ">>> RUN  ${_label}  (npm run ${_script})"
    EXEC_COUNT=$((EXEC_COUNT + 1))
    if npm run "$_script" --silent; then
      echo "<<< PASS ${_label}"
      record "PASS" "$_label"
    else
      echo "<<< FAIL ${_label}"
      record "FAIL" "$_label"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    echo "--- SKIP ${_label} (not scaffolded yet)"
    record "SKIP" "$_label"
  fi
}

# skip_with_todo <step-label> <future-script-path>
# Used for steps that have no npm script yet but a known future home. Always
# SKIPs and emits a clearly-marked TODO naming the future implementation.
skip_with_todo() {
  _label="$1"
  _future="$2"
  echo "--- SKIP ${_label} (not scaffolded yet) -- TODO: implement ${_future}"
  record "SKIP" "${_label} (TODO: ${_future})"
}

# run_node_step <step-label> <script-path>
# Runs a standalone node script that needs no package.json: first its --self-test (so a
# broken scanner cannot pass silently), then the script itself. FAIL-CLOSED: if the
# script exists but node does not, the step FAILS rather than skipping a security check.
run_node_step() {
  _label="$1"
  _script="$2"
  echo ">>> RUN  ${_label}  (node ${_script})"
  EXEC_COUNT=$((EXEC_COUNT + 1))
  if ! command -v node >/dev/null 2>&1; then
    echo "<<< FAIL ${_label} (node not found; cannot run ${_script})"
    record "FAIL" "$_label"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if node "$_script" --self-test && node "$_script"; then
    echo "<<< PASS ${_label}"
    record "PASS" "$_label"
  else
    echo "<<< FAIL ${_label}"
    record "FAIL" "$_label"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "============================================================"
echo " Chat-to-Markdown gauntlet"
echo " repo root: ${REPO_ROOT}"
if [ -f "$PKG_JSON" ]; then
  echo " package.json: present"
else
  echo " package.json: ABSENT (pure scaffolding state)"
fi
echo "============================================================"

# --- (a) lint ----------------------------------------------------------------
run_npm_step "(a) lint" "lint"

# --- (b) typecheck -----------------------------------------------------------
run_npm_step "(b) typecheck" "typecheck"

# --- (c) unit tests ----------------------------------------------------------
run_npm_step "(c) unit tests" "test:unit"

# --- (d) integration / DOM tests ---------------------------------------------
run_npm_step "(d) integration/DOM tests" "test:integration"

# --- (e) golden-snapshot check -----------------------------------------------
run_npm_step "(e) golden-snapshot check" "test:golden"

# --- (f) web-ext / manifest lint ---------------------------------------------
run_npm_step "(f) web-ext/manifest lint" "lint:ext"

# --- (g) secret / PII scan ---------------------------------------------------
# Prefer an npm script if one is defined; otherwise SKIP with a TODO that names
# the future standalone scanner.
if [ -f "$REPO_ROOT/scripts/scan-secrets.mjs" ]; then
  # Runs directly (no package.json needed). A `scan:secrets` npm script is optional.
  run_node_step "(g) secret/PII scan" "scripts/scan-secrets.mjs"
elif has_script "scan:secrets"; then
  run_npm_step "(g) secret/PII scan" "scan:secrets"
else
  skip_with_todo "(g) secret/PII scan" "scripts/scan-secrets.mjs"
fi

# --- (h) duplication & dead-selector scan ------------------------------------
if has_script "scan:dupes"; then
  run_npm_step "(h) duplication & dead-selector scan" "scan:dupes"
else
  skip_with_todo "(h) duplication & dead-selector scan" "scripts/scan-dupes.mjs"
fi

# --- Summary -----------------------------------------------------------------
echo ""
echo "============================================================"
echo " GAUNTLET SUMMARY"
echo "------------------------------------------------------------"
# printf interprets the \t and trailing \n stored in SUMMARY.
printf "%b" "$SUMMARY" | while IFS="$(printf '\t')" read -r st label; do
  [ -n "$st" ] || continue
  printf "  %-4s %s\n" "$st" "$label"
done
echo "------------------------------------------------------------"
echo " executed steps: ${EXEC_COUNT}   failures: ${FAIL_COUNT}"
echo "============================================================"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "GAUNTLET: FAIL (${FAIL_COUNT} executed step(s) failed)"
  exit 1
fi

if [ "$EXEC_COUNT" -eq 0 ]; then
  echo "GAUNTLET: PASS (nothing scaffolded yet — all steps skipped)"
else
  echo "GAUNTLET: PASS (all ${EXEC_COUNT} executed step(s) passed)"
fi
exit 0
