#!/bin/sh
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%s\n' \
    'Gitleaks is required before committing. Install it with: brew install gitleaks' \
    'Other platforms: https://github.com/gitleaks/gitleaks#installing' >&2
  exit 1
fi

repository=$(git rev-parse --show-toplevel)
scripts=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

# Reject private artifacts even if a scanner cannot recognize their contents.
node "$scripts/check-private-files.js" --staged

# Scan the index, not the worktree or existing history. Never print secret values.
gitleaks git "$repository" \
  --pre-commit \
  --staged \
  --config="$scripts/gitleaks-ci.toml" \
  --gitleaks-ignore-path=/dev/null \
  --redact=100 \
  --ignore-gitleaks-allow \
  --no-banner \
  --no-color
