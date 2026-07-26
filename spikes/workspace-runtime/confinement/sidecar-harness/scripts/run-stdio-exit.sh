#!/bin/sh
set -u

if [ "$#" -ne 4 ]; then
  echo "usage: run-stdio-exit.sh <harness> <nono> <profile> <workspace>" >&2
  exit 2
fi

harness=$1
nono=$2
profile=$3
workspace=$4

# One unusual exit code makes it clear that the adapter did not replace it.
set +e
# The single quotes belong to the child shell, where `$line` must expand.
# shellcheck disable=SC2016
output=$(printf 'message-from-chive\n' | "$harness" \
  --nono "$nono" \
  --profile "$profile" \
  --workspace-rw "$workspace" \
  --net open \
  -- /bin/sh -c '
    IFS= read -r line
    printf "child-stdout=%s\n" "$line"
    printf "child-stderr=visible\n" >&2
    exit 23
  ' 2>&1)
status=$?
set -e

printf '%s\n' "$output"
echo "RESULT exit-code=$status"

case "$output" in
  *"child-stdout=message-from-chive"*"child-stderr=visible"*) ;;
  *)
    echo "SUMMARY stdio=fail exit-code=fail" >&2
    exit 1
    ;;
esac

if [ "$status" -ne 23 ]; then
  echo "SUMMARY stdio=pass exit-code=fail" >&2
  exit 1
fi

echo "SUMMARY stdio=pass exit-code=pass"
