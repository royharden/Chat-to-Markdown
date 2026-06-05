#!/usr/bin/env sh
# =============================================================================
# setup-hooks.sh — point git at the repo-managed hooks in .githooks/ (POSIX sh)
# -----------------------------------------------------------------------------
# Run once per clone. Idempotent: re-running just re-asserts the config.
# =============================================================================

set -u

ROOT=$(git rev-parse --show-toplevel) || {
  echo "setup-hooks: not inside a git work tree" >&2
  exit 1
}
cd "$ROOT" || {
  echo "setup-hooks: cannot cd into repo root: $ROOT" >&2
  exit 1
}

git config core.hooksPath .githooks

# Best-effort: make the hook + gauntlet executable on POSIX systems. Harmless
# (and silently ignored) on filesystems that don't track the bit, e.g. Windows.
chmod +x .githooks/pre-commit       2>/dev/null || true
chmod +x scripts/gauntlet.sh        2>/dev/null || true

echo "core.hooksPath set to: $(git config --get core.hooksPath)"
echo "pre-commit hook active -> scripts/gauntlet.sh"
echo ""
echo "REMINDER: project policy FORBIDS 'git commit --no-verify' / '-n'."
echo "          Fix the issue or lower a floor via an ADR in docs/decisions/."
