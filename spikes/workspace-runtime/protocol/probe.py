#!/usr/bin/env python3
"""Run the SP2 headless runtime tests and save redacted evidence.

Every counted runtime starts through the SP1 sidecar and nono. The probe uses
only controlled workspace files, bounds every wait, and removes private values
before anything is written into the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable
from urllib import parse as urlparse
from urllib import request as urlrequest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
FIXTURES = HERE / "fixtures"
WORKSPACE_FIXTURES = FIXTURES / "workspace"
TRANSCRIPTS = HERE / "transcripts"
TURN_TIMEOUT_SECONDS = 180
# Keep runtime choices in one place so the evidence always says exactly what ran.
SIDECAR_HARNESS = (
    REPO_ROOT
    / "spikes/workspace-runtime/confinement/sidecar-harness/target/debug/sidecar-harness"
)
TESTED_MODELS = {
    "codex": "gpt-5.6-sol",
    "claude": "claude-sonnet-4-6",
    "opencode": "github-copilot/gpt-5.6-terra",
}
EXPECTED_CLAUDE_VERSION = "2.1.218"
EXPECTED_CODEX_VERSION = "0.145.0"
EXPECTED_CODEX_SHA256 = (
    "1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590"
)
EXPECTED_OPENCODE_VERSION = "1.18.4"
EXPECTED_OPENCODE_SHA256 = (
    "9449af91f517eacc2b0742fa93ae0da64fa6e5db7b714e30c62edea2a8de3f98"
)
NONO_PROFILES = {
    "codex": "nolabs-ai/codex",
    "claude": "nolabs-ai/claude",
    "opencode": "opencode-0723a",
}
# These public switches cover features that can add tools or startup work. E4
# turns them off only for its candidate launch; it never edits user config.
E4_DISABLED_FEATURES = (
    "apps",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "hooks",
    "in_app_browser",
    "plugins",
    "remote_plugin",
    "skill_mcp_dependency_install",
    "tool_suggest",
)
E4_CONFIG_READ_SCHEMAS = {
    "config/read": "ConfigReadParams.json",
    "configRequirements/read": "ConfigRequirementsReadResponse.json",
    "hooks/list": "HooksListParams.json",
    "skills/list": "SkillsListParams.json",
    "plugin/installed": "PluginInstalledParams.json",
    "app/installed": "AppsInstalledParams.json",
    "mcpServerStatus/list": "ListMcpServerStatusParams.json",
}
E4_THREAD_CONFIG_FIELDS = {
    "approvalPolicy",
    "baseInstructions",
    "config",
    "cwd",
    "developerInstructions",
    "ephemeral",
    "model",
    "modelProvider",
    "personality",
    "sandbox",
    "serviceTier",
}
CONFIG_POSTURE_CATEGORIES = {
    "appsAndPlugins": ("apps", "plugins"),
    "authenticationAndProvider": (
        "forced_chatgpt_workspace_id",
        "forced_login_method",
        "model_provider",
        "model_providers",
        "openai_base_url",
    ),
    "features": ("features",),
    "hooks": ("hooks",),
    "instructionsAndContext": (
        "compact_prompt",
        "developer_instructions",
        "instructions",
        "model_instructions_file",
    ),
    "mcp": ("mcp_servers",),
    "modelAndService": (
        "model",
        "model_auto_compact_token_limit",
        "model_context_window",
        "model_reasoning_effort",
        "model_reasoning_summary",
        "model_verbosity",
        "review_model",
        "service_tier",
    ),
    "sandboxApprovalsAndPermissions": (
        "approval_policy",
        "approvals_reviewer",
        "default_permissions",
        "permissions",
        "sandbox_mode",
        "sandbox_workspace_write",
    ),
    "shellEnvironment": ("shell_environment_policy", "shell_snapshot"),
    "skillsAndAgents": ("agents", "memories", "skills"),
    "stateAndDiagnostics": (
        "analytics",
        "history",
        "log_dir",
        "otel",
        "sqlite_home",
    ),
    "toolsAndSearch": ("tools", "web_search"),
}
REQUIREMENT_POSTURE_CATEGORIES = {
    "apps": ("allowAppshots",),
    "approvalSandboxAndPermissions": (
        "allowedApprovalPolicies",
        "allowedPermissionProfiles",
        "allowedSandboxModes",
        "defaultPermissions",
    ),
    "computerUse": ("computerUse",),
    "features": ("featureRequirements",),
    "hooks": ("allowManagedHooksOnly",),
    "models": ("models",),
    "remoteControl": ("allowRemoteControl",),
    "residency": ("enforceResidency",),
    "webSearch": ("allowedWebSearchModes",),
}
SAFE_CONFIG_LAYER_TYPES = {
    "enterpriseManaged",
    "legacyManagedConfigTomlFromFile",
    "legacyManagedConfigTomlFromMdm",
    "mdm",
    "project",
    "sessionFlags",
    "system",
    "user",
}
CONFIG_POSTURE_METHODS = (
    "config/read",
    "configRequirements/read",
    "hooks/list",
    "skills/list",
    "plugin/installed",
    "app/installed",
    "mcpServerStatus/list",
)
E5_STREAM_EVENT_METHODS = {
    "item/agentMessage/delta",
    "item/commandExecution/outputDelta",
    "item/completed",
    "item/started",
    "turn/completed",
    "turn/started",
}


def now_ms() -> int:
    """Return a monotonic millisecond value for ordering local events."""
    return time.monotonic_ns() // 1_000_000


def command_path(name: str) -> Path:
    """Resolve an installed command or stop with a clear readiness error."""
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"{name} is not installed")
    return Path(path)


def sidecar_command(runtime: str, workspace: Path, child: list[str]) -> list[str]:
    """Wrap one counted runtime launch in the sidecar boundary proved by SP1."""
    if not SIDECAR_HARNESS.is_file():
        raise RuntimeError(f"sidecar harness is not built: {SIDECAR_HARNESS}")
    return [
        str(SIDECAR_HARNESS),
        "--nono",
        str(command_path("nono")),
        "--profile",
        NONO_PROFILES[runtime],
        "--workspace-rw",
        str(workspace),
        "--net",
        "open",
        "--",
        *child,
    ]


def safe_runtime_child_argv(
    sidecar_argv: list[str],
    runtime: str,
    workspace: Path,
) -> list[str]:
    """Keep the runtime argv while hiding its executable path and prompt."""
    separator = sidecar_argv.index("--")
    child = list(sidecar_argv[separator + 1 :])
    if child:
        child[0] = f"<{runtime.upper()}_EXECUTABLE>"
    return redact(child, workspace)


def redact_text(value: str, workspace: Path | None = None) -> str:
    """Remove local paths, account names, and token-shaped strings before saving."""
    replacements: list[tuple[str, str]] = []
    if workspace is not None:
        replacements.append((str(workspace), "<WORKSPACE>"))
        replacements.append((str(workspace.resolve()), "<WORKSPACE>"))
    replacements.extend(
        [
            (str(Path.home()), "<HOME>"),
            (str(REPO_ROOT), "<CHIVE_ROOT>"),
            (str(HERE), "<PROTOCOL_SPIKE>"),
        ]
    )

    redacted = value
    # macOS can show the same temporary path with or without `/private`.
    for original, replacement in replacements:
        redacted = redacted.replace(original, replacement)
    redacted = redacted.replace("/private<WORKSPACE>", "<WORKSPACE>")

    redacted = re.sub(
        r"/(?:private/)?(?:var/folders/[^\s\"']*/T/|tmp/)chive-sp2-[^/\s\"']+",
        "<WORKSPACE>",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(authorization\s*:\s*bearer\s+)[^\s\"']+",
        r"\1<REDACTED_TOKEN>",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(MCP client for )`[^`]+`",
        r"\1`<MCP_SERVER>`",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(for server )[A-Za-z0-9_.-]+",
        r"\1<MCP_SERVER>",
        redacted,
    )
    redacted = re.sub(
        r'("server_name"\s*:\s*")[^"]+',
        r"\1<MCP_SERVER>",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(mcp_servers\.)(?:[A-Za-z0-9_-]+|\"[^\"]+\")(\.enabled=false)",
        r"\1<MCP_SERVER>\2",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(ENOTFOUND|EAI_AGAIN)\s+[A-Za-z0-9_.-]+",
        r"\1 <REDACTED_HOST>",
        redacted,
    )
    # Codex can report the Mac's local host name in an otherwise harmless
    # protocol field. Hide any `.local` name wherever it appears.
    redacted = re.sub(
        r"(?i)\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})\.)+local\b",
        "<REDACTED_HOST>",
        redacted,
    )
    redacted = re.sub(r"\bsk-[A-Za-z0-9_-]{12,}\b", "<REDACTED_TOKEN>", redacted)
    redacted = re.sub(
        r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        "<REDACTED_EMAIL>",
        redacted,
        flags=re.IGNORECASE,
    )
    return redacted


def redact(value: Any, workspace: Path | None = None) -> Any:
    """Redact strings and sensitive structured fields inside a JSON value."""
    if isinstance(value, str):
        return redact_text(value, workspace)
    if isinstance(value, list):
        return [redact(item, workspace) for item in value]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            # Runtime init events can enumerate unrelated user plugins. A count
            # is enough to prove isolation failed without retaining their names.
            if key == "plugins" and isinstance(item, list):
                redacted[key] = {"configuredCount": len(item)}
                continue
            # Account existence and type are the only auth fields SP2 needs.
            if key == "account" and isinstance(item, dict):
                redacted[key] = {
                    "present": True,
                    "type": redact(item.get("type"), workspace),
                }
                continue
            redacted[key] = redact(item, workspace)
        if str(redacted.get("method", "")).startswith("mcpServer/"):
            params = redacted.get("params")
            if isinstance(params, dict) and "name" in params:
                params["name"] = "<MCP_SERVER>"
        return redacted
    return value


def run_command(
    argv: list[str],
    *,
    cwd: Path | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    """Run one command and return redacted output for in-memory inspection."""
    started = now_ms()
    completed = subprocess.run(
        argv,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
    return redact(
        {
            "argv": argv,
            "cwd": str(cwd) if cwd else None,
            "exitCode": completed.returncode,
            "elapsedMs": now_ms() - started,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        },
        cwd,
    )


def reduce_command_output(command: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Discard raw command streams and return stdout for immediate parsing."""
    reduced = dict(command)
    stdout = str(reduced.pop("stdout", ""))
    stderr = str(reduced.pop("stderr", ""))
    reduced["stdoutLineCount"] = len(stdout.splitlines())
    reduced["stderrLineCount"] = len(stderr.splitlines())
    reduced["rawOutputRetained"] = False
    return reduced, stdout


def version_command(argv: list[str]) -> dict[str, Any]:
    """Keep one parsed semantic version without saving command text."""
    command, stdout = reduce_command_output(run_command(argv))
    match = re.search(r"\b(\d+\.\d+\.\d+)\b", stdout)
    command["version"] = match.group(1) if match else None
    return command


def codex_auth_probe() -> dict[str, Any]:
    """Keep Codex login readiness without saving the status message."""
    command, stdout = reduce_command_output(
        run_command([str(command_path("codex")), "login", "status"])
    )
    logged_in = command["exitCode"] == 0 and "logged in" in stdout.lower()
    if "chatgpt" in stdout.lower():
        method = "ChatGPT"
    elif "api key" in stdout.lower():
        method = "API key"
    else:
        method = "other" if logged_in else None
    command["status"] = {"loggedIn": logged_in, "method": method}
    return command


def assert_reduced_evidence(value: Any) -> None:
    """Stop before saving if a probe still contains a raw command stream."""
    if isinstance(value, dict):
        forbidden = {"stdout", "stderr"}.intersection(value)
        if forbidden:
            fields = ", ".join(sorted(forbidden))
            raise RuntimeError(f"probe returned raw command fields: {fields}")
        for child in value.values():
            assert_reduced_evidence(child)
    elif isinstance(value, list):
        for child in value:
            assert_reduced_evidence(child)


def claude_auth_probe() -> dict[str, Any]:
    """Keep only the Claude login fields needed for readiness."""
    command = run_command([str(command_path("claude")), "auth", "status", "--json"])
    stdout = command.pop("stdout", "")
    stderr = command.pop("stderr", "")
    try:
        raw_status = json.loads(stdout)
    except (json.JSONDecodeError, TypeError):
        raw_status = {}
    # Auth diagnostics can contain provider or account details. Keep only
    # whether JSON parsed and how many diagnostic lines were discarded.
    command["statusParsed"] = bool(raw_status)
    command["stderrLineCount"] = len(str(stderr).splitlines())
    command["rawOutputRetained"] = False
    command["status"] = {
        key: raw_status.get(key)
        for key in ("loggedIn", "authMethod", "apiProvider", "subscriptionType")
    }
    return command


def claude_version_probe() -> dict[str, Any]:
    """Keep the installed Claude version and discard arbitrary diagnostics."""
    command = run_command([str(command_path("claude")), "--version"])
    stdout = str(command.pop("stdout", "")).strip()
    stderr = str(command.pop("stderr", ""))
    match = re.match(r"^(\d+\.\d+\.\d+)\b", stdout)
    command["version"] = match.group(1) if match else None
    command["stderrLineCount"] = len(stderr.splitlines())
    command["rawOutputRetained"] = False
    return command


def pinned_opencode_path() -> Path:
    """Return the exact cached OpenCode binary frozen in Phase 0."""
    path = (
        Path.home()
        / ".bun/install/cache/opencode-darwin-arm64@1.18.4@@@1/bin/opencode"
    )
    if not path.is_file():
        raise RuntimeError("the Phase 0 OpenCode 1.18.4 binary is not available")
    if sha256_file(path) != EXPECTED_OPENCODE_SHA256:
        raise RuntimeError("the cached OpenCode 1.18.4 binary hash changed")
    return path


def opencode_auth_probe(opencode: Path | None = None) -> dict[str, Any]:
    """Record whether OpenCode has saved auth without keeping provider names."""
    runtime = opencode or command_path("opencode")
    command = run_command(
        [str(runtime), "auth", "list", "--pure"]
    )
    stdout = command.pop("stdout", "")
    stderr = command.pop("stderr", "")
    match = re.search(r"(\d+) credentials?", stdout)
    count = int(match.group(1)) if match else None
    command["status"] = {
        "credentialEntryCount": count,
        "hasSavedCredentials": command["exitCode"] == 0 and bool(count),
    }
    command["stderrLineCount"] = len(str(stderr).splitlines())
    command["rawOutputRetained"] = False
    return command


def sha256_file(path: Path) -> str:
    """Return the SHA-256 fingerprint of one executable or schema bundle."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_canonical_json_file(path: Path) -> str:
    """Hash JSON meaning instead of its changing object-key order."""
    document = json.loads(path.read_text(encoding="utf-8"))
    canonical = json.dumps(
        document,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def prepare_workspace(prefix: str) -> tempfile.TemporaryDirectory[str]:
    """Create a fresh workspace containing only the controlled test files."""
    temp = tempfile.TemporaryDirectory(prefix=f"chive-sp2-{prefix}-")
    workspace = Path(temp.name)
    for fixture in WORKSPACE_FIXTURES.iterdir():
        shutil.copy2(fixture, workspace / fixture.name)
    return temp


def process_snapshot(pid: int, workspace: Path | None = None) -> dict[str, Any]:
    """Capture the process relationship fields needed for cleanup proof."""
    result = subprocess.run(
        [
            "/bin/ps",
            "-p",
            str(pid),
            "-o",
            "pid=,ppid=,pgid=,sess=,stat=,command=",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    output = result.stdout.strip()
    fields = output.split(maxsplit=5)
    status = fields[4] if len(fields) >= 5 else ""
    return {
        "pid": pid,
        "alive": result.returncode == 0 and bool(output) and not status.startswith("Z"),
        "ppid": int(fields[1]) if len(fields) >= 2 else None,
        "pgid": int(fields[2]) if len(fields) >= 3 else None,
        "session": int(fields[3]) if len(fields) >= 4 else None,
        "status": status or None,
        "ps": redact_text(output, workspace),
    }


def parse_process_table(value: str) -> dict[int, dict[str, Any]]:
    """Turn `ps` output into rows while keeping the command only in memory."""
    rows: dict[int, dict[str, Any]] = {}
    for line in value.splitlines():
        fields = line.strip().split(maxsplit=5)
        if len(fields) < 5:
            continue
        try:
            pid, ppid, pgid, session = (int(field) for field in fields[:4])
        except ValueError:
            continue
        status = fields[4]
        rows[pid] = {
            "pid": pid,
            "ppid": ppid,
            "pgid": pgid,
            "session": session,
            "status": status,
            "alive": not status.startswith("Z"),
            "command": fields[5] if len(fields) == 6 else "",
        }
    return rows


def read_process_table() -> dict[int, dict[str, Any]]:
    """Read the local process tree once so lifecycle roles share one snapshot."""
    completed = subprocess.run(
        ["/bin/ps", "-axo", "pid=,ppid=,pgid=,sess=,stat=,command="],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("could not read the process table")
    return parse_process_table(completed.stdout)


def process_descends_from(
    pid: int,
    ancestor_pid: int,
    table: dict[int, dict[str, Any]],
) -> bool:
    """Follow parent ids upward without trusting a process name alone."""
    seen: set[int] = set()
    current = pid
    while current not in seen:
        if current == ancestor_pid:
            return True
        seen.add(current)
        row = table.get(current)
        if row is None:
            return False
        parent = row.get("ppid")
        if not isinstance(parent, int) or parent <= 0 or parent == current:
            return False
        current = parent
    return False


def process_executable_name(command: str) -> str:
    """Read a process executable name without saving its full command line."""
    first = command.strip().split(maxsplit=1)[0] if command.strip() else ""
    return Path(first).name


def resolve_codex_lifecycle_roles(
    root_pid: int,
    shell_pid: int,
    child_pid: int,
    table: dict[int, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, bool]]:
    """Find sidecar, nono, app-server, and the two exact fixture processes."""
    root = table.get(root_pid)
    shell = table.get(shell_pid)
    child = table.get(child_pid)
    if root is None or shell is None or child is None:
        raise RuntimeError("a required E7 process disappeared before inspection")

    descendants = [
        row
        for pid, row in table.items()
        if pid != root_pid and process_descends_from(pid, root_pid, table)
    ]
    nono_candidates = [
        row
        for row in descendants
        if process_executable_name(str(row.get("command", ""))) == "nono"
    ]
    if len(nono_candidates) != 1:
        raise RuntimeError(
            f"expected one nono descendant, found {len(nono_candidates)}"
        )
    nono = nono_candidates[0]

    app_server_candidates = [
        row
        for row in descendants
        if process_executable_name(str(row.get("command", ""))).startswith("codex")
        and "app-server" in str(row.get("command", ""))
        and process_descends_from(row["pid"], nono["pid"], table)
    ]
    if len(app_server_candidates) != 1:
        raise RuntimeError(
            "expected one Codex app-server descendant, found "
            f"{len(app_server_candidates)}"
        )
    app_server = app_server_candidates[0]
    roles = {
        "sidecar": root,
        "nono": nono,
        "appServer": app_server,
        "toolShell": shell,
        "toolChild": child,
    }
    checks = {
        "nonoDescendsFromSidecar": process_descends_from(
            nono["pid"], root["pid"], table
        ),
        "appServerDescendsFromNono": process_descends_from(
            app_server["pid"], nono["pid"], table
        ),
        "toolShellDescendsFromAppServer": process_descends_from(
            shell["pid"], app_server["pid"], table
        ),
        "toolChildOwnedByShell": child.get("ppid") == shell.get("pid"),
    }
    return roles, checks


def safe_lifecycle_states(
    roles: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Keep lifecycle fields for each role and discard every command line."""
    return {
        role: {
            "pid": row.get("pid"),
            "ppid": row.get("ppid"),
            "pgid": row.get("pgid"),
            "session": row.get("session"),
            "status": row.get("status"),
            "alive": row.get("alive"),
        }
        for role, row in roles.items()
    }


def refresh_lifecycle_roles(
    roles: dict[str, dict[str, Any]],
    workspace: Path,
) -> dict[str, dict[str, Any]]:
    """Inspect the same exact PIDs again after a lifecycle signal."""
    return {
        role: process_snapshot(int(row["pid"]), workspace)
        for role, row in roles.items()
    }


def signal_owned_pid(pid: int, signal_number: int) -> bool:
    """Signal one previously resolved test-owned PID and report if it existed."""
    try:
        os.kill(pid, signal_number)
        return True
    except ProcessLookupError:
        return False


def signal_owned_group(pgid: int, signal_number: int) -> bool:
    """Signal one resolved test-owned group without accepting a broad target."""
    if pgid <= 1 or pgid == os.getpgrp():
        raise RuntimeError("refusing to signal an unsafe process group")
    try:
        os.killpg(pgid, signal_number)
        return True
    except ProcessLookupError:
        return False


def wait_for_pid_file(
    path: Path,
    timeout: int = 90,
    process: subprocess.Popen[str] | None = None,
) -> int:
    """Wait for a fixture PID file, but stop early if its runtime exits."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(
                f"process exited with {process.returncode} before {path.name} was written"
            )
        try:
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return int(value)
        except (FileNotFoundError, ValueError):
            pass
        time.sleep(0.05)
    raise TimeoutError(f"timed out waiting for {path.name}")


def wait_until_stopped(
    pids: list[int],
    *,
    workspace: Path,
    timeout: int = 10,
) -> list[dict[str, Any]]:
    """Poll known fixture processes until they stop or the deadline passes."""
    deadline = time.monotonic() + timeout
    snapshots = [process_snapshot(pid, workspace) for pid in pids]
    while any(item["alive"] for item in snapshots) and time.monotonic() < deadline:
        time.sleep(0.1)
        snapshots = [process_snapshot(pid, workspace) for pid in pids]
    return snapshots


def clean_known_slow_processes(
    pids: list[int],
    *,
    run_id: str,
) -> list[dict[str, Any]]:
    """Clean a slow fixture only when its command contains the exact run id."""
    cleaned: list[dict[str, Any]] = []
    for pid in pids:
        snapshot = process_snapshot(pid)
        command = snapshot["ps"]
        if not snapshot["alive"]:
            continue
        is_slow_fixture = (
            "slow-command.sh" in command or ".slow-child-" in command
        )
        # A command name alone is not identity proof. Another user process may
        # also be sleeping, so the unique attempt id must be present as well.
        if not is_slow_fixture or run_id not in command:
            cleaned.append({"pid": pid, "result": "refused", "ps": command})
            continue
        os.kill(pid, signal.SIGKILL)
        cleaned.append({"pid": pid, "result": "killed", "ps": command})
    return cleaned


class JsonLineProcess:
    """Own one child process and collect both output streams without blocking."""

    def __init__(
        self,
        argv: list[str],
        *,
        cwd: Path,
        writable_stdin: bool,
    ) -> None:
        """Start one isolated child and begin draining both output streams."""
        self.argv = argv
        self.cwd = cwd
        self.started_ms = now_ms()
        self.messages: list[dict[str, Any]] = []
        self.stderr: list[str] = []
        # A new session gives this attempt one group that can be stopped without
        # signalling the parent Codex process or another test.
        self.process = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=subprocess.PIPE if writable_stdin else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        assert self.process.stdout is not None
        assert self.process.stderr is not None
        self._stdout_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

    def _read_stdout(self) -> None:
        """Parse JSONL stdout without letting one non-JSON line stop the test."""
        assert self.process.stdout is not None
        for line in self.process.stdout:
            raw = line.rstrip("\n")
            try:
                payload: Any = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"unparsed": raw}
            entry = {
                "direction": "server",
                "atMs": now_ms() - self.started_ms,
                "message": payload,
            }
            self.messages.append(entry)

    def _read_stderr(self) -> None:
        """Drain diagnostics so a full stderr pipe cannot block the child."""
        assert self.process.stderr is not None
        for line in self.process.stderr:
            self.stderr.append(line.rstrip("\n"))

    def send(self, message: dict[str, Any]) -> None:
        """Send one JSON protocol message and retain its order in the evidence."""
        if self.process.stdin is None:
            raise RuntimeError("process stdin is not writable")
        self.messages.append(
            {
                "direction": "client",
                "atMs": now_ms() - self.started_ms,
                "message": message,
            }
        )
        self.process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def send_raw(self, line: str) -> None:
        """Send deliberately malformed input while keeping it in the transcript."""
        if self.process.stdin is None:
            raise RuntimeError("process stdin is not writable")
        self.messages.append(
            {
                "direction": "client",
                "atMs": now_ms() - self.started_ms,
                "message": {"raw": line},
            }
        )
        self.process.stdin.write(line + "\n")
        self.process.stdin.flush()

    def wait_for(
        self,
        predicate: Callable[[dict[str, Any]], bool],
        *,
        timeout: int = TURN_TIMEOUT_SECONDS,
        start_index: int = 0,
    ) -> dict[str, Any]:
        """Wait for one matching server message within a fixed deadline."""
        deadline = time.monotonic() + timeout
        cursor = start_index
        while time.monotonic() < deadline:
            while cursor < len(self.messages):
                entry = self.messages[cursor]
                cursor += 1
                if entry["direction"] == "server" and predicate(entry["message"]):
                    return entry["message"]
            if self.process.poll() is not None:
                raise RuntimeError(f"process exited with {self.process.returncode}")
            time.sleep(0.02)
        raise TimeoutError("timed out waiting for protocol message")

    def request(
        self,
        request_id: int,
        method: str,
        params: dict[str, Any],
        *,
        timeout: int = TURN_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        """Send a request and wait for the response carrying the same id."""
        start_index = len(self.messages)
        self.send({"id": request_id, "method": method, "params": params})
        return self.wait_for(
            lambda message: message.get("id") == request_id,
            timeout=timeout,
            start_index=start_index,
        )

    def wait(self, timeout: int = TURN_TIMEOUT_SECONDS) -> int:
        """Wait for exit, cleaning the owned process before reporting a timeout."""
        try:
            return self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            # A caller still needs to know that its deadline expired, but it
            # must not inherit a child process that was left running.
            self.close()
            raise

    def close_input(self) -> None:
        """Tell a JSONL server that no more requests are coming."""
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()

    def signal_group(self, signal_number: int) -> None:
        """Signal only the process group created for this test attempt."""
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal_number)

    def close(self) -> None:
        """Stop and reap the owned child, then close all of its local pipes."""
        if self.process.poll() is None:
            self.signal_group(signal.SIGTERM)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.signal_group(signal.SIGKILL)
                self.process.wait(timeout=5)

        # The child has stopped, so both reader threads should reach end of
        # file quickly. Joining them keeps their final output before we close
        # the local handles.
        self._stdout_thread.join(timeout=1)
        self._stderr_thread.join(timeout=1)
        for stream in (
            self.process.stdin,
            self.process.stdout,
            self.process.stderr,
        ):
            if stream is not None and not stream.closed:
                stream.close()

    def evidence(self) -> dict[str, Any]:
        """Return the redacted command, stream, timing, and exit evidence."""
        return redact(
            {
                "argv": self.argv,
                "cwd": str(self.cwd),
                "pid": self.process.pid,
                "exitCode": self.process.poll(),
                "elapsedMs": now_ms() - self.started_ms,
                "messages": self.messages,
                "stderr": self.stderr,
            },
            self.cwd,
        )


def response_result(response: dict[str, Any]) -> dict[str, Any]:
    """Return a successful response body or explain the unexpected shape."""
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(f"expected result object, got {response}")
    return result


def thread_id_from(response: dict[str, Any]) -> str:
    """Read the runtime thread id from a `thread/start` response."""
    result = response_result(response)
    thread = result.get("thread")
    if not isinstance(thread, dict) or not isinstance(thread.get("id"), str):
        raise RuntimeError(f"thread/start did not return a thread id: {response}")
    return thread["id"]


def turn_id_from(response: dict[str, Any]) -> str:
    """Read the turn id from a `turn/start` response."""
    result = response_result(response)
    turn = result.get("turn")
    if not isinstance(turn, dict) or not isinstance(turn.get("id"), str):
        raise RuntimeError(f"turn/start did not return a turn id: {response}")
    return turn["id"]


def message_method_is(method: str) -> Callable[[dict[str, Any]], bool]:
    """Build a small predicate for waiting on one server method."""
    return lambda message: message.get("method") == method


def codex_app_server_command(
    workspace: Path,
    *,
    clear_inherited_mcp: bool = True,
    config_overrides: tuple[str, ...] = (),
) -> list[str]:
    """Build the counted Codex app-server command inside sidecar and nono."""
    command = [str(command_path("codex")), "app-server", "--stdio"]
    if clear_inherited_mcp:
        command.extend(["-c", "mcp_servers={}"])
    for override in config_overrides:
        command.extend(["-c", override])
    return sidecar_command("codex", workspace, command)


def response_error_is(response: dict[str, Any], expected: str) -> bool:
    """Check one protocol error message without depending on its numeric code."""
    error = response.get("error")
    return isinstance(error, dict) and error.get("message") == expected


def request_codex_initialize(
    process: JsonLineProcess,
    request_id: int,
) -> dict[str, Any]:
    """Send the standard probe identity in one Codex initialize request."""
    return process.request(
        request_id,
        "initialize",
        {
            "clientInfo": {
                "name": "chive_sp2_probe",
                "title": "Chive SP2 Probe",
                "version": "0.1.0",
            }
        },
    )


def check_codex_initialization(process: JsonLineProcess) -> dict[str, Any]:
    """Walk one Codex connection through the Phase 2 initialization states."""
    checks: dict[str, Any] = {}

    before_init = process.request(1, "account/read", {"refreshToken": False})
    checks["preInitializeRejected"] = response_error_is(
        before_init,
        "Not initialized",
    )

    initialized = request_codex_initialize(process, 2)
    checks["initializeReturnedPlatform"] = all(
        key in response_result(initialized)
        for key in ("userAgent", "platformFamily", "platformOs", "codexHome")
    )

    # Repeat the request before the notification. This proves the first request
    # already moved Codex out of its waiting state.
    repeated = request_codex_initialize(process, 3)
    checks["secondInitializeRejected"] = response_error_is(
        repeated,
        "Already initialized",
    )
    process.send({"method": "initialized", "params": {}})

    unknown = process.request(4, "chive/unknown", {})
    checks["unknownMethodRejected"] = "error" in unknown

    # A broken input line must produce a bounded error. The next account call
    # then proves that the error did not leave the connection unusable.
    malformed_start = len(process.messages)
    process.send_raw('{"id":5,"method":')
    try:
        process.wait_for(
            lambda message: "error" in message,
            timeout=5,
            start_index=malformed_start,
        )
        checks["malformedJsonRejected"] = True
    except TimeoutError:
        checks["malformedJsonRejected"] = False

    account = process.request(6, "account/read", {"refreshToken": False})
    account_result = response_result(account)
    account_value = account_result.get("account")
    checks["accountReadAuthenticated"] = isinstance(account_value, dict)
    checks["accountTypeReturned"] = (
        isinstance(account_value, dict) and account_value.get("type") is not None
    )
    checks["connectionUsableAfterMalformedJson"] = True
    return checks


def stop_jsonl_server_cleanly(process: JsonLineProcess) -> bool:
    """Close stdin and report whether the JSONL server then exited normally."""
    process.close_input()
    try:
        return process.wait(timeout=10) == 0
    except subprocess.TimeoutExpired:
        return False


def count_server_method_after_quiet(
    process: JsonLineProcess,
    method: str,
    *,
    start_index: int,
    first_event_timeout: int = 5,
    quiet_seconds: float = 1.0,
) -> int:
    """Count one server event after its stream has been quiet for a moment."""
    try:
        process.wait_for(
            message_method_is(method),
            timeout=first_event_timeout,
            start_index=start_index,
        )
    except TimeoutError:
        return 0

    # Startup events arrive in a short burst. Wait for the whole burst instead
    # of recording only the first server and hiding the scale of inheritance.
    last_size = len(process.messages)
    quiet_since = time.monotonic()
    deadline = quiet_since + first_event_timeout
    while time.monotonic() < deadline:
        current_size = len(process.messages)
        if current_size != last_size:
            last_size = current_size
            quiet_since = time.monotonic()
        if time.monotonic() - quiet_since >= quiet_seconds:
            break
        if process.process.poll() is not None:
            break
        time.sleep(0.02)

    return sum(
        1
        for entry in process.messages[start_index:]
        if entry.get("direction") == "server"
        and entry.get("message", {}).get("method") == method
    )


def check_codex_mcp_isolation(
    process: JsonLineProcess,
    workspace: Path,
    *,
    quiet_seconds: float = 1.0,
) -> tuple[dict[str, Any], int]:
    """Start one thread and count inherited MCP startup events without names."""
    startup_start = len(process.messages)
    thread = process.request(
        7,
        "thread/start",
        {
            "cwd": str(workspace),
            "sandbox": "danger-full-access",
            "approvalPolicy": "never",
            "ephemeral": True,
            "model": TESTED_MODELS["codex"],
            "config": {"mcp_servers": {}},
        },
    )
    thread_id_from(thread)
    event_count = count_server_method_after_quiet(
        process,
        "mcpServer/startupStatus/updated",
        start_index=startup_start,
        quiet_seconds=quiet_seconds,
    )
    # A count proves whether inheritance happened. Server names are unrelated
    # user configuration, so they never become a top-level result field.
    return {"emptyMcpMapBlockedStartup": event_count == 0}, event_count


def codex_mcp_isolation_attempt(
    workspace: Path,
    *,
    launch_override: bool,
    config_overrides: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Run one bounded MCP-isolation attempt and stop before a model turn."""
    process = JsonLineProcess(
        codex_app_server_command(
            workspace,
            clear_inherited_mcp=launch_override,
            config_overrides=config_overrides,
        ),
        cwd=workspace,
        writable_stdin=True,
    )
    try:
        initialized = request_codex_initialize(process, 1)
        process.send({"method": "initialized", "params": {}})
        checks = {
            "connectionInitialized": "result" in initialized,
        }
        isolation_checks, event_count = check_codex_mcp_isolation(
            process,
            workspace,
        )
        checks.update(isolation_checks)
        checks["appServerExitedCleanly"] = stop_jsonl_server_cleanly(process)
        return {
            "launchOverrideApplied": launch_override,
            "extraConfigOverrideCount": len(config_overrides),
            "mcpStartupEventCount": event_count,
            "checks": checks,
            "transcript": process.evidence(),
        }
    finally:
        process.close()


def codex_text_output(argv: list[str]) -> tuple[int, str]:
    """Run a local Codex inspection command and keep its output in memory."""
    completed = subprocess.run(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
        check=False,
    )
    return completed.returncode, completed.stdout


def codex_mcp_entries(
    codex: Path,
    config_overrides: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    """Read MCP entries in memory so names never become evidence fields."""
    argv = [str(codex), "mcp", "list"]
    for override in config_overrides:
        argv.extend(["-c", override])
    argv.append("--json")
    exit_code, stdout = codex_text_output(argv)
    if exit_code != 0:
        raise RuntimeError("Codex MCP inventory failed")
    value = json.loads(stdout)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise RuntimeError("Codex MCP inventory returned an unexpected shape")
    return value


def codex_mcp_counts(
    codex: Path,
    config_overrides: tuple[str, ...] = (),
) -> dict[str, int]:
    """Count configured and enabled MCP entries without returning their names."""
    entries = codex_mcp_entries(codex, config_overrides)
    return {
        "configured": len(entries),
        "enabled": sum(item.get("enabled") is True for item in entries),
    }


def supported_mcp_disable_overrides(codex: Path) -> tuple[tuple[str, ...], dict[str, int]]:
    """Find which listed MCP entries accept the documented disable override."""
    entries = codex_mcp_entries(codex)
    accepted: list[str] = []
    rejected = 0
    unsafe_key_shape = 0
    for item in entries:
        name = item.get("name")
        # Bare TOML keys are enough for the tested names. Do not guess quoting
        # rules for an unexpected name because a wrong key can target another
        # config path.
        if not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9_-]+", name) is None:
            unsafe_key_shape += 1
            continue
        override = f"mcp_servers.{name}.enabled=false"
        exit_code, _ = codex_text_output(
            [str(codex), "mcp", "list", "-c", override, "--json"]
        )
        if exit_code == 0:
            accepted.append(override)
        else:
            rejected += 1
    return tuple(accepted), {
        "listed": len(entries),
        "accepted": len(accepted),
        "rejected": rejected,
        "unsafeKeyShape": unsafe_key_shape,
    }


def isolated_codex_home_auth(codex: Path) -> dict[str, Any]:
    """Check whether a fresh state root can use login without copied files."""
    with tempfile.TemporaryDirectory(prefix="chive-e4-codex-home-") as temp:
        environment = os.environ.copy()
        environment["CODEX_HOME"] = temp
        completed = subprocess.run(
            [str(codex), "login", "status"],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        return {
            "exitCode": completed.returncode,
            "savedLoginAvailable": completed.returncode == 0,
        }


def codex_documented_config_seams(codex: Path) -> dict[str, bool]:
    """Compare the installed exec and app-server config-isolation flags."""
    app_exit, app_help = codex_text_output([str(codex), "app-server", "--help"])
    exec_exit, exec_help = codex_text_output([str(codex), "exec", "--help"])
    if app_exit != 0 or exec_exit != 0:
        raise RuntimeError("Codex help inspection failed")
    return {
        "execIgnoreUserConfig": "--ignore-user-config" in exec_help,
        "execIgnoreRules": "--ignore-rules" in exec_help,
        "appServerIgnoreUserConfig": "--ignore-user-config" in app_help,
        "appServerIgnoreRules": "--ignore-rules" in app_help,
    }


def codex_config_surface_schema(codex: Path) -> dict[str, list[str]]:
    """List public config research seams from the generated stable schema."""
    with tempfile.TemporaryDirectory(prefix="chive-e4-config-schema-") as temp:
        schema_root = Path(temp)
        completed = subprocess.run(
            [
                str(codex),
                "app-server",
                "generate-json-schema",
                "--out",
                str(schema_root),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError("Codex stable schema generation failed")

        v2 = schema_root / "v2"
        thread_schema = json.loads((v2 / "ThreadStartParams.json").read_text())
        available_thread_fields = set(thread_schema.get("properties", {}))
        return {
            "readMethods": sorted(
                method
                for method, filename in E4_CONFIG_READ_SCHEMAS.items()
                if (v2 / filename).is_file()
            ),
            "threadStartFields": sorted(
                E4_THREAD_CONFIG_FIELDS & available_thread_fields
            ),
        }


def category_presence(
    values: Any,
    categories: dict[str, tuple[str, ...]],
) -> dict[str, bool]:
    """Report which public config groups have a value without keeping values."""
    source = values if isinstance(values, dict) else {}
    return {
        category: any(source.get(key) is not None for key in keys)
        for category, keys in categories.items()
    }


def config_layer_type(value: Any) -> str:
    """Keep a public layer kind and collapse any unknown shape to `other`."""
    if not isinstance(value, dict):
        return "other"
    layer_type = value.get("type")
    if isinstance(layer_type, str) and layer_type in SAFE_CONFIG_LAYER_TYPES:
        return layer_type
    return "other"


def count_config_layer_types(values: Any) -> dict[str, int]:
    """Count config layer kinds without keeping file paths or profile names."""
    counts: dict[str, int] = {}
    if not isinstance(values, list):
        return counts
    for value in values:
        if not isinstance(value, dict):
            layer_type = "other"
        else:
            layer_type = config_layer_type(value.get("name"))
        counts[layer_type] = counts.get(layer_type, 0) + 1
    return dict(sorted(counts.items()))


def count_origin_layer_types(values: Any) -> dict[str, int]:
    """Count origin layer kinds without retaining the config keys they own."""
    counts: dict[str, int] = {}
    if not isinstance(values, dict):
        return counts
    for metadata in values.values():
        if not isinstance(metadata, dict):
            layer_type = "other"
        else:
            layer_type = config_layer_type(metadata.get("name"))
        counts[layer_type] = counts.get(layer_type, 0) + 1
    return dict(sorted(counts.items()))


def list_value(value: Any) -> list[Any]:
    """Return a list value or an empty list for a missing response field."""
    return value if isinstance(value, list) else []


def result_object(response: Any, method: str) -> tuple[dict[str, Any], bool]:
    """Read one response without copying a failed response into an error."""
    if not isinstance(response, dict):
        return {}, False
    result = response.get("result")
    if not isinstance(result, dict):
        return {}, False
    return result, True


def summarize_config_posture(result: dict[str, Any]) -> dict[str, Any]:
    """Reduce effective config to public groups and anonymous layer counts."""
    layers = list_value(result.get("layers"))
    origins = result.get("origins")
    return {
        "categoryPresence": category_presence(
            result.get("config"),
            CONFIG_POSTURE_CATEGORIES,
        ),
        "layerCount": len(layers),
        "layerTypeCounts": count_config_layer_types(layers),
        "originEntryCount": len(origins) if isinstance(origins, dict) else 0,
        "originLayerTypeCounts": count_origin_layer_types(origins),
    }


def summarize_requirements_posture(result: dict[str, Any]) -> dict[str, Any]:
    """Reduce managed requirements to public groups without keeping policy."""
    requirements = result.get("requirements")
    source = requirements if isinstance(requirements, dict) else {}
    return {
        "categoryPresence": category_presence(
            source,
            REQUIREMENT_POSTURE_CATEGORIES,
        ),
        "configuredFieldCount": sum(value is not None for value in source.values()),
    }


def summarize_hooks_posture(result: dict[str, Any]) -> dict[str, int]:
    """Count hooks and their state without keeping commands, paths, or matchers."""
    entries = list_value(result.get("data"))
    hooks = [
        hook
        for entry in entries
        if isinstance(entry, dict)
        for hook in list_value(entry.get("hooks"))
        if isinstance(hook, dict)
    ]
    return {
        "cwdEntryCount": len(entries),
        "hookCount": len(hooks),
        "enabledCount": sum(hook.get("enabled") is True for hook in hooks),
        "managedCount": sum(hook.get("isManaged") is True for hook in hooks),
        "errorCount": sum(
            len(list_value(entry.get("errors")))
            for entry in entries
            if isinstance(entry, dict)
        ),
        "warningCount": sum(
            len(list_value(entry.get("warnings")))
            for entry in entries
            if isinstance(entry, dict)
        ),
    }


def summarize_skills_posture(result: dict[str, Any]) -> dict[str, int]:
    """Count discovered skills without keeping names, text, tools, or paths."""
    entries = list_value(result.get("data"))
    skills = [
        skill
        for entry in entries
        if isinstance(entry, dict)
        for skill in list_value(entry.get("skills"))
        if isinstance(skill, dict)
    ]
    return {
        "cwdEntryCount": len(entries),
        "skillCount": len(skills),
        "enabledCount": sum(skill.get("enabled") is True for skill in skills),
        "errorCount": sum(
            len(list_value(entry.get("errors")))
            for entry in entries
            if isinstance(entry, dict)
        ),
    }


def summarize_plugins_posture(result: dict[str, Any]) -> dict[str, int]:
    """Count installed plugin state without keeping plugin or marketplace data."""
    marketplaces = list_value(result.get("marketplaces"))
    plugins = [
        plugin
        for marketplace in marketplaces
        if isinstance(marketplace, dict)
        for plugin in list_value(marketplace.get("plugins"))
        if isinstance(plugin, dict)
    ]
    return {
        "marketplaceCount": len(marketplaces),
        "pluginCount": len(plugins),
        "installedCount": sum(plugin.get("installed") is True for plugin in plugins),
        "enabledCount": sum(plugin.get("enabled") is True for plugin in plugins),
        "loadErrorCount": len(list_value(result.get("marketplaceLoadErrors"))),
    }


def summarize_apps_posture(result: dict[str, Any]) -> dict[str, int]:
    """Count effective installed apps without keeping their identities."""
    apps = [
        app
        for app in list_value(result.get("apps"))
        if isinstance(app, dict)
    ]
    return {
        "appCount": len(apps),
        "enabledCount": sum(app.get("enabled") is True for app in apps),
        "callableCount": sum(app.get("callable") is True for app in apps),
    }


def summarize_mcp_posture(result: dict[str, Any]) -> dict[str, Any]:
    """Count MCP capabilities without keeping servers, tools, or resources."""
    servers = [
        server
        for server in list_value(result.get("data"))
        if isinstance(server, dict)
    ]
    return {
        "serverCount": len(servers),
        "toolCount": sum(
            len(server.get("tools", {}))
            for server in servers
            if isinstance(server.get("tools"), dict)
        ),
        "resourceCount": sum(
            len(list_value(server.get("resources"))) for server in servers
        ),
        "resourceTemplateCount": sum(
            len(list_value(server.get("resourceTemplates"))) for server in servers
        ),
        "nextPageAvailable": result.get("nextCursor") is not None,
    }


def check_codex_config_posture(
    process: JsonLineProcess,
    workspace: Path,
    thread_id: str,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Read inherited config surfaces and immediately reduce private responses."""
    requests: tuple[tuple[str, Any], ...] = (
        ("config/read", {"cwd": str(workspace), "includeLayers": True}),
        ("configRequirements/read", None),
        ("hooks/list", {"cwds": [str(workspace)]}),
        ("skills/list", {"cwds": [str(workspace)], "forceReload": False}),
        (
            "plugin/installed",
            {"cwds": [str(workspace)], "installSuggestionPluginNames": []},
        ),
        ("app/installed", {"threadId": thread_id, "forceRefresh": False}),
        (
            "mcpServerStatus/list",
            {
                "threadId": thread_id,
                "detail": "toolsAndAuthOnly",
                "limit": 1000,
            },
        ),
    )
    results: dict[str, dict[str, Any]] = {}
    checks: dict[str, bool] = {}
    for offset, (method, params) in enumerate(requests, start=3):
        response = process.request(offset, method, params)  # type: ignore[arg-type]
        result, ok = result_object(response, method)
        results[method] = result
        checks[method] = ok

    posture = {
        "effectiveConfig": summarize_config_posture(results["config/read"]),
        "managedRequirements": summarize_requirements_posture(
            results["configRequirements/read"]
        ),
        "hooks": summarize_hooks_posture(results["hooks/list"]),
        "skills": summarize_skills_posture(results["skills/list"]),
        "plugins": summarize_plugins_posture(results["plugin/installed"]),
        "apps": summarize_apps_posture(results["app/installed"]),
        "mcp": summarize_mcp_posture(results["mcpServerStatus/list"]),
    }
    return checks, posture


def classify_unparsed_line(value: Any) -> str:
    """Name one known sidecar warning without retaining arbitrary line text."""
    if not isinstance(value, str) or not value.strip():
        return "empty"
    if "--no-rollback is active; rollback flags" in value:
        return "knownNonoNoRollbackWarning"
    return "other"


def safe_codex_protocol_transcript(
    process: JsonLineProcess,
    workspace: Path,
) -> dict[str, Any]:
    """Keep protocol order and counts while discarding response bodies and stderr."""
    request_methods: list[str] = []
    notification_methods: list[str] = []
    server_event_method_counts: dict[str, int] = {}
    server_response_count = 0
    unparsed_line_kinds: dict[str, int] = {}

    for entry in process.messages:
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        if entry.get("direction") == "client":
            method = message.get("method")
            if not isinstance(method, str):
                continue
            if "id" in message:
                request_methods.append(method)
            else:
                notification_methods.append(method)
            continue
        if entry.get("direction") != "server":
            continue
        if "id" in message:
            server_response_count += 1
        method = message.get("method")
        if isinstance(method, str):
            server_event_method_counts[method] = (
                server_event_method_counts.get(method, 0) + 1
            )
        if "unparsed" in message:
            kind = classify_unparsed_line(message.get("unparsed"))
            unparsed_line_kinds[kind] = unparsed_line_kinds.get(kind, 0) + 1

    return redact(
        {
            "argv": process.argv,
            "cwd": str(process.cwd),
            "pid": process.process.pid,
            "exitCode": process.process.poll(),
            "elapsedMs": now_ms() - process.started_ms,
            "requestMethods": request_methods,
            "notificationMethods": notification_methods,
            "serverResponseCount": server_response_count,
            "serverEventMethodCounts": dict(
                sorted(server_event_method_counts.items())
            ),
            "unparsedServerLineKindCounts": dict(sorted(unparsed_line_kinds.items())),
            "stderrLineCount": len(process.stderr),
            "rawResponsesRetained": False,
            "rawStderrRetained": False,
        },
        workspace,
    )


def safe_posture_transcript(
    process: JsonLineProcess,
    workspace: Path,
) -> dict[str, Any]:
    """Keep operation order and counts while discarding every raw response."""
    request_methods = [
        entry.get("message", {}).get("method")
        for entry in process.messages
        if entry.get("direction") == "client"
        and isinstance(entry.get("message"), dict)
        and "id" in entry.get("message", {})
    ]
    unparsed_line_kinds: dict[str, int] = {}
    for entry in process.messages:
        message = entry.get("message")
        if entry.get("direction") != "server" or not isinstance(message, dict):
            continue
        if "unparsed" not in message:
            continue
        kind = classify_unparsed_line(message.get("unparsed"))
        unparsed_line_kinds[kind] = unparsed_line_kinds.get(kind, 0) + 1

    return redact(
        {
            "argv": process.argv,
            "cwd": str(process.cwd),
            "pid": process.process.pid,
            "exitCode": process.process.poll(),
            "elapsedMs": now_ms() - process.started_ms,
            "requestMethods": request_methods,
            "serverMessageCount": sum(
                entry.get("direction") == "server" for entry in process.messages
            ),
            "mcpStartupEventCount": sum(
                entry.get("direction") == "server"
                and entry.get("message", {}).get("method")
                == "mcpServer/startupStatus/updated"
                for entry in process.messages
                if isinstance(entry.get("message"), dict)
            ),
            "unparsedServerLineCount": sum(
                entry.get("direction") == "server"
                and isinstance(entry.get("message"), dict)
                and "unparsed" in entry.get("message", {})
                for entry in process.messages
            ),
            "unparsedServerLineKindCounts": dict(sorted(unparsed_line_kinds.items())),
            "stderrLineCount": len(process.stderr),
            "rawResponsesRetained": False,
        },
        workspace,
    )


def codex_config_posture_probe() -> dict[str, Any]:
    """Run the model-free E5 inherited-config pre-check.

    Initialize one Codex app-server connection under the sidecar. Start one
    ephemeral thread with normal inherited configuration. Read effective config
    layers, managed requirements, hooks, skills, installed plugins, installed
    apps, and MCP status. Reduce every response to public groups and anonymous
    counts before saving evidence. Stop without sending `turn/start`.
    """
    with prepare_workspace("codex-config-posture") as temp:
        workspace = Path(temp)
        process = JsonLineProcess(
            codex_app_server_command(workspace, clear_inherited_mcp=False),
            cwd=workspace,
            writable_stdin=True,
        )
        try:
            initialized = request_codex_initialize(process, 1)
            process.send({"method": "initialized", "params": {}})
            thread = process.request(
                2,
                "thread/start",
                {
                    "cwd": str(workspace),
                    "sandbox": "danger-full-access",
                    "approvalPolicy": "never",
                    "ephemeral": True,
                    "model": TESTED_MODELS["codex"],
                },
            )
            thread_result = thread.get("result")
            thread_data = (
                thread_result.get("thread")
                if isinstance(thread_result, dict)
                else None
            )
            thread_id = thread_data.get("id") if isinstance(thread_data, dict) else None
            if not isinstance(thread_id, str):
                raise RuntimeError("thread/start did not return a thread id")

            method_checks, posture = check_codex_config_posture(
                process,
                workspace,
                thread_id,
            )
            exited_cleanly = stop_jsonl_server_cleanly(process)
            transcript = safe_posture_transcript(process, workspace)
            checks = {
                "connectionInitialized": "result" in initialized,
                "ephemeralThreadStarted": True,
                "allPostureReadsSucceeded": all(method_checks.values()),
                "noModelTurnStarted": "turn/start"
                not in transcript["requestMethods"],
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "appServerExitedCleanly": exited_cleanly,
            }
            return {
                "runtime": "codex",
                "phase": 3,
                "experiment": "E5 pre-check",
                "inheritedUserConfiguration": True,
                "checks": checks,
                "methodChecks": method_checks,
                "posture": posture,
                "transcript": transcript,
            }
        finally:
            process.close()


def codex_config_isolation_final_probe() -> dict[str, Any]:
    """Finish E4 and return its supported-seam verdict.

    Reuse the two counted empty-map attempts instead of starting configured MCP
    servers again. Check the installed help for native app-server isolation
    flags. Test per-server disables together with public feature-family
    switches using the local config reader only, while retaining counts instead
    of names. Check whether a fresh Codex state root can reuse saved login
    without copied files. Reject any candidate that is incomplete, race-prone,
    or unauthenticated. Start neither app-server nor a model turn.
    """
    codex = command_path("codex")
    counted_path = (
        TRANSCRIPTS
        / "phase3-codex-config-stream"
        / "e4-config-isolation-final.run-20260727-013.json"
    )
    # The final artifact keeps the only retained copy of the counted attempts.
    # Read it before replacing the file so local seam checks remain repeatable
    # without starting user-configured MCP servers again.
    counted_document = json.loads(counted_path.read_text())
    counted = counted_document["probes"]["codex-config-isolation-final"]
    counted_attempts = counted["countedAttempts"]
    counted_at = counted["countedAt"]

    documented = codex_documented_config_seams(codex)
    config_surface_schema = codex_config_surface_schema(codex)
    normal_counts = codex_mcp_counts(codex)
    empty_map_counts = codex_mcp_counts(codex, ("mcp_servers={}",))
    server_overrides, override_counts = supported_mcp_disable_overrides(codex)
    feature_overrides = tuple(
        f"features.{feature}=false" for feature in E4_DISABLED_FEATURES
    )
    candidate_overrides = (
        *server_overrides,
        *feature_overrides,
        "apps._default.enabled=false",
    )
    # Check the complete candidate with the cheap local command before using
    # the same overrides to start app-server under the sidecar.
    candidate_list_counts = codex_mcp_counts(codex, candidate_overrides)
    isolated_auth = isolated_codex_home_auth(codex)

    # The per-server candidate reads names and then starts app-server. A config
    # change between those operations can add an enabled server, so it cannot
    # satisfy the plan. Do not start that unsafe and already-invalid candidate.
    candidate_race_safe = False
    access_token_available = bool(os.environ.get("CODEX_ACCESS_TOKEN"))
    native_ignore_available = (
        documented["appServerIgnoreUserConfig"]
        and documented["appServerIgnoreRules"]
    )
    isolated_home_auth_available = (
        isolated_auth["savedLoginAvailable"] or access_token_available
    )
    supported_seam_found = (
        native_ignore_available or isolated_home_auth_available
    )
    return {
        "runtime": "codex",
        "phase": 3,
        "experiment": "E4",
        "verdict": "PASS" if supported_seam_found else "PARTIAL",
        "continuationPolicy": (
            "ISOLATED_CONFIG"
            if supported_seam_found
            else "CONTINUE_WITH_INHERITED_CONFIG_RECORDED"
        ),
        "checks": {
            "documentedAppServerIgnoreFlags": native_ignore_available,
            "emptyMapClearsConfiguredServers": empty_map_counts["enabled"] == 0,
            "threadOverrideBlocksStartup": counted_attempts[
                "threadOverrideOnly"
            ]["mcpStartupEventCount"] == 0,
            "launchAndThreadOverrideBlocksStartup": counted_attempts[
                "launchAndThreadOverride"
            ]["mcpStartupEventCount"] == 0,
            "perServerFeatureCandidateLeavesNoEnabledEntries": (
                candidate_list_counts["enabled"] == 0
            ),
            "perServerFeatureCandidateRaceSafe": candidate_race_safe,
            "isolatedHomeKeepsSavedLogin": isolated_auth["savedLoginAvailable"],
            "isolatedHomeHasSupportedAuth": isolated_home_auth_available,
            "unsafeCandidateWasNotStarted": True,
            "supportedIsolationSeamFound": supported_seam_found,
        },
        "documentedFlags": documented,
        "broaderConfigResearch": config_surface_schema,
        "mcpInventoryCounts": {
            "normal": normal_counts,
            "emptyMapOverride": empty_map_counts,
            "perServerDisableCandidate": candidate_list_counts,
            "disableOverrideSupport": override_counts,
        },
        "featureCandidate": {
            "disabledFeatureCount": len(E4_DISABLED_FEATURES),
            "candidateRaceSafe": candidate_race_safe,
            "started": False,
            "reason": (
                "The current snapshot has no enabled entries, but config "
                "could change between listing and launch."
            ),
        },
        "isolatedHomeAuth": {
            **isolated_auth,
            "codexAccessTokenAvailable": access_token_available,
        },
        "countedAttempts": counted_attempts,
        "countedAt": counted_at,
    }


def codex_config_inheritance(workspace: Path) -> dict[str, Any]:
    """Keep the combined probe's original thread-only isolation attempt."""
    return codex_mcp_isolation_attempt(workspace, launch_override=False)


def codex_config_isolation_probe() -> dict[str, Any]:
    """Run only the first E4 inherited-configuration comparison.

    Start one app-server with normal Codex state and an empty thread-level MCP
    map. Start a second app-server with both the launch-level and thread-level
    empty MCP maps. Count MCP startup events from each connection without
    retaining server names. Stop both connections without starting a model
    turn. Return one JSON result for the matching Markdown transcript.
    """
    with prepare_workspace("codex-config-isolation") as temp:
        workspace = Path(temp)
        thread_only = codex_mcp_isolation_attempt(
            workspace,
            launch_override=False,
        )
        launch_and_thread = codex_mcp_isolation_attempt(
            workspace,
            launch_override=True,
        )
        return {
            "runtime": "codex",
            "phase": 3,
            "experiment": "E4",
            "checks": {
                "threadOverrideBlockedStartup": thread_only[
                    "mcpStartupEventCount"
                ]
                == 0,
                "launchAndThreadOverrideBlockedStartup": launch_and_thread[
                    "mcpStartupEventCount"
                ]
                == 0,
            },
            "attempts": {
                "threadOverrideOnly": thread_only,
                "launchAndThreadOverride": launch_and_thread,
            },
        }


def codex_handshake_probe() -> dict[str, Any]:
    """Run only the Phase 2 handshake, without starting a thread or model turn."""
    with prepare_workspace("codex-handshake") as temp:
        workspace = Path(temp)
        process = JsonLineProcess(
            codex_app_server_command(workspace),
            cwd=workspace,
            writable_stdin=True,
        )
        try:
            checks = check_codex_initialization(process)
            checks["appServerExitedCleanly"] = stop_jsonl_server_cleanly(process)
            return {
                "runtime": "codex",
                "phase": 2,
                "checks": checks,
                "transcript": safe_codex_protocol_transcript(process, workspace),
            }
        finally:
            process.close()


def check_codex_thread_config(
    process: JsonLineProcess,
    workspace: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Start two threads and check that Codex kept their settings separate."""
    alternate_cwd = workspace / "alternate"
    alternate_cwd.mkdir()

    primary_thread = process.request(
        7,
        "thread/start",
        {
            "cwd": str(workspace),
            "sandbox": "danger-full-access",
            "approvalPolicy": "never",
            "ephemeral": True,
            "model": TESTED_MODELS["codex"],
            "config": {"mcp_servers": {}},
        },
    )
    alternate_thread = process.request(
        8,
        "thread/start",
        {
            "cwd": str(alternate_cwd),
            "sandbox": "read-only",
            "approvalPolicy": "untrusted",
            "ephemeral": True,
            "model": TESTED_MODELS["codex"],
            "config": {"mcp_servers": {}},
        },
    )

    primary_result = response_result(primary_thread)
    alternate_result = response_result(alternate_thread)
    primary_id = thread_id_from(primary_thread)
    alternate_id = thread_id_from(alternate_thread)
    checks = {
        "primaryCwdReflected": primary_result.get("cwd") == str(workspace),
        "primarySandboxReflected": primary_result.get("sandbox", {}).get("type")
        == "dangerFullAccess",
        "primaryApprovalPolicyReflected": primary_result.get("approvalPolicy")
        == "never",
        "primaryModelReflected": primary_result.get("model")
        == TESTED_MODELS["codex"],
        "alternateCwdReflected": alternate_result.get("cwd")
        == str(alternate_cwd),
        "alternateSandboxReflected": alternate_result.get("sandbox", {}).get(
            "type"
        )
        == "readOnly",
        "alternateApprovalPolicyReflected": alternate_result.get("approvalPolicy")
        == "untrusted",
        "alternateModelReflected": alternate_result.get("model")
        == TESTED_MODELS["codex"],
        "threadIdsSeparate": primary_id != alternate_id,
    }
    return checks, primary_thread


def codex_thread_config_probe() -> dict[str, Any]:
    """Run only the Phase 3 per-conversation settings test.

    Initialize one Codex connection. Start two ephemeral threads with different
    working directories, sandboxes, and approval settings. Confirm both
    responses reflect the requested settings and the thread ids are different.
    Stop without starting a model turn. Return the JSON evidence used for the
    matching Markdown transcript.
    """
    with prepare_workspace("codex-thread-config") as temp:
        workspace = Path(temp)
        process = JsonLineProcess(
            codex_app_server_command(workspace),
            cwd=workspace,
            writable_stdin=True,
        )
        try:
            initialized = request_codex_initialize(process, 1)
            process.send({"method": "initialized", "params": {}})
            checks = {
                "connectionInitialized": all(
                    key in response_result(initialized)
                    for key in (
                        "userAgent",
                        "platformFamily",
                        "platformOs",
                        "codexHome",
                    )
                )
            }
            thread_checks, _ = check_codex_thread_config(process, workspace)
            checks.update(thread_checks)
            checks["appServerExitedCleanly"] = stop_jsonl_server_cleanly(process)
            return {
                "runtime": "codex",
                "phase": 3,
                "checks": checks,
                "transcript": safe_codex_protocol_transcript(process, workspace),
            }
        finally:
            process.close()


def message_turn_id(message: dict[str, Any]) -> str | None:
    """Read a turn id from either a turn event or an item event."""
    params = message.get("params")
    if not isinstance(params, dict):
        return None
    direct = params.get("turnId")
    if isinstance(direct, str):
        return direct
    turn = params.get("turn")
    if isinstance(turn, dict) and isinstance(turn.get("id"), str):
        return turn["id"]
    return None


def turn_server_events(
    messages: list[dict[str, Any]],
    turn_id: str,
) -> list[tuple[int, dict[str, Any]]]:
    """Select ordered server events for one turn from the in-memory stream."""
    selected: list[tuple[int, dict[str, Any]]] = []
    for index, entry in enumerate(messages):
        message = entry.get("message")
        if entry.get("direction") != "server" or not isinstance(message, dict):
            continue
        if message_turn_id(message) == turn_id:
            selected.append((index, message))
    return selected


def event_item(message: dict[str, Any]) -> dict[str, Any]:
    """Return an event item or an empty object for a different event shape."""
    params = message.get("params")
    if not isinstance(params, dict):
        return {}
    item = params.get("item")
    return item if isinstance(item, dict) else {}


def event_delta(message: dict[str, Any]) -> str:
    """Return one streamed text chunk without guessing a missing value."""
    params = message.get("params")
    if not isinstance(params, dict):
        return ""
    delta = params.get("delta")
    return delta if isinstance(delta, str) else ""


def event_item_id(message: dict[str, Any]) -> str | None:
    """Read an item id from an item lifecycle or delta event."""
    item = event_item(message)
    if isinstance(item.get("id"), str):
        return item["id"]
    params = message.get("params")
    if isinstance(params, dict) and isinstance(params.get("itemId"), str):
        return params["itemId"]
    return None


def normalized_lines(value: str) -> list[str]:
    """Compare controlled command output without depending on newline style."""
    return value.replace("\r\n", "\n").strip().splitlines()


def controlled_command_output_matches(value: str, workspace: Path) -> bool:
    """Accept either macOS spelling of the controlled temporary workspace."""
    lines = normalized_lines(value)
    if len(lines) != 2:
        return False
    # macOS may create the directory under `/var` while `/bin/pwd` reports the
    # same directory under `/private/var`. Resolving the path proves they refer
    # to the same place without weakening the marker check.
    workspace_spellings = {str(workspace), str(workspace.resolve())}
    return lines[0] in workspace_spellings and lines[1] == "CHIVE_SP2_MARKER"


def compact_stream_timeline(
    events: list[tuple[int, dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Group repeated delta events so saved evidence stays easy to read."""
    timeline: list[dict[str, Any]] = []
    for _, message in events:
        method = message.get("method")
        if method not in E5_STREAM_EVENT_METHODS:
            continue
        item = event_item(message)
        entry = {
            "method": method,
            "itemType": item.get("type"),
            "status": item.get("status"),
        }
        if timeline and all(
            timeline[-1].get(key) == entry.get(key)
            for key in ("method", "itemType", "status")
        ):
            timeline[-1]["count"] += 1
        else:
            timeline.append({**entry, "count": 1})
    return timeline


def analyze_codex_turn_stream(
    messages: list[dict[str, Any]],
    turn_id: str,
    workspace: Path,
    *,
    expect_command: bool,
    exact_reply: str | None = None,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Check one turn's stream while retaining no model or command text."""
    events = turn_server_events(messages, turn_id)
    started = [
        (index, message)
        for index, message in events
        if message.get("method") == "turn/started"
    ]
    completed = [
        (index, message)
        for index, message in events
        if message.get("method") == "turn/completed"
    ]
    item_started = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/started"
    ]
    item_completed = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/completed"
    ]
    command_started = [
        (index, message)
        for index, message in item_started
        if event_item(message).get("type") == "commandExecution"
    ]
    command_completed = [
        (index, message)
        for index, message in item_completed
        if event_item(message).get("type") == "commandExecution"
    ]
    command_deltas = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/commandExecution/outputDelta"
    ]
    agent_started = [
        (index, message)
        for index, message in item_started
        if event_item(message).get("type") == "agentMessage"
    ]
    agent_completed = [
        (index, message)
        for index, message in item_completed
        if event_item(message).get("type") == "agentMessage"
    ]
    agent_deltas = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/agentMessage/delta"
    ]

    command_start_item = event_item(command_started[0][1]) if command_started else {}
    command_complete_item = (
        event_item(command_completed[0][1]) if command_completed else {}
    )
    command_id = command_complete_item.get("id")
    matching_command_deltas = [
        event_delta(message)
        for _, message in command_deltas
        if event_item_id(message) == command_id
    ]
    aggregated_output = command_complete_item.get("aggregatedOutput")
    if not isinstance(aggregated_output, str):
        aggregated_output = ""
    controlled_output_matches = controlled_command_output_matches(
        aggregated_output,
        workspace,
    )
    command_deltas_match = (
        not command_deltas or "".join(matching_command_deltas) == aggregated_output
    )

    agent_started_ids = {
        item_id
        for _, message in agent_started
        if (item_id := event_item_id(message)) is not None
    }
    agent_delta_ids = {
        item_id
        for _, message in agent_deltas
        if (item_id := event_item_id(message)) is not None
    }
    agent_completed_items = [event_item(message) for _, message in agent_completed]
    agent_completed_ids = {
        item["id"]
        for item in agent_completed_items
        if isinstance(item.get("id"), str)
    }
    agent_deltas_match = True
    for item in agent_completed_items:
        item_id = item.get("id")
        text = item.get("text")
        if not isinstance(item_id, str) or not isinstance(text, str):
            agent_deltas_match = False
            continue
        streamed = "".join(
            event_delta(message)
            for _, message in agent_deltas
            if event_item_id(message) == item_id
        )
        if streamed != text:
            agent_deltas_match = False

    final_agent_text = ""
    if agent_completed_items and isinstance(agent_completed_items[-1].get("text"), str):
        final_agent_text = agent_completed_items[-1]["text"]
    turn_status = None
    if completed:
        params = completed[-1][1].get("params")
        turn = params.get("turn") if isinstance(params, dict) else None
        if isinstance(turn, dict):
            turn_status = turn.get("status")

    item_indices = [index for index, _ in item_started + item_completed]
    turn_order_valid = (
        len(started) == 1
        and len(completed) == 1
        and bool(item_indices)
        and started[0][0] < min(item_indices)
        and max(item_indices) < completed[0][0]
    )
    command_expected_checks = {
        "oneCommandStarted": len(command_started) == 1,
        "oneCommandCompleted": len(command_completed) == 1,
        "commandStartBeforeCompletion": (
            len(command_started) == 1
            and len(command_completed) == 1
            and command_started[0][0] < command_completed[0][0]
        ),
        "commandItemIdStable": (
            len(command_started) == 1
            and len(command_completed) == 1
            and event_item_id(command_started[0][1])
            == event_item_id(command_completed[0][1])
            and all(
                event_item_id(message) == command_id
                for _, message in command_deltas
            )
        ),
        # Codex may send command output as deltas or only on the completed
        # command item. Both forms satisfy E5 when the controlled output is
        # complete. If deltas are present, they must still match that item.
        "commandOutputStreamedOrRepresentedWithoutLoss": (
            controlled_output_matches and command_deltas_match
        ),
        "commandOutputDeltasMatchCompletedWhenPresent": command_deltas_match,
        "commandCompleted": command_complete_item.get("status") == "completed",
        "commandExitCodeZero": command_complete_item.get("exitCode") == 0,
        "commandCwdMatchesWorkspace": (
            command_start_item.get("cwd") == str(workspace)
            and command_complete_item.get("cwd") == str(workspace)
        ),
        "commandOutputMatchesControlledFixture": controlled_output_matches,
    }
    command_absent_checks = {
        "noCommandStarted": not command_started,
        "noCommandCompleted": not command_completed,
        "noCommandOutputDelta": not command_deltas,
    }
    checks = {
        "turnStartedOnce": len(started) == 1,
        "turnCompletedOnce": len(completed) == 1,
        "turnCompleted": turn_status == "completed",
        "turnEventOrderValid": turn_order_valid,
        "agentMessageStreamed": bool(agent_deltas),
        "agentDeltasMatchCompletedItems": agent_deltas_match,
        "agentItemIdsStable": (
            bool(agent_completed_ids)
            and agent_completed_ids <= agent_started_ids
            and agent_delta_ids <= agent_completed_ids
        ),
        **(command_expected_checks if expect_command else command_absent_checks),
    }
    if expect_command:
        checks["finalReplyContainsWorkspace"] = any(
            spelling in final_agent_text
            for spelling in {str(workspace), str(workspace.resolve())}
        )
        checks["finalReplyContainsMarker"] = "CHIVE_SP2_MARKER" in final_agent_text
    if exact_reply is not None:
        checks["finalReplyExact"] = final_agent_text.strip() == exact_reply

    summary = {
        "status": turn_status,
        "eventCount": len(events),
        "timeline": compact_stream_timeline(events),
        "command": {
            "startedCount": len(command_started),
            "completedCount": len(command_completed),
            "outputDeltaCount": len(command_deltas),
            "outputDeltaObserved": bool(command_deltas),
            "outputLength": len(aggregated_output),
            "controlledOutputRetained": (
                redact_text(aggregated_output, workspace)
                if controlled_output_matches
                else None
            ),
        },
        "agent": {
            "messageCount": len(agent_completed),
            "deltaCount": len(agent_deltas),
            "deltaLength": sum(len(event_delta(message)) for _, message in agent_deltas),
            "finalTextLength": len(final_agent_text),
            "rawTextRetained": False,
        },
    }
    return checks, summary


def analyze_codex_interrupted_turn(
    messages: list[dict[str, Any]],
    turn_id: str,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Check an interrupted turn without retaining prompts or runtime text."""
    events = turn_server_events(messages, turn_id)
    turn_started = [
        (index, message)
        for index, message in events
        if message.get("method") == "turn/started"
    ]
    turn_completed = [
        (index, message)
        for index, message in events
        if message.get("method") == "turn/completed"
    ]
    command_started = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/started"
        and event_item(message).get("type") == "commandExecution"
    ]
    command_completed = [
        (index, message)
        for index, message in events
        if message.get("method") == "item/completed"
        and event_item(message).get("type") == "commandExecution"
    ]
    command_deltas = [
        message
        for _, message in events
        if message.get("method") == "item/commandExecution/outputDelta"
    ]

    terminal_status = None
    if turn_completed:
        params = turn_completed[-1][1].get("params")
        turn = params.get("turn") if isinstance(params, dict) else None
        if isinstance(turn, dict):
            terminal_status = turn.get("status")

    started_id = event_item_id(command_started[0][1]) if command_started else None
    completed_ids = {
        item_id
        for _, message in command_completed
        if (item_id := event_item_id(message)) is not None
    }
    delta_ids = {
        item_id
        for message in command_deltas
        if (item_id := event_item_id(message)) is not None
    }
    command_id_stable = (
        started_id is not None
        and (not completed_ids or completed_ids == {started_id})
        and delta_ids <= {started_id}
    )
    event_order_valid = (
        len(turn_started) == 1
        and len(command_started) == 1
        and len(turn_completed) == 1
        and turn_started[0][0] < command_started[0][0] < turn_completed[0][0]
    )

    completed_item = event_item(command_completed[-1][1]) if command_completed else {}
    aggregated_output = completed_item.get("aggregatedOutput")
    output_length = len(aggregated_output) if isinstance(aggregated_output, str) else 0
    checks = {
        "turnStartedOnce": len(turn_started) == 1,
        "commandStartedOnce": len(command_started) == 1,
        "commandItemIdStable": command_id_stable,
        "turnCompletedOnce": len(turn_completed) == 1,
        "turnStatusInterrupted": terminal_status == "interrupted",
        "turnEventOrderValid": event_order_valid,
    }
    summary = {
        "status": terminal_status,
        "eventCount": len(events),
        "timeline": compact_stream_timeline(events),
        "command": {
            "startedCount": len(command_started),
            "completedCount": len(command_completed),
            "completedStatus": completed_item.get("status"),
            "exitCode": completed_item.get("exitCode"),
            "outputDeltaCount": len(command_deltas),
            "outputLength": output_length,
            "rawOutputRetained": False,
        },
    }
    return checks, summary


def summarize_fixture_process_start(
    shell: dict[str, Any],
    child: dict[str, Any],
    run_id: str,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Prove the two observed PIDs belong to this fixture without saving commands."""
    shell_command = shell.get("ps") if isinstance(shell.get("ps"), str) else ""
    child_command = child.get("ps") if isinstance(child.get("ps"), str) else ""
    checks = {
        "toolShellRunning": shell.get("alive") is True,
        "toolChildRunning": child.get("alive") is True,
        "toolShellIdentityMatched": (
            "slow-command.sh" in shell_command and run_id in shell_command
        ),
        "toolChildIdentityMatched": (
            f".slow-child-{run_id}" in child_command and run_id in child_command
        ),
        "toolChildOwnedByShell": child.get("ppid") == shell.get("pid"),
        "toolProcessesShareGroup": (
            shell.get("pgid") is not None
            and child.get("pgid") == shell.get("pgid")
        ),
    }
    summary = {
        "shell": {
            "pid": shell.get("pid"),
            "ppid": shell.get("ppid"),
            "pgid": shell.get("pgid"),
            "alive": shell.get("alive"),
            "status": shell.get("status"),
        },
        "child": {
            "pid": child.get("pid"),
            "ppid": child.get("ppid"),
            "pgid": child.get("pgid"),
            "alive": child.get("alive"),
            "status": child.get("status"),
        },
        "relationships": {
            "childOwnedByShell": checks["toolChildOwnedByShell"],
            "sameProcessGroup": checks["toolProcessesShareGroup"],
        },
        "rawCommandsRetained": False,
    }
    return checks, summary


def summarize_fixture_process_end(
    snapshots: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Keep each controlled process state without retaining its command line."""
    roles = ("shell", "child")
    # Python 3.9 has no `zip(..., strict=True)`, so check the size plainly
    # before pairing the two known roles with their two exact PID snapshots.
    if len(snapshots) != len(roles):
        raise ValueError("expected one shell snapshot and one child snapshot")
    return {
        role: {
            "pid": snapshot.get("pid"),
            "ppid": snapshot.get("ppid"),
            "pgid": snapshot.get("pgid"),
            "alive": snapshot.get("alive"),
            "status": snapshot.get("status"),
        }
        for role, snapshot in zip(roles, snapshots)
    }


def safe_stream_transcript(
    process: JsonLineProcess,
    workspace: Path,
) -> dict[str, Any]:
    """Keep stream operation counts while discarding raw protocol responses."""
    request_methods = [
        entry.get("message", {}).get("method")
        for entry in process.messages
        if entry.get("direction") == "client"
        and isinstance(entry.get("message"), dict)
        and "id" in entry.get("message", {})
    ]
    event_method_counts: dict[str, int] = {}
    other_server_message_count = 0
    unparsed_line_kinds: dict[str, int] = {}
    for entry in process.messages:
        message = entry.get("message")
        if entry.get("direction") != "server" or not isinstance(message, dict):
            continue
        method = message.get("method")
        if method in E5_STREAM_EVENT_METHODS:
            event_method_counts[method] = event_method_counts.get(method, 0) + 1
        else:
            other_server_message_count += 1
        if "unparsed" in message:
            kind = classify_unparsed_line(message.get("unparsed"))
            unparsed_line_kinds[kind] = unparsed_line_kinds.get(kind, 0) + 1

    return redact(
        {
            "argv": process.argv,
            "cwd": str(process.cwd),
            "pid": process.process.pid,
            "exitCode": process.process.poll(),
            "elapsedMs": now_ms() - process.started_ms,
            "requestMethods": request_methods,
            "eventMethodCounts": dict(sorted(event_method_counts.items())),
            "otherServerMessageCount": other_server_message_count,
            "mcpStartupEventCount": sum(
                entry.get("direction") == "server"
                and isinstance(entry.get("message"), dict)
                and entry.get("message", {}).get("method")
                == "mcpServer/startupStatus/updated"
                for entry in process.messages
            ),
            "stderrLineCount": len(process.stderr),
            "unparsedServerLineKindCounts": dict(sorted(unparsed_line_kinds.items())),
            "rawResponsesRetained": False,
            "rawStderrRetained": False,
        },
        workspace,
    )


def codex_stream_probe() -> dict[str, Any]:
    """Run E5 stream fidelity and same-thread reuse.

    Initialize app-server under the sidecar with inherited user configuration.
    Start one ephemeral controlled-workspace thread. Ask Codex to run one shell
    command that prints the working directory and marker fixture. Verify event
    order, item ids, lossless command output, agent deltas, and final status.
    Command output may arrive as deltas or only on the completed command item.
    Send a second short turn on the same thread, then stop app-server cleanly.
    Save only controlled output, event shapes, counts, and checks.
    """
    with prepare_workspace("codex-stream") as temp:
        workspace = Path(temp)
        process = JsonLineProcess(
            codex_app_server_command(workspace, clear_inherited_mcp=False),
            cwd=workspace,
            writable_stdin=True,
        )
        try:
            initialized = request_codex_initialize(process, 1)
            process.send({"method": "initialized", "params": {}})
            thread = process.request(
                2,
                "thread/start",
                {
                    "cwd": str(workspace),
                    "sandbox": "danger-full-access",
                    "approvalPolicy": "never",
                    "ephemeral": True,
                    "model": TESTED_MODELS["codex"],
                },
            )
            thread_id = thread_id_from(thread)
            first_turn = process.request(
                3,
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {
                            "type": "text",
                            "text": (
                                "Use the shell tool exactly once to run "
                                "`/bin/pwd && /bin/cat ./probe-marker.txt`. "
                                "Then reply with the exact working directory "
                                "and marker."
                            ),
                        }
                    ],
                },
            )
            first_turn_id = turn_id_from(first_turn)
            process.wait_for(
                lambda message: message.get("method") == "turn/completed"
                and message_turn_id(message) == first_turn_id,
            )

            second_turn = process.request(
                4,
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {"type": "text", "text": "Reply with only SECOND_TURN_OK."}
                    ],
                },
            )
            second_turn_id = turn_id_from(second_turn)
            process.wait_for(
                lambda message: message.get("method") == "turn/completed"
                and message_turn_id(message) == second_turn_id,
            )

            first_checks, first_summary = analyze_codex_turn_stream(
                process.messages,
                first_turn_id,
                workspace,
                expect_command=True,
            )
            second_checks, second_summary = analyze_codex_turn_stream(
                process.messages,
                second_turn_id,
                workspace,
                expect_command=False,
                exact_reply="SECOND_TURN_OK",
            )
            exited_cleanly = stop_jsonl_server_cleanly(process)
            transcript = safe_stream_transcript(process, workspace)
            checks = {
                "connectionInitialized": "result" in initialized,
                "ephemeralThreadStarted": True,
                "firstTurnPassed": all(first_checks.values()),
                "secondTurnPassed": all(second_checks.values()),
                "sameThreadReused": transcript["requestMethods"].count(
                    "thread/start"
                )
                == 1,
                "twoTurnsStarted": transcript["requestMethods"].count("turn/start")
                == 2,
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "noRawStderrRetained": not transcript["rawStderrRetained"],
                "appServerExitedCleanly": exited_cleanly,
            }
            return {
                "runtime": "codex",
                "phase": 3,
                "experiment": "E5",
                "inheritedUserConfiguration": True,
                "configPostureEvidence": "e5-config-posture.run-20260728-015.json",
                "checks": checks,
                "firstTurn": {"checks": first_checks, "summary": first_summary},
                "secondTurn": {"checks": second_checks, "summary": second_summary},
                "transcript": transcript,
            }
        finally:
            process.close()


def codex_interrupt_probe() -> dict[str, Any]:
    """Run E6 and keep interruption, cleanup, and reuse as separate results.

    Initialize one Codex connection with inherited user configuration. Start an
    ephemeral thread and ask it to run the controlled slow fixture. Wait for
    the command event and both exact PID files before sending `turn/interrupt`.
    Check the terminal turn state, the shell, the child, and a later turn
    independently. Save no prompt, model text, command line, or raw stderr.
    """
    with prepare_workspace("codex-interrupt") as temp:
        workspace = Path(temp)
        run_id = f"e6-{os.getpid()}-{now_ms()}"
        process = JsonLineProcess(
            codex_app_server_command(workspace, clear_inherited_mcp=False),
            cwd=workspace,
            writable_stdin=True,
        )
        pids: list[int] = []
        try:
            initialized = request_codex_initialize(process, 1)
            process.send({"method": "initialized", "params": {}})
            thread = process.request(
                2,
                "thread/start",
                {
                    "cwd": str(workspace),
                    "sandbox": "danger-full-access",
                    "approvalPolicy": "never",
                    "ephemeral": True,
                    "model": TESTED_MODELS["codex"],
                },
            )
            thread_id = thread_id_from(thread)
            turn = process.request(
                3,
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {
                            "type": "text",
                            "text": (
                                "Use the shell tool exactly once to run "
                                f"`/bin/sh ./slow-command.sh {run_id}` now. "
                                "Wait for it to finish before replying."
                            ),
                        }
                    ],
                },
            )
            turn_id = turn_id_from(turn)
            process.wait_for(
                lambda message: (
                    message.get("method") == "item/started"
                    and message_turn_id(message) == turn_id
                    and event_item(message).get("type") == "commandExecution"
                )
            )

            # The files are written by the controlled shell after it has also
            # started its child. Waiting for both prevents a timer-only test.
            shell_pid = wait_for_pid_file(
                workspace / f".slow-parent-{run_id}.pid",
                process=process.process,
            )
            child_pid = wait_for_pid_file(
                workspace / f".slow-child-{run_id}.pid",
                process=process.process,
            )
            pids = [shell_pid, child_pid]
            shell_start = process_snapshot(shell_pid, workspace)
            child_start = process_snapshot(child_pid, workspace)
            start_checks, start_summary = summarize_fixture_process_start(
                shell_start,
                child_start,
                run_id,
            )

            interrupt_response = process.request(
                4,
                "turn/interrupt",
                {"threadId": thread_id, "turnId": turn_id},
            )
            process.wait_for(
                lambda message: (
                    message.get("method") == "turn/completed"
                    and message_turn_id(message) == turn_id
                )
            )
            interrupted_checks, interrupted_summary = (
                analyze_codex_interrupted_turn(process.messages, turn_id)
            )
            stopped = wait_until_stopped(pids, workspace=workspace)
            process_end = summarize_fixture_process_end(stopped)

            # Cleanup is a safety net, not part of the pass. Record whether it
            # was needed, then test if app-server can still run another turn.
            fallback_cleanup = clean_known_slow_processes(pids, run_id=run_id)
            after_fallback = wait_until_stopped(pids, workspace=workspace)
            fallback_end = summarize_fixture_process_end(after_fallback)
            later_turn = process.request(
                5,
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {"type": "text", "text": "Reply with only AFTER_INTERRUPT_OK."}
                    ],
                },
            )
            later_turn_id = turn_id_from(later_turn)
            process.wait_for(
                lambda message: (
                    message.get("method") == "turn/completed"
                    and message_turn_id(message) == later_turn_id
                )
            )
            later_checks, later_summary = analyze_codex_turn_stream(
                process.messages,
                later_turn_id,
                workspace,
                expect_command=False,
                exact_reply="AFTER_INTERRUPT_OK",
            )
            exited_cleanly = stop_jsonl_server_cleanly(process)
            transcript = safe_stream_transcript(process, workspace)
            checks = {
                "connectionInitialized": "result" in initialized,
                **start_checks,
                "interruptAcknowledged": "result" in interrupt_response,
                "turnStatusInterrupted": interrupted_checks[
                    "turnStatusInterrupted"
                ],
                "toolShellStopped": process_end["shell"]["alive"] is False,
                "toolChildStopped": process_end["child"]["alive"] is False,
                "fallbackLeftNoControlledProcess": (
                    fallback_end["shell"]["alive"] is False
                    and fallback_end["child"]["alive"] is False
                ),
                "laterTurnPassed": all(later_checks.values()),
                "sameThreadReused": transcript["requestMethods"].count(
                    "thread/start"
                )
                == 1,
                "appServerExitedCleanly": exited_cleanly,
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "noRawStderrRetained": not transcript["rawStderrRetained"],
            }
            return {
                "runtime": "codex",
                "phase": 4,
                "experiment": "E6",
                "inheritedUserConfiguration": True,
                "checks": checks,
                "interruptedTurn": {
                    "checks": interrupted_checks,
                    "summary": interrupted_summary,
                },
                "processes": {
                    "atStart": start_summary,
                    "afterInterrupt": process_end,
                    "fallbackCleanupActionCount": len(fallback_cleanup),
                    "afterFallbackCleanup": fallback_end,
                },
                "laterTurn": {"checks": later_checks, "summary": later_summary},
                "transcript": transcript,
            }
        finally:
            # If the probe itself fails, clean only commands carrying this
            # attempt's unique id, then stop and reap app-server.
            clean_known_slow_processes(pids, run_id=run_id)
            process.close()


def codex_lifecycle_target(
    boundary: str,
    roles: dict[str, dict[str, Any]],
) -> tuple[str, int, list[int]]:
    """Resolve one E7 boundary from the inspected process tree."""
    if boundary == "app-server-root":
        return "pid", int(roles["appServer"]["pid"]), [
            int(roles["appServer"]["pid"])
        ]
    if boundary == "app-server-group":
        pgid = int(roles["appServer"]["pgid"])
    elif boundary == "outer-sidecar-group":
        pgid = int(roles["sidecar"]["pgid"])
    else:
        raise ValueError(f"unknown E7 boundary: {boundary}")
    members = [
        int(row["pid"])
        for row in roles.values()
        if row.get("pgid") == pgid
    ]
    return "group", pgid, members


def send_lifecycle_signal(
    target_kind: str,
    target: int,
    signal_number: int,
) -> bool:
    """Send one signal through the already-validated PID or group seam."""
    if target_kind == "pid":
        return signal_owned_pid(target, signal_number)
    return signal_owned_group(target, signal_number)


def tool_processes_stopped(states: dict[str, dict[str, Any]]) -> bool:
    """Require both the controlled shell and child to be non-running."""
    return (
        states["toolShell"].get("alive") is False
        and states["toolChild"].get("alive") is False
    )


def codex_lifecycle_attempt(
    boundary: str,
    *,
    forced_only: bool = False,
) -> dict[str, Any]:
    """Run one E7 model turn, signal one boundary, and inspect exact PIDs."""
    with prepare_workspace(f"codex-lifecycle-{boundary}") as temp:
        workspace = Path(temp)
        run_id = f"e7-{os.getpid()}-{now_ms()}"
        process = JsonLineProcess(
            codex_app_server_command(workspace, clear_inherited_mcp=False),
            cwd=workspace,
            writable_stdin=True,
        )
        fixture_pids: list[int] = []
        try:
            initialized = request_codex_initialize(process, 1)
            process.send({"method": "initialized", "params": {}})
            thread = process.request(
                2,
                "thread/start",
                {
                    "cwd": str(workspace),
                    "sandbox": "danger-full-access",
                    "approvalPolicy": "never",
                    "ephemeral": True,
                    "model": TESTED_MODELS["codex"],
                },
            )
            thread_id = thread_id_from(thread)
            turn = process.request(
                3,
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {
                            "type": "text",
                            "text": (
                                "Use the shell tool exactly once to run "
                                f"`/bin/sh ./slow-command.sh {run_id}` now. "
                                "Wait for it to finish before replying."
                            ),
                        }
                    ],
                },
            )
            turn_id = turn_id_from(turn)
            process.wait_for(
                lambda message: (
                    message.get("method") == "item/started"
                    and message_turn_id(message) == turn_id
                    and event_item(message).get("type") == "commandExecution"
                )
            )
            shell_pid = wait_for_pid_file(
                workspace / f".slow-parent-{run_id}.pid",
                process=process.process,
            )
            child_pid = wait_for_pid_file(
                workspace / f".slow-child-{run_id}.pid",
                process=process.process,
            )
            fixture_pids = [shell_pid, child_pid]

            table = read_process_table()
            roles, lineage_checks = resolve_codex_lifecycle_roles(
                process.process.pid,
                shell_pid,
                child_pid,
                table,
            )
            shell_for_identity = {**roles["toolShell"], "ps": roles["toolShell"]["command"]}
            child_for_identity = {**roles["toolChild"], "ps": roles["toolChild"]["command"]}
            identity_checks, _ = summarize_fixture_process_start(
                shell_for_identity,
                child_for_identity,
                run_id,
            )
            before = safe_lifecycle_states(roles)
            target_kind, target, target_pids = codex_lifecycle_target(
                boundary,
                roles,
            )
            if not target_pids:
                raise RuntimeError("the E7 target had no known process members")

            term_sent = False
            kill_sent = False
            after_term: dict[str, dict[str, Any]] | None = None
            if forced_only:
                kill_sent = send_lifecycle_signal(target_kind, target, signal.SIGKILL)
                wait_until_stopped(target_pids, workspace=workspace, timeout=5)
            else:
                term_sent = send_lifecycle_signal(target_kind, target, signal.SIGTERM)
                target_after_term = wait_until_stopped(
                    target_pids,
                    workspace=workspace,
                    timeout=5,
                )
                after_term = safe_lifecycle_states(
                    refresh_lifecycle_roles(roles, workspace)
                )
                if any(row["alive"] for row in target_after_term):
                    kill_sent = send_lifecycle_signal(
                        target_kind,
                        target,
                        signal.SIGKILL,
                    )
                    wait_until_stopped(target_pids, workspace=workspace, timeout=5)

            after_boundary = safe_lifecycle_states(
                refresh_lifecycle_roles(roles, workspace)
            )
            boundary_stopped_tools = tool_processes_stopped(after_boundary)

            # Finish the outer harness after the measured boundary. This keeps
            # test cleanup separate from the result being measured.
            outer_harness_cleanup_needed = process.process.poll() is None
            process.close()
            fallback_cleanup = clean_known_slow_processes(
                fixture_pids,
                run_id=run_id,
            )
            after_fallback_rows = wait_until_stopped(
                fixture_pids,
                workspace=workspace,
            )
            after_fallback = summarize_fixture_process_end(after_fallback_rows)
            transcript = safe_stream_transcript(process, workspace)

            checks = {
                "connectionInitialized": "result" in initialized,
                **lineage_checks,
                **identity_checks,
                "requestedSignalSent": kill_sent if forced_only else term_sent,
                "toolShellStoppedByBoundary": (
                    after_boundary["toolShell"]["alive"] is False
                ),
                "toolChildStoppedByBoundary": (
                    after_boundary["toolChild"]["alive"] is False
                ),
                "boundaryStoppedBothToolProcesses": boundary_stopped_tools,
                "fallbackLeftNoControlledProcess": (
                    after_fallback["shell"]["alive"] is False
                    and after_fallback["child"]["alive"] is False
                ),
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "noRawStderrRetained": not transcript["rawStderrRetained"],
            }
            return {
                "boundary": boundary,
                "forcedOnly": forced_only,
                "target": {
                    "kind": target_kind,
                    "sameGroupAsOuterSidecar": (
                        target_kind == "group"
                        and target == roles["sidecar"]["pgid"]
                    ),
                },
                "checks": checks,
                "signals": {
                    "termSent": term_sent,
                    "killSent": kill_sent,
                },
                "states": {
                    "before": before,
                    "afterTerm": after_term,
                    "afterBoundary": after_boundary,
                    "afterFallbackCleanup": after_fallback,
                },
                "cleanup": {
                    "outerHarnessCleanupNeeded": outer_harness_cleanup_needed,
                    "fallbackCleanupActionCount": len(fallback_cleanup),
                },
                "transcript": transcript,
            }
        finally:
            clean_known_slow_processes(fixture_pids, run_id=run_id)
            process.close()


def codex_lifecycle_probe() -> dict[str, Any]:
    """Run E7 against existing lifecycle seams without designing a new one."""
    attempts = {
        boundary: codex_lifecycle_attempt(boundary)
        for boundary in (
            "app-server-root",
            "app-server-group",
            "outer-sidecar-group",
        )
    }
    passing_boundaries = [
        boundary
        for boundary, attempt in attempts.items()
        if attempt["checks"]["boundaryStoppedBothToolProcesses"]
    ]
    candidate: dict[str, Any]
    if passing_boundaries:
        boundary = passing_boundaries[0]
        normal_attempt = attempts[boundary]
        if normal_attempt["signals"]["killSent"]:
            forced_attempt = normal_attempt
        else:
            forced_attempt = codex_lifecycle_attempt(boundary, forced_only=True)
            attempts[f"{boundary}-forced"] = forced_attempt
        candidate = {
            "available": True,
            "boundary": boundary,
            "normalAttemptStoppedBoth": normal_attempt["checks"][
                "boundaryStoppedBothToolProcesses"
            ],
            "forcedAttemptStoppedBoth": forced_attempt["checks"][
                "boundaryStoppedBothToolProcesses"
            ],
        }
    else:
        candidate = {
            "available": False,
            "reason": "no existing tested boundary stopped both tool processes",
        }

    return {
        "runtime": "codex",
        "phase": 4,
        "experiment": "E7",
        "inheritedUserConfiguration": True,
        "attempts": attempts,
        "finalCandidate": candidate,
        "productionVerdict": (
            "VIABLE_PROTOCOL"
            if candidate.get("available")
            and candidate.get("normalAttemptStoppedBoth")
            and candidate.get("forcedAttemptStoppedBoth")
            else "VIABLE_PROTOCOL_PRODUCTION_BLOCKED"
        ),
    }


def codex_handshake_and_turn(workspace: Path) -> dict[str, Any]:
    """Test Codex initialization, thread settings, streaming, and reuse."""
    process = JsonLineProcess(
        codex_app_server_command(workspace),
        cwd=workspace,
        writable_stdin=True,
    )
    try:
        checks = check_codex_initialization(process)
        thread_checks, primary_thread = check_codex_thread_config(
            process,
            workspace,
        )
        checks.update(thread_checks)

        thread_id = thread_id_from(primary_thread)
        turn = process.request(
            9,
            "turn/start",
            {
                "threadId": thread_id,
                "input": [
                    {
                        "type": "text",
                        "text": (
                            "Use the shell tool exactly once to run `/bin/pwd && /bin/cat "
                            "./probe-marker.txt`. Then reply with the exact marker and working directory."
                        ),
                    }
                ],
            },
        )
        turn_id = turn_id_from(turn)
        completed = process.wait_for(
            lambda message: message.get("method") == "turn/completed"
            and message.get("params", {}).get("turn", {}).get("id") == turn_id,
        )
        completed_turn = completed.get("params", {}).get("turn", {})
        checks["turnCompleted"] = completed_turn.get("status") == "completed"
        checks["agentDeltaStreamed"] = any(
            item.get("message", {}).get("method") == "item/agentMessage/delta"
            for item in process.messages
        )
        checks["commandItemStreamed"] = any(
            item.get("message", {}).get("method") == "item/started"
            and item.get("message", {}).get("params", {}).get("item", {}).get("type")
            == "commandExecution"
            for item in process.messages
        )
        checks["launchOverrideClearedInheritedMcp"] = not any(
            item.get("message", {}).get("method") == "mcpServer/startupStatus/updated"
            for item in process.messages
        )
        second_turn = process.request(
            10,
            "turn/start",
            {
                "threadId": thread_id,
                "input": [{"type": "text", "text": "Reply with only SECOND_TURN_OK."}],
            },
        )
        second_turn_id = turn_id_from(second_turn)
        second_completed = process.wait_for(
            lambda message: message.get("method") == "turn/completed"
            and message.get("params", {}).get("turn", {}).get("id")
            == second_turn_id,
        )
        checks["secondTurnSameThreadCompleted"] = (
            second_completed.get("params", {}).get("turn", {}).get("status")
            == "completed"
        )
        checks["outerNonoDiagnosticsPresent"] = any(
            "nono" in line.lower() or "sandbox" in line.lower()
            for line in process.stderr
        )
        return {"checks": checks, "transcript": process.evidence()}
    finally:
        process.close()


def codex_interrupt(workspace: Path) -> dict[str, Any]:
    """Interrupt a Codex tool call and inspect protocol and process outcomes."""
    run_id = "codex-interrupt"
    process = JsonLineProcess(
        codex_app_server_command(workspace),
        cwd=workspace,
        writable_stdin=True,
    )
    pids: list[int] = []
    try:
        process.request(
            1,
            "initialize",
            {
                "clientInfo": {
                    "name": "chive_sp2_probe",
                    "title": "Chive SP2 Probe",
                    "version": "0.1.0",
                }
            },
        )
        process.send({"method": "initialized", "params": {}})
        thread = process.request(
            2,
            "thread/start",
            {
                "cwd": str(workspace),
                "sandbox": "danger-full-access",
                "approvalPolicy": "never",
                "ephemeral": True,
                "model": TESTED_MODELS["codex"],
                "config": {"mcp_servers": {}},
            },
        )
        thread_id = thread_id_from(thread)
        turn = process.request(
            3,
            "turn/start",
            {
                "threadId": thread_id,
                "input": [
                    {
                        "type": "text",
                        "text": (
                            "Use the shell tool now to run `/bin/sh ./slow-command.sh "
                            f"{run_id}`. Wait for it to finish before replying."
                        ),
                    }
                ],
            },
        )
        turn_id = turn_id_from(turn)
        process.wait_for(
            lambda message: message.get("method") == "item/started"
            and message.get("params", {}).get("item", {}).get("type") == "commandExecution"
        )
        # The PID files prove the tool call really started. Interrupting earlier
        # would only test model generation, not cancellation during a tool call.
        parent_pid = wait_for_pid_file(workspace / f".slow-parent-{run_id}.pid")
        child_pid = wait_for_pid_file(workspace / f".slow-child-{run_id}.pid")
        pids = [parent_pid, child_pid]
        interrupt = process.request(
            4,
            "turn/interrupt",
            {"threadId": thread_id, "turnId": turn_id},
        )
        completed = process.wait_for(
            lambda message: message.get("method") == "turn/completed"
            and message.get("params", {}).get("turn", {}).get("id") == turn_id
        )
        stopped = wait_until_stopped(pids, workspace=workspace)
        # Protocol cancellation should not poison the conversation even when
        # process cleanup fails, so test reuse as a separate assertion.
        later_turn = process.request(
            5,
            "turn/start",
            {
                "threadId": thread_id,
                "input": [
                    {"type": "text", "text": "Reply with only AFTER_INTERRUPT_OK."}
                ],
            },
        )
        later_turn_id = turn_id_from(later_turn)
        later_completed = process.wait_for(
            lambda message: message.get("method") == "turn/completed"
            and message.get("params", {}).get("turn", {}).get("id")
            == later_turn_id,
        )
        return {
            "checks": {
                "interruptAcknowledged": "result" in interrupt,
                "turnStatus": completed.get("params", {}).get("turn", {}).get("status"),
                "fixtureProcessesStopped": not any(item["alive"] for item in stopped),
                "laterTurnCompleted": (
                    later_completed.get("params", {}).get("turn", {}).get("status")
                    == "completed"
                ),
            },
            "processesAfterInterrupt": stopped,
            "transcript": process.evidence(),
        }
    finally:
        process.close()
        clean_known_slow_processes(pids, run_id=run_id)


def codex_group_cleanup(workspace: Path) -> dict[str, Any]:
    """Stop the outer test group and check whether tool processes also stop."""
    run_id = "codex-group-kill"
    process = JsonLineProcess(
        codex_app_server_command(workspace),
        cwd=workspace,
        writable_stdin=True,
    )
    pids: list[int] = []
    try:
        process.request(
            1,
            "initialize",
            {
                "clientInfo": {
                    "name": "chive_sp2_probe",
                    "title": "Chive SP2 Probe",
                    "version": "0.1.0",
                }
            },
        )
        process.send({"method": "initialized", "params": {}})
        thread = process.request(
            2,
            "thread/start",
            {
                "cwd": str(workspace),
                "sandbox": "danger-full-access",
                "approvalPolicy": "never",
                "ephemeral": True,
                "model": TESTED_MODELS["codex"],
                "config": {"mcp_servers": {}},
            },
        )
        thread_id = thread_id_from(thread)
        process.request(
            3,
            "turn/start",
            {
                "threadId": thread_id,
                "input": [
                    {
                        "type": "text",
                        "text": (
                            "Use the shell tool now to run `/bin/sh ./slow-command.sh "
                            f"{run_id}`. Wait for it to finish before replying."
                        ),
                    }
                ],
            },
        )
        process.wait_for(
            lambda message: message.get("method") == "item/started"
            and message.get("params", {}).get("item", {}).get("type") == "commandExecution"
        )
        parent_pid = wait_for_pid_file(workspace / f".slow-parent-{run_id}.pid")
        child_pid = wait_for_pid_file(workspace / f".slow-child-{run_id}.pid")
        pids = [parent_pid, child_pid]
        # Stop the outer group first. A child in another group may survive, which
        # is exactly the lifecycle boundary this test measures.
        process.signal_group(signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.signal_group(signal.SIGKILL)
            process.wait(timeout=5)
        stopped = wait_until_stopped(pids, workspace=workspace)
        return {
            "checks": {
                "appServerExited": process.process.returncode is not None,
                "fixtureProcessesStopped": not any(item["alive"] for item in stopped),
            },
            "processesAfterGroupKill": stopped,
            "transcript": process.evidence(),
        }
    finally:
        process.close()
        clean_known_slow_processes(pids, run_id=run_id)


def codex_probe() -> dict[str, Any]:
    """Run the complete Codex test set in one controlled workspace."""
    with prepare_workspace("codex") as temp:
        workspace = Path(temp)
        return {
            "runtime": "codex",
            "configIsolation": codex_config_inheritance(workspace),
            "handshakeConfigAndStream": codex_handshake_and_turn(workspace),
            "interrupt": codex_interrupt(workspace),
            "groupCleanup": codex_group_cleanup(workspace),
        }


def run_jsonl_turn(argv: list[str], workspace: Path) -> dict[str, Any]:
    """Run one one-shot JSONL runtime turn through normal process exit."""
    process = JsonLineProcess(argv, cwd=workspace, writable_stdin=False)
    try:
        exit_code = process.wait()
        return {"exitCode": exit_code, "transcript": process.evidence()}
    finally:
        process.close()


def interrupt_jsonl_turn(
    argv: list[str],
    workspace: Path,
    run_id: str,
) -> dict[str, Any]:
    """Signal a one-shot runtime during the controlled slow command."""
    process = JsonLineProcess(argv, cwd=workspace, writable_stdin=False)
    pids: list[int] = []
    try:
        parent_pid = wait_for_pid_file(
            workspace / f".slow-parent-{run_id}.pid",
            timeout=120,
            process=process.process,
        )
        child_pid = wait_for_pid_file(
            workspace / f".slow-child-{run_id}.pid",
            timeout=10,
            process=process.process,
        )
        pids = [parent_pid, child_pid]
        # Claude and OpenCode do not use the Codex interrupt request here. Their
        # smoke test measures the wrapper's OS-signal behavior instead.
        process.signal_group(signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.signal_group(signal.SIGKILL)
            process.wait(timeout=5)
        stopped = wait_until_stopped(pids, workspace=workspace)
        return {
            "checks": {
                "processExitedAfterSignal": process.process.returncode is not None,
                "fixtureProcessesStopped": not any(item["alive"] for item in stopped),
            },
            "processesAfterInterrupt": stopped,
            "transcript": process.evidence(),
        }
    except Exception as error:
        process.close()
        return {
            "checks": {
                "processExitedBeforeFixture": process.process.returncode is not None,
                "fixtureProcessesStopped": None,
            },
            "error": f"{type(error).__name__}: {redact_text(str(error), workspace)}",
            "transcript": process.evidence(),
        }
    finally:
        process.close()
        clean_known_slow_processes(pids, run_id=run_id)


def claude_command(workspace: Path, prompt: str) -> list[str]:
    """Build the exact Claude command used by both smoke tests."""
    child = [
        str(command_path("claude")),
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--tools",
        "Bash",
        "--settings",
        str(workspace / "claude-settings.json"),
        "--model",
        TESTED_MODELS["claude"],
        prompt,
    ]
    return sidecar_command("claude", workspace, child)


def claude_json_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return valid Claude JSON messages and leave non-JSON lines separate."""
    return [
        message
        for entry in messages
        if entry.get("direction") == "server"
        and isinstance((message := entry.get("message")), dict)
        and "unparsed" not in message
    ]


def claude_content_blocks(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Read content blocks from one complete assistant or user message."""
    envelope = message.get("message")
    if not isinstance(envelope, dict):
        return []
    content = envelope.get("content")
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict)]


def nested_strings(value: Any) -> list[str]:
    """Collect strings for in-memory checks without deciding what is private."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [text for item in value for text in nested_strings(item)]
    if isinstance(value, dict):
        return [text for item in value.values() for text in nested_strings(item)]
    return []


def controlled_claude_output_matches(value: Any, workspace: Path) -> bool:
    """Find the controlled cwd and marker inside a Claude tool result."""
    workspace_spellings = {str(workspace), str(workspace.resolve())}
    for text in nested_strings(value):
        lines = normalized_lines(text)
        if any(spelling in lines for spelling in workspace_spellings) and (
            "CHIVE_SP2_MARKER" in lines
        ):
            return True
    return False


def analyze_claude_stream(
    messages: list[dict[str, Any]],
    workspace: Path,
    *,
    require_completed_result: bool,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Check Claude stream shapes while retaining no arbitrary runtime text."""
    values = claude_json_messages(messages)
    init_events = [
        message
        for message in values
        if message.get("type") == "system" and message.get("subtype") == "init"
    ]
    stream_events = [message for message in values if message.get("type") == "stream_event"]
    assistant_messages = [
        message for message in values if message.get("type") == "assistant"
    ]
    user_messages = [message for message in values if message.get("type") == "user"]
    result_events = [message for message in values if message.get("type") == "result"]

    tool_uses = [
        block
        for message in assistant_messages
        for block in claude_content_blocks(message)
        if block.get("type") == "tool_use" and block.get("name") == "Bash"
    ]
    tool_results = [
        block
        for message in user_messages
        for block in claude_content_blocks(message)
        if block.get("type") == "tool_result"
    ]
    expected_command = "/bin/pwd && /bin/cat ./probe-marker.txt"
    controlled_command_requested = any(
        isinstance(block.get("input"), dict)
        and block["input"].get("command") == expected_command
        for block in tool_uses
    )
    controlled_output_matches = any(
        controlled_claude_output_matches(block.get("content"), workspace)
        and block.get("is_error") is not True
        for block in tool_results
    )

    init = init_events[-1] if init_events else {}
    final_result = result_events[-1] if result_events else {}
    final_text = final_result.get("result")
    if not isinstance(final_text, str):
        final_text = ""
    workspace_spellings = {str(workspace), str(workspace.resolve())}
    checks = {
        "initObserved": len(init_events) == 1,
        "initCwdMatchesWorkspace": init.get("cwd") in workspace_spellings,
        "initPermissionModeBypassesInnerChecks": (
            init.get("permissionMode") == "bypassPermissions"
        ),
        "initModelMatches": init.get("model") == TESTED_MODELS["claude"],
        "assistantMessageObserved": bool(assistant_messages),
        "partialStreamEventObserved": bool(stream_events),
        "bashToolUseObserved": bool(tool_uses),
    }
    if require_completed_result:
        checks.update(
            {
                "controlledCommandRequested": controlled_command_requested,
                "toolResultObserved": bool(tool_results),
                "controlledOutputMatches": controlled_output_matches,
                "resultObservedOnce": len(result_events) == 1,
                "resultSucceeded": (
                    final_result.get("subtype") == "success"
                    and final_result.get("is_error") is False
                    and final_result.get("terminal_reason") == "completed"
                ),
                "finalReplyContainsWorkspace": any(
                    spelling in final_text for spelling in workspace_spellings
                ),
                "finalReplyContainsMarker": "CHIVE_SP2_MARKER" in final_text,
            }
        )

    message_type_counts: dict[str, int] = {}
    stream_event_type_counts: dict[str, int] = {}
    for message in values:
        message_type = message.get("type")
        if isinstance(message_type, str):
            message_type_counts[message_type] = message_type_counts.get(message_type, 0) + 1
        event = message.get("event")
        event_type = event.get("type") if isinstance(event, dict) else None
        if isinstance(event_type, str):
            stream_event_type_counts[event_type] = (
                stream_event_type_counts.get(event_type, 0) + 1
            )
    summary = {
        "messageTypeCounts": dict(sorted(message_type_counts.items())),
        "streamEventTypeCounts": dict(sorted(stream_event_type_counts.items())),
        "bashToolUseCount": len(tool_uses),
        "toolResultCount": len(tool_results),
        "resultCount": len(result_events),
        "controlledOutputRetained": (
            "<WORKSPACE>\nCHIVE_SP2_MARKER\n"
            if controlled_output_matches
            else None
        ),
        "rawTextRetained": False,
    }
    return checks, summary


def safe_claude_transcript(
    process: JsonLineProcess,
    workspace: Path,
) -> dict[str, Any]:
    """Keep Claude event counts and launch posture without prompts or text."""
    unparsed_line_kinds: dict[str, int] = {}
    for entry in process.messages:
        message = entry.get("message")
        if entry.get("direction") != "server" or not isinstance(message, dict):
            continue
        if "unparsed" in message:
            kind = classify_unparsed_line(message.get("unparsed"))
            unparsed_line_kinds[kind] = unparsed_line_kinds.get(kind, 0) + 1
    return {
        "runtime": "claude",
        "cwd": "<WORKSPACE>",
        "exitCode": process.process.poll(),
        "elapsedMs": now_ms() - process.started_ms,
        "launch": {
            "nonoProfile": NONO_PROFILES["claude"],
            "network": "open",
            "model": TESTED_MODELS["claude"],
            "outputFormat": "stream-json",
            "includePartialMessages": True,
            "sessionPersistence": False,
            "permissionMode": "bypassPermissions",
            "safeMode": True,
            "strictMcpConfig": True,
            "configuredMcpServerCount": 0,
            "tools": ["Bash"],
            "controlledSettings": "<WORKSPACE>/claude-settings.json",
            "bareMode": False,
            "runtimeChildArgv": safe_runtime_child_argv(
                claude_command(workspace, "<CONTROLLED_PROMPT>"),
                "claude",
                workspace,
            ),
        },
        "stderrLineCount": len(process.stderr),
        "unparsedServerLineKindCounts": dict(sorted(unparsed_line_kinds.items())),
        "rawResponsesRetained": False,
        "rawPromptsRetained": False,
        "rawStderrRetained": False,
    }


def run_claude_normal_turn(workspace: Path) -> dict[str, Any]:
    """Run the normal Claude smoke turn and save only controlled stream facts."""
    prompt = (
        "Use Bash exactly once to run `/bin/pwd && /bin/cat ./probe-marker.txt`. "
        "Then reply with the exact marker and working directory."
    )
    process = JsonLineProcess(
        claude_command(workspace, prompt),
        cwd=workspace,
        writable_stdin=False,
    )
    try:
        exit_code = process.wait()
        checks, summary = analyze_claude_stream(
            process.messages,
            workspace,
            require_completed_result=True,
        )
        transcript = safe_claude_transcript(process, workspace)
        checks.update(
            {
                "processExitedZero": exit_code == 0,
                "controlledSettingsDisableInnerSandbox": json.loads(
                    (workspace / "claude-settings.json").read_text(encoding="utf-8")
                )
                == {"sandbox": {"enabled": False}},
                "allStdoutJsonOrKnownWarning": set(
                    transcript["unparsedServerLineKindCounts"]
                )
                <= {"knownNonoNoRollbackWarning"},
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "noRawStderrRetained": not transcript["rawStderrRetained"],
            }
        )
        return {
            "checks": checks,
            "summary": summary,
            "transcript": transcript,
        }
    finally:
        process.close()


def run_claude_interrupted_turn(workspace: Path) -> dict[str, Any]:
    """Signal Claude during the controlled slow command and inspect both PIDs."""
    run_id = f"claude-{os.getpid()}-{now_ms()}"
    prompt = (
        "Use Bash exactly once to run "
        f"`/bin/sh ./slow-command.sh {run_id}` now. "
        "Wait for it to finish before replying."
    )
    process = JsonLineProcess(
        claude_command(workspace, prompt),
        cwd=workspace,
        writable_stdin=False,
    )
    pids: list[int] = []
    try:
        shell_pid = wait_for_pid_file(
            workspace / f".slow-parent-{run_id}.pid",
            timeout=120,
            process=process.process,
        )
        child_pid = wait_for_pid_file(
            workspace / f".slow-child-{run_id}.pid",
            timeout=10,
            process=process.process,
        )
        pids = [shell_pid, child_pid]
        shell_start = process_snapshot(shell_pid, workspace)
        child_start = process_snapshot(child_pid, workspace)
        start_checks, start_summary = summarize_fixture_process_start(
            shell_start,
            child_start,
            run_id,
        )

        term_sent = True
        process.signal_group(signal.SIGTERM)
        kill_sent = False
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            kill_sent = True
            process.signal_group(signal.SIGKILL)
            process.wait(timeout=5)
        stopped = wait_until_stopped(pids, workspace=workspace)
        process_end = summarize_fixture_process_end(stopped)
        fallback_cleanup = clean_known_slow_processes(pids, run_id=run_id)
        after_fallback_rows = wait_until_stopped(pids, workspace=workspace)
        fallback_end = summarize_fixture_process_end(after_fallback_rows)
        stream_checks, stream_summary = analyze_claude_stream(
            process.messages,
            workspace,
            require_completed_result=False,
        )
        transcript = safe_claude_transcript(process, workspace)
        checks = {
            **start_checks,
            "streamReachedBashToolUse": stream_checks["bashToolUseObserved"],
            "termSentToSupervisedGroup": term_sent,
            "supervisedProcessExited": process.process.poll() is not None,
            "toolShellStopped": process_end["shell"]["alive"] is False,
            "toolChildStopped": process_end["child"]["alive"] is False,
            "fallbackLeftNoControlledProcess": (
                fallback_end["shell"]["alive"] is False
                and fallback_end["child"]["alive"] is False
            ),
            "noRawResponsesRetained": not transcript["rawResponsesRetained"],
            "noRawStderrRetained": not transcript["rawStderrRetained"],
        }
        return {
            "checks": checks,
            "signals": {"termSent": term_sent, "killSent": kill_sent},
            "stream": {"checks": stream_checks, "summary": stream_summary},
            "processes": {
                "atStart": start_summary,
                "afterSignal": process_end,
                "fallbackCleanupActionCount": len(fallback_cleanup),
                "afterFallbackCleanup": fallback_end,
            },
            "transcript": transcript,
        }
    finally:
        clean_known_slow_processes(pids, run_id=run_id)
        process.close()


def claude_probe() -> dict[str, Any]:
    """Run the sanitized Phase 5 normal and interrupted Claude smoke tests."""
    with prepare_workspace("claude") as temp:
        workspace = Path(temp)
        version = claude_version_probe()
        auth = claude_auth_probe()
        readiness = {
            "versionCommandSucceeded": version["exitCode"] == 0,
            "versionMatchesPhaseZero": (
                version["version"] == EXPECTED_CLAUDE_VERSION
            ),
            "authCommandSucceeded": auth["exitCode"] == 0,
            "authStatusParsed": auth["statusParsed"] is True,
            "savedLoginAvailable": auth["status"].get("loggedIn") is True,
        }
        # Do not send a model-backed prompt unless the installed runtime and
        # saved login still match the readiness facts proved in Phase 0.
        if all(readiness.values()):
            normal = run_claude_normal_turn(workspace)
        else:
            normal = {
                "checks": {},
                "notTested": "Claude version or saved-login readiness failed",
            }

        # An interrupted turn is meaningful only after the same command shape
        # proves it can reach a normal model-backed tool call.
        if normal["checks"] and all(normal["checks"].values()):
            interrupted = run_claude_interrupted_turn(workspace)
        else:
            interrupted = {
                "checks": {},
                "notTested": "normal streamed turn did not pass every check",
            }
        return {
            "runtime": "claude",
            "phase": 5,
            "readinessChecks": readiness,
            "version": version,
            "auth": auth,
            "normalTurn": normal,
            "interruptedTurn": interrupted,
        }


def opencode_command(workspace: Path, prompt: str) -> list[str]:
    """Build the exact OpenCode command used by both smoke tests."""
    child = [
        str(pinned_opencode_path()),
        "run",
        "--format",
        "json",
        "--pure",
        "--auto",
        "--dir",
        str(workspace),
        "--title",
        "Chive SP2 probe",
        "--model",
        TESTED_MODELS["opencode"],
        prompt,
    ]
    return sidecar_command("opencode", workspace, child)


def reserve_loopback_port() -> int:
    """Ask macOS for an unused loopback port for one short server attempt."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def opencode_server_command(workspace: Path, port: int) -> list[str]:
    """Build the pinned local OpenCode server command used for interruption."""
    child = [
        str(pinned_opencode_path()),
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        str(port),
        "--pure",
    ]
    return sidecar_command("opencode", workspace, child)


def opencode_api_url(base_url: str, path: str, workspace: Path) -> str:
    """Add the controlled workspace selector to one loopback API URL."""
    query = urlparse.urlencode({"directory": str(workspace)})
    return f"{base_url}{path}?{query}"


def opencode_http_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout: int = 10,
) -> tuple[int, Any]:
    """Send one bounded loopback request and parse its JSON response."""
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urlrequest.Request(url, data=body, headers=headers, method=method)
    with urlrequest.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None


def wait_for_opencode_server(
    process: JsonLineProcess,
    base_url: str,
    workspace: Path,
    *,
    timeout: int = 30,
) -> None:
    """Poll the local session endpoint until the server accepts requests."""
    deadline = time.monotonic() + timeout
    url = opencode_api_url(base_url, "/session", workspace)
    while time.monotonic() < deadline:
        if process.process.poll() is not None:
            raise RuntimeError("OpenCode server exited before readiness")
        try:
            status, value = opencode_http_json("GET", url, timeout=1)
            if status == 200 and isinstance(value, list):
                return
        except OSError:
            pass
        time.sleep(0.05)
    raise TimeoutError("timed out waiting for the local OpenCode server")


class ServerSentEventCollector:
    """Collect OpenCode loopback SSE events in memory until the test finishes."""

    def __init__(self, url: str) -> None:
        """Open the event stream on a background thread."""
        self.url = url
        self.events: list[dict[str, Any]] = []
        self.ready = threading.Event()
        self.error_type: str | None = None
        self._response: Any = None
        self._thread = threading.Thread(target=self._read, daemon=True)
        self._thread.start()

    def _read(self) -> None:
        """Parse only JSON `data:` records and keep arbitrary text in memory."""
        request = urlrequest.Request(
            self.url,
            headers={"Accept": "text/event-stream"},
        )
        data_lines: list[str] = []
        try:
            with urlrequest.urlopen(request, timeout=180) as response:
                self._response = response
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
                        continue
                    if line or not data_lines:
                        continue
                    try:
                        value = json.loads("\n".join(data_lines))
                    except json.JSONDecodeError:
                        data_lines.clear()
                        continue
                    data_lines.clear()
                    if isinstance(value, dict):
                        event = value.get("payload", value)
                        if isinstance(event, dict):
                            self.events.append(event)
                            self.ready.set()
        except Exception as error:
            # The response is deliberately closed when the test ends. Keep
            # only an error kind, never its URL or response text.
            self.error_type = type(error).__name__
            self.ready.set()

    def close(self) -> None:
        """Close the loopback response and give the reader time to finish."""
        if self._response is not None:
            self._response.close()
        self._thread.join(timeout=2)


def wait_for_server_event(
    collector: ServerSentEventCollector,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout: int = 30,
) -> dict[str, Any]:
    """Wait for one matching in-memory server event within a fixed deadline."""
    deadline = time.monotonic() + timeout
    cursor = 0
    while time.monotonic() < deadline:
        while cursor < len(collector.events):
            event = collector.events[cursor]
            cursor += 1
            if predicate(event):
                return event
        time.sleep(0.02)
    raise TimeoutError("timed out waiting for an OpenCode server event")


def opencode_server_tool_event(
    event: dict[str, Any],
    session_id: str,
    status: str,
) -> bool:
    """Match one Bash tool-state update for the exact test session."""
    if event.get("type") != "message.part.updated":
        return False
    properties = event.get("properties")
    if not isinstance(properties, dict):
        return False
    part = properties.get("part")
    if not isinstance(part, dict):
        return False
    state = part.get("state")
    return (
        part.get("sessionID") == session_id
        and part.get("type") == "tool"
        and str(part.get("tool", "")).casefold() == "bash"
        and isinstance(state, dict)
        and state.get("status") == status
    )


def summarize_opencode_server_events(
    events: list[dict[str, Any]],
    session_id: str,
) -> dict[str, Any]:
    """Count server events and tool states without keeping any event content."""
    type_counts: dict[str, int] = {}
    for event in events:
        event_type = event.get("type")
        if isinstance(event_type, str):
            type_counts[event_type] = type_counts.get(event_type, 0) + 1
    return {
        "eventTypeCounts": dict(sorted(type_counts.items())),
        "bashRunningObserved": any(
            opencode_server_tool_event(event, session_id, "running")
            for event in events
        ),
        "bashCompletedObserved": any(
            opencode_server_tool_event(event, session_id, "completed")
            for event in events
        ),
        "bashErrorObserved": any(
            opencode_server_tool_event(event, session_id, "error")
            for event in events
        ),
        "rawEventsRetained": False,
    }


def opencode_version_probe(opencode: Path) -> dict[str, Any]:
    """Keep the pinned OpenCode version and discard arbitrary diagnostics."""
    command = run_command([str(opencode), "--version"])
    stdout = str(command.pop("stdout", "")).strip()
    stderr = str(command.pop("stderr", ""))
    match = re.match(r"^(\d+\.\d+\.\d+)\b", stdout)
    command["version"] = match.group(1) if match else None
    command["sha256"] = sha256_file(opencode)
    command["stderrLineCount"] = len(stderr.splitlines())
    command["rawOutputRetained"] = False
    return command


def opencode_json_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return parsed OpenCode JSON records and leave other lines separate."""
    return [
        message
        for entry in messages
        if entry.get("direction") == "server"
        and isinstance((message := entry.get("message")), dict)
        and "unparsed" not in message
    ]


def opencode_part(message: dict[str, Any]) -> dict[str, Any]:
    """Read one OpenCode message part without trusting its shape."""
    part = message.get("part")
    return part if isinstance(part, dict) else {}


def analyze_opencode_stream(
    messages: list[dict[str, Any]],
    workspace: Path,
    *,
    require_completed_result: bool,
) -> tuple[dict[str, bool], dict[str, Any]]:
    """Check OpenCode JSON events while retaining no arbitrary runtime text."""
    values = opencode_json_messages(messages)
    step_starts = [value for value in values if value.get("type") == "step_start"]
    step_finishes = [value for value in values if value.get("type") == "step_finish"]
    tool_events = [value for value in values if value.get("type") == "tool_use"]
    text_events = [value for value in values if value.get("type") == "text"]
    error_events = [value for value in values if value.get("type") == "error"]

    tool_parts = [opencode_part(value) for value in tool_events]
    bash_parts = [
        part
        for part in tool_parts
        if str(part.get("tool", "")).casefold() == "bash"
    ]
    expected_command = "/bin/pwd && /bin/cat ./probe-marker.txt"
    workspace_spellings = {str(workspace), str(workspace.resolve())}

    def tool_state(part: dict[str, Any]) -> dict[str, Any]:
        """Return one tool state or an empty value for a malformed event."""
        state = part.get("state")
        return state if isinstance(state, dict) else {}

    controlled_parts = []
    for part in bash_parts:
        state = tool_state(part)
        tool_input = state.get("input")
        if not isinstance(tool_input, dict):
            continue
        if tool_input.get("command") != expected_command:
            continue
        if tool_input.get("workdir") not in workspace_spellings:
            continue
        controlled_parts.append(part)

    controlled_outputs = [
        tool_state(part).get("output") for part in controlled_parts
    ]
    controlled_output_matches = any(
        controlled_claude_output_matches(output, workspace)
        for output in controlled_outputs
    )
    completed_controlled_tool = any(
        tool_state(part).get("status") == "completed"
        for part in controlled_parts
    )
    live_tool_start_observed = any(
        tool_state(part).get("status") == "running" for part in bash_parts
    )
    tool_start_time_represented = any(
        isinstance(tool_state(part).get("time"), dict)
        and tool_state(part)["time"].get("start") is not None
        for part in controlled_parts
    )

    final_text = "\n".join(
        str(opencode_part(value).get("text", "")) for value in text_events
    )
    session_ids = {
        value.get("sessionID")
        for value in values
        if isinstance(value.get("sessionID"), str)
    }
    checks = {
        "validJsonRecordsObserved": bool(values),
        "oneSessionIdObserved": len(session_ids) == 1,
        "stepStartObserved": bool(step_starts),
        "noErrorEvent": not error_events,
    }
    if require_completed_result:
        checks.update(
            {
                "stepFinishObserved": bool(step_finishes),
                "bashToolCompletionObserved": bool(bash_parts),
                "controlledToolInputRepresented": bool(controlled_parts),
                "controlledToolCompleted": completed_controlled_tool,
                "controlledToolStartTimeRepresented": (
                    tool_start_time_represented
                ),
                "controlledOutputMatches": controlled_output_matches,
                "assistantTextObserved": bool(text_events),
                "finalReplyContainsWorkspace": any(
                    spelling in final_text for spelling in workspace_spellings
                ),
                "finalReplyContainsMarker": "CHIVE_SP2_MARKER" in final_text,
            }
        )

    event_type_counts: dict[str, int] = {}
    for value in values:
        event_type = value.get("type")
        if isinstance(event_type, str):
            event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
    summary = {
        "eventTypeCounts": dict(sorted(event_type_counts.items())),
        "bashToolCompletionCount": len(bash_parts),
        "textEventCount": len(text_events),
        "errorEventCount": len(error_events),
        # OpenCode `run --format json` emits a completed/error tool record, not
        # a separate running record. Keep this limitation explicit.
        "separateLiveToolStartObserved": live_tool_start_observed,
        "controlledOutputRetained": (
            "<WORKSPACE>\nCHIVE_SP2_MARKER\n"
            if controlled_output_matches
            else None
        ),
        "rawTextRetained": False,
    }
    return checks, summary


def safe_opencode_transcript(
    process: JsonLineProcess,
    workspace: Path,
) -> dict[str, Any]:
    """Keep OpenCode launch and event counts without prompts or runtime text."""
    unparsed_line_kinds: dict[str, int] = {}
    for entry in process.messages:
        message = entry.get("message")
        if entry.get("direction") != "server" or not isinstance(message, dict):
            continue
        if "unparsed" in message:
            kind = classify_unparsed_line(message.get("unparsed"))
            unparsed_line_kinds[kind] = unparsed_line_kinds.get(kind, 0) + 1
    return {
        "runtime": "opencode",
        "cwd": "<WORKSPACE>",
        "exitCode": process.process.poll(),
        "elapsedMs": now_ms() - process.started_ms,
        "launch": {
            "version": EXPECTED_OPENCODE_VERSION,
            "sha256": EXPECTED_OPENCODE_SHA256,
            "nonoProfile": NONO_PROFILES["opencode"],
            "network": "open",
            "model": TESTED_MODELS["opencode"],
            "outputFormat": "json",
            "externalPlugins": False,
            "autoApprove": True,
            "directory": "<WORKSPACE>",
            "runtimeChildArgv": safe_runtime_child_argv(
                opencode_command(workspace, "<CONTROLLED_PROMPT>"),
                "opencode",
                workspace,
            ),
        },
        "stderrLineCount": len(process.stderr),
        "unparsedServerLineKindCounts": dict(sorted(unparsed_line_kinds.items())),
        "rawResponsesRetained": False,
        "rawPromptsRetained": False,
        "rawStderrRetained": False,
    }


def safe_opencode_server_transcript(
    process: JsonLineProcess,
    workspace: Path,
    port: int,
) -> dict[str, Any]:
    """Keep server launch facts without its console text or HTTP payloads."""
    return {
        "runtime": "opencode",
        "interface": "serve",
        "cwd": "<WORKSPACE>",
        "exitCode": process.process.poll(),
        "elapsedMs": now_ms() - process.started_ms,
        "launch": {
            "version": EXPECTED_OPENCODE_VERSION,
            "sha256": EXPECTED_OPENCODE_SHA256,
            "nonoProfile": NONO_PROFILES["opencode"],
            "network": "open",
            "hostname": "127.0.0.1",
            "externalPlugins": False,
            "runtimeChildArgv": safe_runtime_child_argv(
                opencode_server_command(workspace, port),
                "opencode",
                workspace,
            ),
        },
        "stdoutLineCount": len(process.messages),
        "stderrLineCount": len(process.stderr),
        "rawConsoleRetained": False,
        "rawHttpRetained": False,
        "rawPromptsRetained": False,
        "rawEventsRetained": False,
    }


def run_opencode_normal_turn(workspace: Path) -> dict[str, Any]:
    """Run the normal OpenCode turn and save only controlled stream facts."""
    prompt = (
        "Use the shell tool exactly once to run `/bin/pwd && /bin/cat "
        "./probe-marker.txt`. Then reply with the exact marker and working directory."
    )
    process = JsonLineProcess(
        opencode_command(workspace, prompt),
        cwd=workspace,
        writable_stdin=False,
    )
    try:
        exit_code = process.wait()
        checks, summary = analyze_opencode_stream(
            process.messages,
            workspace,
            require_completed_result=True,
        )
        transcript = safe_opencode_transcript(process, workspace)
        checks.update(
            {
                "processExitedZero": exit_code == 0,
                "allStdoutJsonOrKnownWarning": set(
                    transcript["unparsedServerLineKindCounts"]
                )
                <= {"knownNonoNoRollbackWarning"},
                "noRawResponsesRetained": not transcript["rawResponsesRetained"],
                "noRawStderrRetained": not transcript["rawStderrRetained"],
            }
        )
        return {
            "checks": checks,
            "summary": summary,
            "transcript": transcript,
        }
    finally:
        process.close()


def run_opencode_interrupted_turn(workspace: Path) -> dict[str, Any]:
    """Use the server stream and abort route during a controlled slow tool."""
    run_id = f"opencode-{os.getpid()}-{now_ms()}"
    prompt = (
        "Use the shell tool exactly once to run "
        f"`/bin/sh ./slow-command.sh {run_id}` now. "
        "Wait for it to finish before replying."
    )
    port = reserve_loopback_port()
    base_url = f"http://127.0.0.1:{port}"
    process = JsonLineProcess(
        opencode_server_command(workspace, port),
        cwd=workspace,
        writable_stdin=False,
    )
    pids: list[int] = []
    collector: ServerSentEventCollector | None = None
    session_id: str | None = None
    try:
        wait_for_opencode_server(process, base_url, workspace)
        collector = ServerSentEventCollector(
            opencode_api_url(base_url, "/event", workspace)
        )
        if not collector.ready.wait(timeout=10):
            raise TimeoutError("OpenCode event stream did not become ready")
        if collector.error_type is not None:
            raise RuntimeError("OpenCode event stream failed during startup")

        create_status, session = opencode_http_json(
            "POST",
            opencode_api_url(base_url, "/session", workspace),
            {
                "title": "Chive SP2 Phase 6",
                "permission": [
                    {"permission": "*", "action": "allow", "pattern": "*"}
                ],
            },
        )
        session_id = session.get("id") if isinstance(session, dict) else None
        if create_status != 200 or not isinstance(session_id, str):
            raise RuntimeError("OpenCode did not create the controlled session")

        provider, model = TESTED_MODELS["opencode"].split("/", 1)
        prompt_status, _ = opencode_http_json(
            "POST",
            opencode_api_url(
                base_url,
                f"/session/{urlparse.quote(session_id)}/prompt_async",
                workspace,
            ),
            {
                "model": {"providerID": provider, "modelID": model},
                "parts": [{"type": "text", "text": prompt}],
            },
        )
        if prompt_status != 204:
            raise RuntimeError("OpenCode did not accept the controlled prompt")

        shell_pid = wait_for_pid_file(
            workspace / f".slow-parent-{run_id}.pid",
            timeout=120,
            process=process.process,
        )
        child_pid = wait_for_pid_file(
            workspace / f".slow-child-{run_id}.pid",
            timeout=10,
            process=process.process,
        )
        pids = [shell_pid, child_pid]
        shell_start = process_snapshot(shell_pid, workspace)
        child_start = process_snapshot(child_pid, workspace)
        start_checks, start_summary = summarize_fixture_process_start(
            shell_start,
            child_start,
            run_id,
        )

        wait_for_server_event(
            collector,
            lambda event: opencode_server_tool_event(
                event,
                session_id,
                "running",
            ),
            timeout=10,
        )
        abort_status, abort_result = opencode_http_json(
            "POST",
            opencode_api_url(
                base_url,
                f"/session/{urlparse.quote(session_id)}/abort",
                workspace,
            ),
        )
        stopped = wait_until_stopped(pids, workspace=workspace)
        process_end = summarize_fixture_process_end(stopped)
        fallback_cleanup = clean_known_slow_processes(pids, run_id=run_id)
        after_fallback_rows = wait_until_stopped(pids, workspace=workspace)
        fallback_end = summarize_fixture_process_end(after_fallback_rows)
        status_code, status_map = opencode_http_json(
            "GET",
            opencode_api_url(base_url, "/session/status", workspace),
        )
        session_status = (
            status_map.get(session_id)
            if isinstance(status_map, dict)
            else None
        )
        status_type = (
            session_status.get("type")
            if isinstance(session_status, dict)
            else "absent"
        )
        delete_status, delete_result = opencode_http_json(
            "DELETE",
            opencode_api_url(
                base_url,
                f"/session/{urlparse.quote(session_id)}",
                workspace,
            ),
        )
        # Give the SSE reader a short chance to receive the abort-side update
        # before the local server is closed.
        time.sleep(0.2)
        stream_summary = summarize_opencode_server_events(
            collector.events,
            session_id,
        )
        collector.close()
        process.close()
        transcript = safe_opencode_server_transcript(process, workspace, port)
        checks = {
            **start_checks,
            "serverStreamObservedLiveBashStart": (
                stream_summary["bashRunningObserved"] is True
            ),
            "abortRequestSucceeded": abort_status == 200 and abort_result is True,
            "sessionNotBusyAfterAbort": (
                status_code == 200 and status_type in {"idle", "absent"}
            ),
            "toolShellStopped": process_end["shell"]["alive"] is False,
            "toolChildStopped": process_end["child"]["alive"] is False,
            "fallbackLeftNoControlledProcess": (
                fallback_end["shell"]["alive"] is False
                and fallback_end["child"]["alive"] is False
            ),
            "testSessionDeleted": delete_status == 200 and delete_result is True,
            "serverStopped": process.process.poll() is not None,
            "noRawHttpRetained": not transcript["rawHttpRetained"],
            "noRawEventsRetained": not transcript["rawEventsRetained"],
        }
        return {
            "checks": checks,
            "interrupt": {
                "interface": "POST /session/:sessionID/abort",
                "statusAfterAbort": status_type,
            },
            "stream": stream_summary,
            "processes": {
                "atStart": start_summary,
                "afterSignal": process_end,
                "fallbackCleanupActionCount": len(fallback_cleanup),
                "afterFallbackCleanup": fallback_end,
            },
            "transcript": transcript,
        }
    finally:
        if collector is not None:
            collector.close()
        clean_known_slow_processes(pids, run_id=run_id)
        process.close()


def opencode_probe() -> dict[str, Any]:
    """Run the sanitized Phase 6 normal and interrupted OpenCode smoke tests."""
    with prepare_workspace("opencode") as temp:
        workspace = Path(temp)
        opencode = pinned_opencode_path()
        version = opencode_version_probe(opencode)
        auth = opencode_auth_probe(opencode)
        readiness = {
            "versionCommandSucceeded": version["exitCode"] == 0,
            "versionMatchesPhaseZero": (
                version["version"] == EXPECTED_OPENCODE_VERSION
            ),
            "executableHashMatchesPhaseZero": (
                version["sha256"] == EXPECTED_OPENCODE_SHA256
            ),
            "authCommandSucceeded": auth["exitCode"] == 0,
            "savedCredentialAvailable": (
                auth["status"]["hasSavedCredentials"] is True
            ),
        }
        # Do not send a prompt unless the exact frozen binary and saved login
        # are still available.
        if all(readiness.values()):
            normal = run_opencode_normal_turn(workspace)
        else:
            normal = {
                "checks": {},
                "notTested": "OpenCode binary or saved-login readiness failed",
            }

        if normal["checks"] and all(normal["checks"].values()):
            interrupted = run_opencode_interrupted_turn(workspace)
        else:
            interrupted = {
                "checks": {},
                "notTested": "normal streamed turn did not pass every check",
            }
        return {
            "runtime": "opencode",
            "phase": 6,
            "readinessChecks": readiness,
            "version": version,
            "auth": auth,
            "normalTurn": normal,
            "interruptedTurn": interrupted,
        }


def method_names(definition: dict[str, Any]) -> list[str]:
    """Read protocol method names from one generated request or notification union."""
    names: list[str] = []
    for option in definition.get("oneOf", []):
        values = option.get("properties", {}).get("method", {}).get("enum", [])
        names.extend(value for value in values if isinstance(value, str))
    return sorted(set(names))


def field_shape(definition: dict[str, Any], name: str) -> dict[str, Any]:
    """Keep one generated field schema and whether callers must provide it."""
    return {
        "required": name in definition.get("required", []),
        "schema": definition.get("properties", {}).get(name),
    }


def stable_schema_surface(
    bundle: dict[str, Any],
    client_notifications: dict[str, Any],
) -> dict[str, Any]:
    """Extract the stable methods and fields needed by the planned adapter."""
    definitions = bundle["definitions"]
    methods = method_names(definitions["ClientRequest"])
    notifications = method_names(client_notifications)
    required_methods = (
        "initialize",
        "account/read",
        "thread/start",
        "turn/start",
        "turn/interrupt",
    )
    required_fields = {
        "thread/start": {
            name: field_shape(definitions["ThreadStartParams"], name)
            for name in ("cwd", "sandbox", "approvalPolicy")
        },
        "turn/start": {
            "input": field_shape(definitions["TurnStartParams"], "input")
        },
        "turn/interrupt": {
            name: field_shape(definitions["TurnInterruptParams"], name)
            for name in ("threadId", "turnId")
        },
    }
    fields_present = all(
        field["schema"] is not None
        for method in required_fields.values()
        for field in method.values()
    )
    return {
        "methods": methods,
        "notifications": notifications,
        "requiredMethods": {
            name: name in methods for name in required_methods
        },
        "requiredStableMethodsPresent": all(
            name in methods for name in required_methods
        ),
        "initializedNotificationPresent": "initialized" in notifications,
        "fields": required_fields,
        "requiredStableFieldsPresent": fields_present,
    }


def schema_inventory(codex: Path) -> dict[str, Any]:
    """Generate both Codex schemas and inspect their actual stable surface."""
    with tempfile.TemporaryDirectory(prefix="chive-sp2-schema-") as temp:
        root = Path(temp)
        stable = root / "stable"
        experimental = root / "experimental"
        stable.mkdir()
        experimental.mkdir()
        stable_command, _ = reduce_command_output(
            run_command(
                [
                    str(codex),
                    "app-server",
                    "generate-json-schema",
                    "--out",
                    str(stable),
                ]
            )
        )
        experimental_command, _ = reduce_command_output(
            run_command(
                [
                    str(codex),
                    "app-server",
                    "generate-json-schema",
                    "--experimental",
                    "--out",
                    str(experimental),
                ]
            )
        )
        stable_bundle = stable / "codex_app_server_protocol.v2.schemas.json"
        experimental_bundle = experimental / "codex_app_server_protocol.v2.schemas.json"
        if stable_command["exitCode"] != 0 or experimental_command["exitCode"] != 0:
            raise RuntimeError("Codex schema generation failed")
        stable_document = json.loads(stable_bundle.read_text(encoding="utf-8"))
        client_notifications = json.loads(
            (stable / "ClientNotification.json").read_text(encoding="utf-8")
        )
        surface = stable_schema_surface(stable_document, client_notifications)
        return {
            "stable": {
                "command": stable_command,
                "fileCount": sum(
                    1 for path in stable.rglob("*") if path.is_file()
                ),
                "v2BundleSha256": sha256_canonical_json_file(stable_bundle),
            },
            "experimental": {
                "command": experimental_command,
                "fileCount": sum(
                    1 for path in experimental.rglob("*") if path.is_file()
                ),
                "v2BundleSha256": sha256_canonical_json_file(experimental_bundle),
            },
            **surface,
        }


def inventory_probe() -> dict[str, Any]:
    """Record installed versions, hashes, and auth readiness without schemas."""
    commands: dict[str, list[str]] = {
        "codexVersion": [str(command_path("codex")), "--version"],
        "claudeVersion": [str(command_path("claude")), "--version"],
        "opencodeVersion": [str(command_path("opencode")), "--version"],
        "nonoVersion": [str(command_path("nono")), "--version"],
    }
    executables: dict[str, Any] = {}
    for name in ("codex", "claude", "opencode", "nono"):
        path = command_path(name)
        real_path = path.resolve()
        executables[name] = redact(
            {
                "path": str(path),
                "realPath": str(real_path),
                "sha256": sha256_file(real_path),
            }
        )
    return {
        "runtime": "inventory",
        "commands": {name: version_command(argv) for name, argv in commands.items()},
        "auth": {
            "codex": codex_auth_probe(),
            "claude": claude_auth_probe(),
            "opencode": opencode_auth_probe(),
        },
        "executables": executables,
    }


def schema_probe() -> dict[str, Any]:
    """Record Codex identity and generated schemas without repeating auth checks."""
    codex = command_path("codex")
    real_codex = codex.resolve()
    version = version_command([str(codex), "--version"])
    digest = sha256_file(real_codex)
    if version["version"] != EXPECTED_CODEX_VERSION:
        raise RuntimeError("the frozen Codex version changed")
    if digest != EXPECTED_CODEX_SHA256:
        raise RuntimeError("the frozen Codex executable hash changed")
    return {
        "runtime": "schema",
        "codex": {
            "version": version,
            "path": redact(str(codex)),
            "realPath": redact(str(real_codex)),
            "sha256": digest,
        },
        **schema_inventory(codex),
    }


PROBES: dict[str, Callable[[], dict[str, Any]]] = {
    "inventory": inventory_probe,
    "schema": schema_probe,
    "codex-handshake": codex_handshake_probe,
    "codex-thread-config": codex_thread_config_probe,
    "codex-config-isolation": codex_config_isolation_probe,
    "codex-config-isolation-final": codex_config_isolation_final_probe,
    "codex-config-posture": codex_config_posture_probe,
    "codex-stream": codex_stream_probe,
    "codex-interrupt": codex_interrupt_probe,
    "codex-lifecycle": codex_lifecycle_probe,
    "claude": claude_probe,
    "opencode": opencode_probe,
}


def parse_args() -> argparse.Namespace:
    """Read the selected runtime and unique evidence output path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "runtime",
        choices=[*PROBES],
        help="probe to run",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="evidence path; defaults to a timestamped file under transcripts",
    )
    return parser.parse_args()


def main() -> int:
    """Run selected probes and always save a redacted top-level result."""
    args = parse_args()
    selected = [args.runtime]
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "probes": {},
    }
    failed = False
    for name in selected:
        try:
            probe = PROBES[name]()
            assert_reduced_evidence(probe)
            result["probes"][name] = probe
        except Exception as error:  # The partial transcript is still useful evidence.
            failed = True
            result["probes"][name] = {
                "runtime": name,
                "error": f"{type(error).__name__}: {redact_text(str(error))}",
            }

    out = args.out
    if out is None:
        timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        out = TRANSCRIPTS / f"{args.runtime}.run-{timestamp}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    for name, probe in result["probes"].items():
        print(f"{name}: {'ERROR' if 'error' in probe else 'complete'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
