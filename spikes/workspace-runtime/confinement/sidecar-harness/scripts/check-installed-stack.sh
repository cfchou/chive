#!/bin/sh
set -u

if [ "$#" -lt 3 ]; then
  echo "usage: check-installed-stack.sh <nono> <supported-version> <profile> [profile...]" >&2
  exit 2
fi

nono=$1
supported_version=$2
shift 2

# A GUI should save an absolute path instead of trusting its smaller PATH.
case "$nono" in
  /*) ;;
  *)
    echo "installed-stack: nono path must be absolute: $nono" >&2
    exit 2
    ;;
esac

if [ ! -x "$nono" ]; then
  echo "installed-stack: nono executable is missing or not executable: $nono" >&2
  exit 2
fi

observed_version=$("$nono" --version 2>&1) || {
  echo "installed-stack: cannot read nono version: $observed_version" >&2
  exit 2
}
if [ "$observed_version" != "nono $supported_version" ]; then
  echo "installed-stack: unsupported nono version: expected $supported_version, found $observed_version" >&2
  exit 2
fi

# Use the same executable and inherited config environment for every check.
"$nono" setup --check-only >/dev/null || {
  echo "installed-stack: nono sandbox preflight failed" >&2
  exit 2
}

if ! command -v jq >/dev/null 2>&1; then
  echo "installed-stack: jq is required by this evidence-only checker" >&2
  exit 2
fi
profile_inventory=$("$nono" profile list --json 2>&1) || {
  echo "installed-stack: cannot list profile sources" >&2
  printf '%s\n' "$profile_inventory" >&2
  exit 2
}

for profile in "$@"; do
  validation=$("$nono" profile validate --strict "$profile" 2>&1) || {
    echo "installed-stack: selected profile is missing or invalid: $profile" >&2
    printf '%s\n' "$validation" >&2
    exit 2
  }

  # File profiles already name their source. Named profiles must match the
  # source shown by the same nono installation that will launch the runtime.
  case "$profile" in
    /*|*.json)
      source="file"
      pack="null"
      ;;
    */*)
      short_name=${profile##*/}
      entry=$(printf '%s\n' "$profile_inventory" | jq -c \
        --arg name "$short_name" --arg pack "$profile" \
        '.[] | select(.name == $name and .pack == $pack)' | /usr/bin/head -n 1)
      source=$(printf '%s\n' "$entry" | jq -r '.source // empty')
      pack=$(printf '%s\n' "$entry" | jq -r '.pack // "null"')
      ;;
    *)
      entry=$(printf '%s\n' "$profile_inventory" | jq -c \
        --arg name "$profile" '.[] | select(.name == $name)' | /usr/bin/head -n 1)
      source=$(printf '%s\n' "$entry" | jq -r '.source // empty')
      pack=$(printf '%s\n' "$entry" | jq -r '.pack // "null"')
      ;;
  esac

  if [ -z "$source" ]; then
    echo "installed-stack: cannot determine selected profile source: $profile" >&2
    exit 2
  fi
  case "$source" in
    *overrides*)
      echo "installed-stack: unqualified profile is shadowed: $profile resolves to $source" >&2
      exit 2
      ;;
  esac

  echo "PROFILE reference=$profile source=$source pack=$pack validation=pass"
done

echo "RESULT executable=$nono version=$supported_version preflight=pass profiles=pass"
