#!/bin/sh
set -u

if [ "$#" -ne 4 ]; then
  echo "usage: run-process-cleanup.sh <harness> <nono> <profile> <workspace>" >&2
  exit 2
fi

harness=$1
nono=$2
profile=$3
workspace=$4

# Walk the child list until there are no more descendants to record.
collect_descendants() {
  frontier=$1
  descendants=
  while [ -n "$frontier" ]; do
    next=
    for parent in $frontier; do
      children=$(/usr/bin/pgrep -P "$parent" 2>/dev/null || true)
      if [ -n "$children" ]; then
        descendants="$descendants $children"
        next="$next $children"
      fi
    done
    frontier=$next
  done
  echo "$descendants"
}

# Checks one recorded process without matching unrelated commands by name.
pid_is_alive() {
  kill -0 "$1" 2>/dev/null
}

# Stops only the PIDs recorded for this case when the ownership check fails.
cleanup_recorded_processes() {
  wrapper=$1
  shift

  kill -TERM "$wrapper" 2>/dev/null || true
  for pid in "$@"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
  kill -KILL "$wrapper" 2>/dev/null || true
  for pid in "$@"; do
    if pid_is_alive "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  wait "$wrapper" 2>/dev/null || true
}

# Stops the wrapper with one signal and reports any descendants left behind.
run_case() {
  signal=$1

  "$harness" \
    --nono "$nono" \
    --profile "$profile" \
    --workspace-rw "$workspace" \
    --net open \
    -- /bin/sh -c '/bin/sleep 120 & wait' \
    >/dev/null 2>&1 &
  wrapper_pid=$!
  sleep 2
  descendants=$(collect_descendants "$wrapper_pid")
  wrapper_pgid=$(/bin/ps -o pgid= -p "$wrapper_pid" | /usr/bin/xargs)
  echo "CASE signal=$signal wrapper=$wrapper_pid group=$wrapper_pgid descendants=$(echo "$descendants" | /usr/bin/xargs)"

  # Chive can stop the whole tree only when the adapter owns its own group.
  if [ "$wrapper_pgid" != "$wrapper_pid" ]; then
    echo "RESULT signal=$signal cleanup=fail owner-group=missing"
    # shellcheck disable=SC2086 # The recorded PID list must become separate arguments.
    cleanup_recorded_processes "$wrapper_pid" $descendants
    return 1
  fi

  # A negative PID sends the signal to the adapter and every child in its group.
  kill "-$signal" "-$wrapper_pgid"
  wait "$wrapper_pid" 2>/dev/null || true
  sleep 2

  survivors=
  for pid in $descendants; do
    if pid_is_alive "$pid"; then
      survivors="$survivors $pid"
    fi
  done

  if [ -z "$survivors" ]; then
    echo "RESULT signal=$signal cleanup=pass survivors=none"
    return 0
  fi

  echo "RESULT signal=$signal cleanup=fail survivors=$(echo "$survivors" | /usr/bin/xargs)"
  # shellcheck disable=SC2086 # The recorded PID list must become separate arguments.
  cleanup_recorded_processes "$wrapper_pid" $survivors
  return 1
}

failures=0
run_case TERM || failures=$((failures + 1))
run_case KILL || failures=$((failures + 1))

echo "SUMMARY cleanup-failures=$failures"
if [ "$failures" -eq 0 ]; then
  exit 0
fi
exit 1
