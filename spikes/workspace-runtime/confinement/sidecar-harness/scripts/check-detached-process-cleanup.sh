#!/bin/sh
set -u

if [ "$#" -ne 5 ]; then
  echo "usage: check-detached-process-cleanup.sh <helper> <harness> <nono> <profile> <workspace>" >&2
  exit 2
fi

helper=$1
harness=$2
nono=$3
profile=$4
workspace=$5
pid_file=$workspace/detached-daemon.pid
wrapper_pid=
wrapper_group=
daemon_pid=

# The child starts in the workspace, so relative executable paths could point
# somewhere different after launch.
require_absolute_path() {
  label=$1
  value=$2
  case $value in
    /*) ;;
    *)
      echo "RESULT detached-cleanup=setup-fail reason=$label-path-must-be-absolute"
      exit 2
      ;;
  esac
}

require_absolute_path helper "$helper"
require_absolute_path harness "$harness"
require_absolute_path nono "$nono"
require_absolute_path workspace "$workspace"

if [ ! -x "$helper" ] || [ ! -x "$harness" ] || [ ! -x "$nono" ]; then
  echo "RESULT detached-cleanup=setup-fail reason=executable-missing"
  exit 2
fi
if [ ! -d "$workspace" ]; then
  echo "RESULT detached-cleanup=setup-fail reason=workspace-missing"
  exit 2
fi

# Stop only processes created by this check, even when the expected assertion fails.
cleanup() {
  if [ -n "$wrapper_group" ]; then
    kill -KILL "-$wrapper_group" 2>/dev/null || true
  elif [ -n "$wrapper_pid" ]; then
    kill -KILL "$wrapper_pid" 2>/dev/null || true
  fi
  if [ -n "$daemon_pid" ]; then
    kill -KILL "$daemon_pid" 2>/dev/null || true
  fi
  if [ -n "$wrapper_pid" ]; then
    wait "$wrapper_pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}
trap cleanup EXIT INT TERM

rm -f "$pid_file"
# The child shell, not this script, expands its two numbered arguments.
# shellcheck disable=SC2016
"$harness" \
  --nono "$nono" \
  --profile "$profile" \
  --workspace-rw "$workspace" \
  --net open \
  -- /bin/sh -c '"$1" "$2"; /bin/sleep 120' check "$helper" "$pid_file" \
  >/dev/null 2>&1 &
wrapper_pid=$!

# Wait for the daemon PID instead of assuming how quickly this machine forks.
attempt=0
while [ ! -s "$pid_file" ] && [ "$attempt" -lt 100 ]; do
  if ! kill -0 "$wrapper_pid" 2>/dev/null; then
    echo "RESULT detached-cleanup=setup-fail reason=wrapper-exited"
    exit 2
  fi
  attempt=$((attempt + 1))
  sleep 0.05
done
if [ ! -s "$pid_file" ]; then
  echo "RESULT detached-cleanup=setup-fail reason=missing-daemon-pid"
  exit 2
fi

daemon_pid=$(/usr/bin/xargs <"$pid_file")
case $daemon_pid in
  ''|*[!0-9]*)
    echo "RESULT detached-cleanup=setup-fail reason=invalid-daemon-pid"
    exit 2
    ;;
esac

wrapper_group=$(/bin/ps -o pgid= -p "$wrapper_pid" | /usr/bin/xargs)
daemon_group=$(/bin/ps -o pgid= -p "$daemon_pid" | /usr/bin/xargs)
daemon_parent=$(/bin/ps -o ppid= -p "$daemon_pid" | /usr/bin/xargs)
if [ "$wrapper_group" != "$wrapper_pid" ]; then
  echo "RESULT detached-cleanup=setup-fail reason=owner-group-missing"
  exit 2
fi
if [ "$daemon_group" = "$wrapper_group" ] || [ "$daemon_parent" != "1" ]; then
  echo "RESULT detached-cleanup=setup-fail reason=daemon-did-not-detach"
  exit 2
fi

echo "CASE wrapper=$wrapper_pid wrapper-group=$wrapper_group daemon=$daemon_pid daemon-group=$daemon_group daemon-parent=$daemon_parent"

# This is the same group-targeted stop that the current E8 check calls sufficient.
kill -TERM "-$wrapper_group"
wait "$wrapper_pid" 2>/dev/null || true
sleep 1

if kill -0 "$daemon_pid" 2>/dev/null; then
  echo "RESULT detached-cleanup=fail survivor=$daemon_pid"
  exit 1
fi

echo "RESULT detached-cleanup=pass survivor=none"
