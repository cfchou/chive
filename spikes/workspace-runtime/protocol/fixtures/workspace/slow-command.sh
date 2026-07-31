#!/bin/sh

# Controlled long-running command for interruption and cleanup tests.
# It writes both process ids so the probe can inspect the exact processes it owns.

set -eu

run_id="${1:?run id is required}"
parent_file=".slow-parent-${run_id}.pid"
child_file=".slow-child-${run_id}.pid"
child_command=".slow-child-${run_id}"

printf '%s\n' "$$" > "$parent_file"

# Run sleep through a unique local name. The process command then carries the
# run id, which lets fallback cleanup reject a stale or unrelated PID safely.
ln -s /bin/sleep "$child_command"

# Remove the temporary command name on normal exit and every signal path.
trap 'rm -f "$child_command"' EXIT

# Forward a stop signal to the child during normal shell cleanup.
stop_child() {
  if [ -n "${child_pid:-}" ]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}

trap 'stop_child; exit 143' HUP INT TERM

# Sleep long enough for the probe to inspect and interrupt the running tool.
"./$child_command" 300 &
child_pid=$!
printf '%s\n' "$child_pid" > "$child_file"
wait "$child_pid"
