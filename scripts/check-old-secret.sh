#!/usr/bin/env bash
# Check whether an old credential still appears in this checkout, without
# printing it.
#
#   scripts/check-old-secret.sh < file-holding-the-value
#   pbpaste | scripts/check-old-secret.sh            # macOS clipboard
#   scripts/check-old-secret.sh                      # type it; input is hidden
#
# Reads one value from stdin (first line only), then looks for that exact
# string in every tracked or untracked, non-ignored file of the working tree
# and in `git log -p` of the current branch (HEAD). It prints only
# "found in <path>", "found in commit <sha>" or "not found". It never prints
# the value, never passes it on a command line, and keeps it only in a
# private temporary file that is removed on exit.
#
# Options:
#   --fingerprint  also print the first 8 hex characters of the value's
#                  SHA-256, so you can tell runs apart without the value.
#
# Exit status: 0 not found, 1 found, 2 usage or input error.
set -euo pipefail
set +x

fingerprint=0
case "${1:-}" in
  --fingerprint) fingerprint=1 ;;
  "") ;;
  *) echo "usage: $0 [--fingerprint] < value" >&2; exit 2 ;;
esac

git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "run this inside a git checkout" >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)"

value=""
if [ -t 0 ]; then
  printf 'value (hidden): ' >&2
  IFS= read -rs value || true
  printf '\n' >&2
else
  IFS= read -r value || true
fi
value="${value%$'\r'}"
if [ "${#value}" -lt 8 ]; then
  echo "no value read, or shorter than 8 characters" >&2
  exit 2
fi

umask 077
pattern="$(mktemp "${TMPDIR:-/tmp}/check-old-secret.XXXXXX")"
trap 'rm -f "$pattern"' EXIT
printf '%s\n' "$value" > "$pattern"

if [ "$fingerprint" = 1 ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(printf '%s' "$value" | sha256sum)"
  else
    digest="$(printf '%s' "$value" | shasum -a 256)"
  fi
  echo "checking value sha256:${digest:0:8}"
fi
unset value

found=0

# Working tree: tracked and untracked files that are not ignored.
while IFS= read -r -d '' path; do
  [ -f "$path" ] || continue
  if grep -qF -f "$pattern" -- "$path" 2>/dev/null; then
    echo "found in $path"
    found=1
  fi
done < <(git ls-files -z --cached --others --exclude-standard)

# History of the current branch. The value is read from the pattern file by
# awk, never from its command line.
while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  echo "found in commit $commit"
  found=1
done < <(git log -p --no-color --no-ext-diff --format='@@check-old-secret %H' HEAD 2>/dev/null |
  awk 'NR == FNR { needle = $0; next }
       /^@@check-old-secret [0-9a-f]+$/ { commit = $2; next }
       index($0, needle) && commit != last { print commit; last = commit }' "$pattern" -)

if [ "$found" = 0 ]; then
  echo "not found"
  exit 0
fi
exit 1
