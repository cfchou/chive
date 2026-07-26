#!/bin/sh
set -u

if [ "$#" -ne 3 ]; then
  echo "usage: check-evidence-hash.sh <label> <file> <expected-sha256>" >&2
  exit 2
fi

label=$1
file=$2
expected=$3

if [ ! -f "$file" ]; then
  echo "evidence-hash: $label is missing: $file" >&2
  exit 3
fi

actual=$(/usr/bin/shasum -a 256 "$file" | /usr/bin/awk '{print $1}') || {
  echo "evidence-hash: cannot hash $label: $file" >&2
  exit 3
}

# Old test results apply only while every security input is unchanged.
if [ "$actual" != "$expected" ]; then
  echo "evidence-hash: $label changed; old validation is no longer valid" >&2
  echo "evidence-hash: expected=$expected actual=$actual" >&2
  exit 3
fi

echo "EVIDENCE label=$label sha256=$actual status=valid"
