#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf '%s\n' 'Usage: check-incoming-secrets.sh BASE_SHA HEAD_SHA' >&2
  exit 2
fi

scripts=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

# Validate before using either argument as a Git revision or log option.
for sha in "$1" "$2"; do
  case "$sha" in
    *[!a-fA-F0-9]*) printf '%s\n' 'Security scan requires full commit IDs.' >&2; exit 2 ;;
  esac
  case "${#sha}" in
    40|64) ;;
    *) printf '%s\n' 'Security scan requires full commit IDs.' >&2; exit 2 ;;
  esac
done

repository=$(git rev-parse --show-toplevel)
git -C "$repository" cat-file -e "$2^{commit}"
base=$1
case "$base" in
  *[!0]*)
    if ! git -C "$repository" cat-file -e "$base^{commit}" 2>/dev/null; then
      printf '%s\n' 'Scan base unavailable after history rewrite; scanning full reachable history.' >&2
      # A missing old base must widen the scan, never silently skip incoming commits.
      base=0000000000000000000000000000000000000000
    fi
    ;;
esac
node "$scripts/check-private-files.js" --range "$base" "$2"

if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%s\n' 'Gitleaks is required for incoming commit checks.' >&2
  exit 1
fi

case "$base" in
  *[!0]*) range="$base..$2" ;;
  *) range="$2" ;;
esac

# Scan every incoming commit, not only the resulting tree. Never print secrets.
gitleaks git "$(git rev-parse --show-toplevel)" \
  --log-opts="-m $range" \
  --config="$scripts/gitleaks-ci.toml" \
  --gitleaks-ignore-path=/dev/null \
  --redact=100 \
  --ignore-gitleaks-allow \
  --no-banner \
  --no-color
