#!/usr/bin/env python3
"""Run model-free checks against the SP2 protocol probe.

Each test starts a small local child process. No AI runtime, saved login, or
network connection is used.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

from probe import (
    EXPECTED_OPENCODE_SHA256,
    EXPECTED_OPENCODE_VERSION,
    JsonLineProcess,
    PROBES,
    analyze_claude_stream,
    analyze_codex_interrupted_turn,
    analyze_codex_turn_stream,
    analyze_opencode_stream,
    check_codex_initialization,
    check_codex_config_posture,
    check_codex_mcp_isolation,
    check_codex_thread_config,
    claude_command,
    clean_known_slow_processes,
    codex_lifecycle_target,
    opencode_command,
    parse_process_table,
    prepare_workspace,
    process_snapshot,
    redact,
    redact_text,
    resolve_codex_lifecycle_roles,
    safe_lifecycle_states,
    safe_claude_transcript,
    safe_codex_protocol_transcript,
    safe_opencode_transcript,
    safe_posture_transcript,
    safe_stream_transcript,
    summarize_opencode_server_events,
    summarize_fixture_process_end,
    summarize_fixture_process_start,
    wait_for_pid_file,
    wait_until_stopped,
)


class ProbeSurfaceTests(unittest.TestCase):
    """Check that the command line exposes only the current stepwise probes."""

    def test_legacy_combined_codex_probe_is_not_exposed(self) -> None:
        """Do not let one command silently repeat several model-backed phases."""
        self.assertNotIn("codex", PROBES)


class ClaudeStreamTests(unittest.TestCase):
    """Check Phase 5 stream parsing without starting Claude or using a login."""

    def test_normal_stream_keeps_only_controlled_facts(self) -> None:
        """Accept the required events while dropping model text and prompts."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            private_text = "synthetic private model text"
            messages = [
                {
                    "direction": "server",
                    "message": {
                        "type": "system",
                        "subtype": "init",
                        "cwd": str(workspace),
                        "permissionMode": "bypassPermissions",
                        "model": "claude-sonnet-4-6",
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "stream_event",
                        "event": {
                            "type": "content_block_delta",
                            "delta": {"text": private_text},
                        },
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "assistant",
                        "message": {
                            "content": [
                                {"type": "text", "text": private_text},
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {
                                        "command": (
                                            "/bin/pwd && /bin/cat "
                                            "./probe-marker.txt"
                                        )
                                    },
                                },
                            ]
                        },
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "user",
                        "message": {
                            "content": [
                                {
                                    "type": "tool_result",
                                    "content": (
                                        f"{workspace}\nCHIVE_SP2_MARKER\n"
                                    ),
                                    "is_error": False,
                                }
                            ]
                        },
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "result",
                        "subtype": "success",
                        "is_error": False,
                        "terminal_reason": "completed",
                        "result": f"{workspace}\nCHIVE_SP2_MARKER",
                    },
                },
            ]

            checks, summary = analyze_claude_stream(
                messages,
                workspace,
                require_completed_result=True,
            )

            self.assertTrue(all(checks.values()))
            saved = json.dumps(summary)
            self.assertNotIn(private_text, saved)
            self.assertNotIn(str(workspace), saved)
            self.assertEqual(
                summary["controlledOutputRetained"],
                "<WORKSPACE>\nCHIVE_SP2_MARKER\n",
            )
            self.assertFalse(summary["rawTextRetained"])

    def test_transcript_drops_raw_output_and_prompt(self) -> None:
        """Save launch posture and counts, not arbitrary Claude output."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            private_text = "synthetic private response or diagnostic"
            running = SimpleNamespace(poll=lambda: 0)
            process = SimpleNamespace(
                process=running,
                started_ms=0,
                stderr=[private_text],
                messages=[
                    {
                        "direction": "server",
                        "message": {"unparsed": private_text},
                    }
                ],
            )

            transcript = safe_claude_transcript(process, workspace)

            saved = json.dumps(transcript)
            self.assertNotIn(private_text, saved)
            self.assertFalse(transcript["rawResponsesRetained"])
            self.assertFalse(transcript["rawPromptsRetained"])
            self.assertFalse(transcript["rawStderrRetained"])
            self.assertEqual(
                transcript["unparsedServerLineKindCounts"],
                {"other": 1},
            )
            self.assertEqual(
                transcript["launch"]["runtimeChildArgv"][-1],
                "<CONTROLLED_PROMPT>",
            )

    def test_command_uses_safe_mode_and_saved_login(self) -> None:
        """Disable extra Claude features without using login-skipping bare mode."""
        with prepare_workspace("test-claude-command") as temp:
            workspace = Path(temp)
            command = claude_command(workspace, "controlled prompt")

            self.assertIn("--safe-mode", command)
            self.assertIn("--strict-mcp-config", command)
            self.assertIn("--dangerously-skip-permissions", command)
            self.assertIn("--no-session-persistence", command)
            self.assertNotIn("--bare", command)
            self.assertEqual(command[-1], "controlled prompt")


class OpenCodeStreamTests(unittest.TestCase):
    """Check Phase 6 evidence handling without starting an OpenCode model turn."""

    def test_normal_stream_keeps_tool_input_and_result_not_private_text(self) -> None:
        """Reduce successful raw events to controlled facts and event counts."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            private_text = "synthetic private OpenCode text"
            session_id = "synthetic-session"
            messages = [
                {
                    "direction": "server",
                    "message": {
                        "type": "step_start",
                        "sessionID": session_id,
                        "part": {"type": "step-start"},
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "tool_use",
                        "sessionID": session_id,
                        "part": {
                            "type": "tool",
                            "tool": "bash",
                            "metadata": private_text,
                            "state": {
                                "status": "completed",
                                "input": {
                                    "command": (
                                        "/bin/pwd && /bin/cat "
                                        "./probe-marker.txt"
                                    ),
                                    "workdir": str(workspace),
                                },
                                "output": (
                                    f"{workspace}\nCHIVE_SP2_MARKER\n"
                                ),
                                "time": {"start": 1, "end": 2},
                            },
                        },
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "step_finish",
                        "sessionID": session_id,
                        "part": {"type": "step-finish", "reason": "stop"},
                    },
                },
                {
                    "direction": "server",
                    "message": {
                        "type": "text",
                        "sessionID": session_id,
                        "part": {
                            "type": "text",
                            "text": f"{workspace}\nCHIVE_SP2_MARKER",
                        },
                    },
                },
            ]

            checks, summary = analyze_opencode_stream(
                messages,
                workspace,
                require_completed_result=True,
            )

            self.assertTrue(all(checks.values()), checks)
            saved = json.dumps(summary)
            self.assertNotIn(private_text, saved)
            self.assertNotIn(str(workspace), saved)
            self.assertEqual(
                summary["controlledOutputRetained"],
                "<WORKSPACE>\nCHIVE_SP2_MARKER\n",
            )
            self.assertFalse(summary["separateLiveToolStartObserved"])
            self.assertFalse(summary["rawTextRetained"])

    def test_transcript_drops_raw_output_prompt_and_stderr(self) -> None:
        """Save launch posture and counts without arbitrary OpenCode values."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            private_text = "synthetic private OpenCode diagnostic"
            stopped = SimpleNamespace(poll=lambda: 0)
            process = SimpleNamespace(
                process=stopped,
                started_ms=0,
                stderr=[private_text],
                messages=[
                    {
                        "direction": "server",
                        "message": {"unparsed": private_text},
                    }
                ],
            )

            transcript = safe_opencode_transcript(process, workspace)

            saved = json.dumps(transcript)
            self.assertNotIn(private_text, saved)
            self.assertFalse(transcript["rawResponsesRetained"])
            self.assertFalse(transcript["rawPromptsRetained"])
            self.assertFalse(transcript["rawStderrRetained"])
            self.assertEqual(
                transcript["unparsedServerLineKindCounts"],
                {"other": 1},
            )
            self.assertEqual(
                transcript["launch"]["runtimeChildArgv"][-1],
                "<CONTROLLED_PROMPT>",
            )

    def test_command_uses_the_frozen_binary_and_explicit_controls(self) -> None:
        """Keep Phase 6 on the exact Phase 0 binary, model, cwd, and flags."""
        with prepare_workspace("test-opencode-command") as temp:
            workspace = Path(temp)
            command = opencode_command(workspace, "controlled prompt")

            self.assertTrue(
                any(
                    f"opencode-darwin-arm64@{EXPECTED_OPENCODE_VERSION}" in item
                    for item in command
                )
            )
            self.assertIn("--pure", command)
            self.assertIn("--auto", command)
            self.assertIn("--dir", command)
            self.assertIn("github-copilot/gpt-5.6-terra", command)
            self.assertEqual(command[-1], "controlled prompt")
            self.assertEqual(len(EXPECTED_OPENCODE_SHA256), 64)

    def test_server_events_expose_live_tool_start_without_saving_content(self) -> None:
        """Keep the live Bash state and event counts, not server event payloads."""
        private_text = "synthetic private server event"
        session_id = "controlled-session"
        events = [
            {
                "type": "server.connected",
                "properties": {"private": private_text},
            },
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {
                        "sessionID": session_id,
                        "type": "tool",
                        "tool": "bash",
                        "state": {
                            "status": "running",
                            "input": {"command": private_text},
                        },
                    }
                },
            },
            {
                "type": "message.part.updated",
                "properties": {
                    "part": {
                        "sessionID": session_id,
                        "type": "tool",
                        "tool": "bash",
                        "state": {
                            "status": "error",
                            "error": private_text,
                        },
                    }
                },
            },
        ]

        summary = summarize_opencode_server_events(events, session_id)

        self.assertTrue(summary["bashRunningObserved"])
        self.assertFalse(summary["bashCompletedObserved"])
        self.assertTrue(summary["bashErrorObserved"])
        self.assertFalse(summary["rawEventsRetained"])
        self.assertNotIn(private_text, json.dumps(summary))


class FakeCodexProcess:
    """Return known JSONL responses without starting Codex or using a login."""

    def __init__(self) -> None:
        """Keep the calls so the test can check their exact order."""
        self.messages: list[dict[str, object]] = []
        self.requests: list[tuple[int, str, dict[str, object]]] = []
        self.notifications: list[dict[str, object]] = []
        self.raw_lines: list[str] = []

    def request(
        self,
        request_id: int,
        method: str,
        params: dict[str, object],
        *,
        timeout: int = 180,
    ) -> dict[str, object]:
        """Return the response assigned to this request id."""
        del timeout
        self.requests.append((request_id, method, params))
        responses: dict[int, dict[str, object]] = {
            1: {"id": 1, "error": {"message": "Not initialized"}},
            2: {
                "id": 2,
                "result": {
                    "userAgent": "codex-test",
                    "platformFamily": "unix",
                    "platformOs": "macos",
                    "codexHome": "/test/codex-home",
                },
            },
            3: {"id": 3, "error": {"message": "Already initialized"}},
            4: {"id": 4, "error": {"message": "Method not found"}},
            6: {"id": 6, "result": {"account": {"type": "chatgpt"}}},
        }
        if request_id in (7, 8):
            sandbox_types = {
                "danger-full-access": "dangerFullAccess",
                "read-only": "readOnly",
            }
            responses[request_id] = {
                "id": request_id,
                "result": {
                    "thread": {"id": f"thread-{request_id}"},
                    "cwd": params["cwd"],
                    "sandbox": {"type": sandbox_types[str(params["sandbox"])]},
                    "approvalPolicy": params["approvalPolicy"],
                    "model": params["model"],
                },
            }
        return responses[request_id]

    def send(self, message: dict[str, object]) -> None:
        """Keep the one-way initialized notification."""
        self.notifications.append(message)

    def send_raw(self, line: str) -> None:
        """Keep the deliberately broken JSON line."""
        self.raw_lines.append(line)

    def wait_for(self, predicate: object, **kwargs: object) -> dict[str, object]:
        """Return the bounded parse error produced for the broken input."""
        del kwargs
        response: dict[str, object] = {
            "error": {"code": -32700, "message": "Parse error"}
        }
        if not callable(predicate) or not predicate(response):
            raise AssertionError("test response did not match the wait")
        return response


class FakeMcpProcess(FakeCodexProcess):
    """Emit a short MCP startup burst without exposing a real configuration."""

    class RunningProcess:
        """Look alive while the quiet-window counter collects fake events."""

        @staticmethod
        def poll() -> None:
            """Return no exit code because the fake process is still running."""
            return None

    process = RunningProcess()

    def wait_for(self, predicate: object, **kwargs: object) -> dict[str, object]:
        """Add two startup events, then return the first matching event."""
        del kwargs
        first: dict[str, object] = {
            "method": "mcpServer/startupStatus/updated",
            "params": {"name": "synthetic-one"},
        }
        second: dict[str, object] = {
            "method": "mcpServer/startupStatus/updated",
            "params": {"name": "synthetic-two"},
        }
        self.messages.extend(
            [
                {"direction": "server", "message": first},
                {"direction": "server", "message": second},
            ]
        )
        if not callable(predicate) or not predicate(first):
            raise AssertionError("test startup event did not match the wait")
        return first


class FakePostureProcess(FakeCodexProcess):
    """Return private-looking config data so the reducer can prove it drops it."""

    def request(
        self,
        request_id: int,
        method: str,
        params: dict[str, object] | None,
        *,
        timeout: int = 180,
    ) -> dict[str, object]:
        """Return one synthetic response for each read-only posture method."""
        del timeout
        self.requests.append((request_id, method, params or {}))
        private_name = "private-config-entry"
        private_path = "/private/user/config"
        private_value = "private-instruction-or-token"
        responses: dict[str, dict[str, object]] = {
            "config/read": {
                "result": {
                    "config": {
                        "model": "private-model",
                        "instructions": private_value,
                        "mcp_servers": {private_name: {"enabled": True}},
                        "hooks": {"command": private_value},
                        "features": {private_name: True},
                        "shell_environment_policy": {"include": [private_value]},
                    },
                    "layers": [
                        {
                            "name": {"type": "user", "file": private_path},
                            "config": {"instructions": private_value},
                            "version": "1",
                        },
                        {
                            "name": {
                                "type": "project",
                                "dotCodexFolder": private_path,
                            },
                            "config": {"hooks": private_value},
                            "version": "1",
                        },
                    ],
                    "origins": {
                        f"mcp_servers.{private_name}": {
                            "name": {"type": "user", "file": private_path},
                            "version": "1",
                        },
                        "instructions": {
                            "name": {
                                "type": "project",
                                "dotCodexFolder": private_path,
                            },
                            "version": "1",
                        },
                    },
                }
            },
            "configRequirements/read": {
                "result": {
                    "requirements": {
                        "allowedSandboxModes": ["workspace-write"],
                        "models": {"newThread": {"model": "private-model"}},
                        "allowManagedHooksOnly": True,
                    }
                }
            },
            "hooks/list": {
                "result": {
                    "data": [
                        {
                            "cwd": private_path,
                            "hooks": [
                                {
                                    "command": private_value,
                                    "enabled": True,
                                    "isManaged": False,
                                },
                                {
                                    "command": private_value,
                                    "enabled": False,
                                    "isManaged": True,
                                },
                            ],
                            "errors": [{"message": private_value}],
                            "warnings": [private_value],
                        }
                    ]
                }
            },
            "skills/list": {
                "result": {
                    "data": [
                        {
                            "cwd": private_path,
                            "skills": [
                                {
                                    "name": private_name,
                                    "path": private_path,
                                    "description": private_value,
                                    "enabled": True,
                                }
                            ],
                            "errors": [],
                        }
                    ]
                }
            },
            "plugin/installed": {
                "result": {
                    "marketplaces": [
                        {
                            "name": private_name,
                            "path": private_path,
                            "plugins": [
                                {
                                    "id": private_name,
                                    "name": private_name,
                                    "installed": True,
                                    "enabled": True,
                                }
                            ],
                        }
                    ],
                    "marketplaceLoadErrors": [],
                }
            },
            "app/installed": {
                "result": {
                    "apps": [
                        {
                            "id": private_name,
                            "runtimeName": private_name,
                            "enabled": True,
                            "callable": False,
                        }
                    ]
                }
            },
            "mcpServerStatus/list": {
                "result": {
                    "data": [
                        {
                            "name": private_name,
                            "authStatus": "bearerToken",
                            "tools": {private_name: {"name": private_name}},
                            "resources": [{"name": private_name}],
                            "resourceTemplates": [{"name": private_name}],
                        }
                    ],
                    "nextCursor": None,
                }
            },
        }
        return {"id": request_id, **responses[method]}


class CodexInitializationTests(unittest.TestCase):
    """Check the Phase 2 state machine without contacting Codex."""

    def test_handshake_stops_before_thread_or_model_work(self) -> None:
        """Run only initialization requests and keep all expected checks true."""
        process = FakeCodexProcess()

        checks = check_codex_initialization(process)  # type: ignore[arg-type]

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(
            [(request_id, method) for request_id, method, _ in process.requests],
            [
                (1, "account/read"),
                (2, "initialize"),
                (3, "initialize"),
                (4, "chive/unknown"),
                (6, "account/read"),
            ],
        )
        self.assertEqual(
            process.notifications,
            [{"method": "initialized", "params": {}}],
        )
        self.assertEqual(process.raw_lines, ['{"id":5,"method":'])
        self.assertNotIn("thread/start", [item[1] for item in process.requests])


class CodexThreadConfigTests(unittest.TestCase):
    """Check Phase 3 thread settings without starting Codex or a model."""

    def test_two_threads_keep_their_own_settings_and_ids(self) -> None:
        """Send only two thread starts and compare every requested setting."""
        process = FakeCodexProcess()
        with tempfile.TemporaryDirectory(prefix="chive-sp2-thread-test-") as temp:
            workspace = Path(temp)

            checks, primary_thread = check_codex_thread_config(  # type: ignore[arg-type]
                process,
                workspace,
            )

            self.assertTrue(all(checks.values()), checks)
            self.assertEqual(
                [(request_id, method) for request_id, method, _ in process.requests],
                [(7, "thread/start"), (8, "thread/start")],
            )
            self.assertEqual(
                primary_thread["result"]["thread"]["id"],  # type: ignore[index]
                "thread-7",
            )
            self.assertNotIn("turn/start", [item[1] for item in process.requests])


class CodexConfigIsolationTests(unittest.TestCase):
    """Check the E4 MCP counter without starting Codex or a model."""

    def test_mcp_startup_is_counted_without_returning_server_names(self) -> None:
        """Keep only the startup count and the pass or fail result."""
        process = FakeMcpProcess()
        with tempfile.TemporaryDirectory(prefix="chive-sp2-mcp-test-") as temp:
            workspace = Path(temp)

            checks, event_count = check_codex_mcp_isolation(  # type: ignore[arg-type]
                process,
                workspace,
                quiet_seconds=0,
            )

            self.assertEqual(event_count, 2)
            self.assertEqual(checks, {"emptyMcpMapBlockedStartup": False})
            self.assertNotIn("turn/start", [item[1] for item in process.requests])
            self.assertNotIn("synthetic-one", repr((checks, event_count)))


class CodexConfigPostureTests(unittest.TestCase):
    """Check the E5 pre-check without starting Codex or a model."""

    def test_private_config_is_reduced_to_categories_and_counts(self) -> None:
        """Keep posture evidence useful without retaining any private field."""
        process = FakePostureProcess()
        with tempfile.TemporaryDirectory(prefix="chive-sp2-posture-test-") as temp:
            checks, posture = check_codex_config_posture(  # type: ignore[arg-type]
                process,
                Path(temp),
                "synthetic-thread",
            )

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(
            [method for _, method, _ in process.requests],
            [
                "config/read",
                "configRequirements/read",
                "hooks/list",
                "skills/list",
                "plugin/installed",
                "app/installed",
                "mcpServerStatus/list",
            ],
        )
        self.assertEqual(posture["effectiveConfig"]["layerTypeCounts"], {
            "project": 1,
            "user": 1,
        })
        self.assertEqual(posture["hooks"]["hookCount"], 2)
        self.assertEqual(posture["skills"]["skillCount"], 1)
        self.assertEqual(posture["plugins"]["installedCount"], 1)
        self.assertEqual(posture["apps"]["enabledCount"], 1)
        self.assertEqual(posture["mcp"]["toolCount"], 1)
        saved = repr((checks, posture))
        self.assertNotIn("private-config-entry", saved)
        self.assertNotIn("private-instruction-or-token", saved)
        self.assertNotIn("/private/user/config", saved)
        self.assertNotIn("turn/start", [method for _, method, _ in process.requests])

    def test_safe_transcript_discards_raw_responses_and_stderr(self) -> None:
        """Keep the request order but drop private protocol and diagnostic text."""

        class RunningProcess:
            """Provide only the process fields used by the safe transcript."""

            pid = 1234

            @staticmethod
            def poll() -> int:
                """Act like a child that exited cleanly."""
                return 0

        class PrivateProcess:
            """Hold private-looking raw data that must never reach evidence."""

            def __init__(self, workspace: Path) -> None:
                """Build one client request and one private server response."""
                self.argv = ["codex", "app-server", "--stdio"]
                self.cwd = workspace
                self.started_ms = 0
                self.process = RunningProcess()
                self.stderr = ["private-diagnostic-value"]
                self.messages = [
                    {
                        "direction": "client",
                        "message": {"id": 1, "method": "config/read", "params": {}},
                    },
                    {
                        "direction": "server",
                        "message": {
                            "id": 1,
                            "result": {"instructions": "private-response-value"},
                        },
                    },
                    {
                        "direction": "server",
                        "message": {"unparsed": "private-unparsed-value"},
                    },
                ]

        with tempfile.TemporaryDirectory(prefix="chive-posture-transcript-") as temp:
            transcript = safe_posture_transcript(  # type: ignore[arg-type]
                PrivateProcess(Path(temp)),
                Path(temp),
            )

        self.assertEqual(transcript["requestMethods"], ["config/read"])
        self.assertFalse(transcript["rawResponsesRetained"])
        self.assertEqual(transcript["unparsedServerLineKindCounts"], {"other": 1})
        saved = repr(transcript)
        self.assertNotIn("private-response-value", saved)
        self.assertNotIn("private-diagnostic-value", saved)
        self.assertNotIn("private-unparsed-value", saved)


class CodexStreamTests(unittest.TestCase):
    """Check E5 stream analysis without starting Codex or contacting a model."""

    @staticmethod
    def server(method: str, params: dict[str, object]) -> dict[str, object]:
        """Build one synthetic server event in the probe's in-memory shape."""
        return {
            "direction": "server",
            "message": {"method": method, "params": params},
        }

    def test_stream_checks_order_deltas_output_and_ids_without_saving_text(self) -> None:
        """Prove the E5 checks while dropping arbitrary model commentary."""
        with tempfile.TemporaryDirectory(prefix="chive-stream-test-") as temp:
            workspace = Path(temp)
            turn_id = "turn-one"
            command_id = "command-one"
            commentary_id = "agent-commentary"
            final_id = "agent-final"
            command_output = f"{workspace}\nCHIVE_SP2_MARKER\n"
            private_commentary = "private-model-commentary"
            final_text = f"{workspace}\nCHIVE_SP2_MARKER"
            messages = [
                self.server(
                    "turn/started",
                    {"threadId": "thread-one", "turn": {"id": turn_id}},
                ),
                self.server(
                    "item/started",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {
                            "id": command_id,
                            "type": "commandExecution",
                            "cwd": str(workspace),
                            "status": "inProgress",
                        },
                    },
                ),
                self.server(
                    "item/commandExecution/outputDelta",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "itemId": command_id,
                        "delta": command_output,
                    },
                ),
                self.server(
                    "item/completed",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {
                            "id": command_id,
                            "type": "commandExecution",
                            "cwd": str(workspace),
                            "status": "completed",
                            "exitCode": 0,
                            "aggregatedOutput": command_output,
                        },
                    },
                ),
                self.server(
                    "item/started",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {
                            "id": commentary_id,
                            "type": "agentMessage",
                            "text": "",
                        },
                    },
                ),
                self.server(
                    "item/agentMessage/delta",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "itemId": commentary_id,
                        "delta": private_commentary,
                    },
                ),
                self.server(
                    "item/completed",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {
                            "id": commentary_id,
                            "type": "agentMessage",
                            "text": private_commentary,
                        },
                    },
                ),
                self.server(
                    "item/started",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {"id": final_id, "type": "agentMessage", "text": ""},
                    },
                ),
                self.server(
                    "item/agentMessage/delta",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "itemId": final_id,
                        "delta": final_text,
                    },
                ),
                self.server(
                    "item/completed",
                    {
                        "threadId": "thread-one",
                        "turnId": turn_id,
                        "item": {
                            "id": final_id,
                            "type": "agentMessage",
                            "text": final_text,
                        },
                    },
                ),
                self.server(
                    "turn/completed",
                    {
                        "threadId": "thread-one",
                        "turn": {"id": turn_id, "status": "completed"},
                    },
                ),
            ]

            checks, summary = analyze_codex_turn_stream(  # type: ignore[arg-type]
                messages,
                turn_id,
                workspace,
                expect_command=True,
            )

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(
            summary["command"]["controlledOutputRetained"],
            "<WORKSPACE>\nCHIVE_SP2_MARKER\n",
        )
        self.assertFalse(summary["agent"]["rawTextRetained"])
        self.assertNotIn(private_commentary, repr(summary))

    def test_completed_item_can_hold_lossless_output_without_deltas(self) -> None:
        """Accept completed output when Codex emits no command-output delta."""
        with tempfile.TemporaryDirectory(prefix="chive-stream-test-") as temp:
            workspace = Path(temp)
            turn_id = "turn-one"
            command_id = "command-one"
            agent_id = "agent-one"
            # `/bin/pwd` uses this resolved spelling on macOS temporary paths.
            command_output = f"{workspace.resolve()}\nCHIVE_SP2_MARKER\n"
            final_text = f"{workspace.resolve()}\nCHIVE_SP2_MARKER"
            messages = [
                self.server("turn/started", {"turn": {"id": turn_id}}),
                self.server(
                    "item/started",
                    {
                        "turnId": turn_id,
                        "item": {
                            "id": command_id,
                            "type": "commandExecution",
                            "cwd": str(workspace),
                            "status": "inProgress",
                        },
                    },
                ),
                self.server(
                    "item/completed",
                    {
                        "turnId": turn_id,
                        "item": {
                            "id": command_id,
                            "type": "commandExecution",
                            "cwd": str(workspace),
                            "status": "completed",
                            "exitCode": 0,
                            "aggregatedOutput": command_output,
                        },
                    },
                ),
                self.server(
                    "item/started",
                    {
                        "turnId": turn_id,
                        "item": {"id": agent_id, "type": "agentMessage"},
                    },
                ),
                self.server(
                    "item/agentMessage/delta",
                    {
                        "turnId": turn_id,
                        "itemId": agent_id,
                        "delta": final_text[: len(final_text) // 2],
                    },
                ),
                self.server(
                    "item/agentMessage/delta",
                    {
                        "turnId": turn_id,
                        "itemId": agent_id,
                        "delta": final_text[len(final_text) // 2 :],
                    },
                ),
                self.server(
                    "item/completed",
                    {
                        "turnId": turn_id,
                        "item": {
                            "id": agent_id,
                            "type": "agentMessage",
                            "text": final_text,
                        },
                    },
                ),
                self.server(
                    "turn/completed",
                    {"turn": {"id": turn_id, "status": "completed"}},
                ),
            ]

            checks, summary = analyze_codex_turn_stream(  # type: ignore[arg-type]
                messages,
                turn_id,
                workspace,
                expect_command=True,
            )

        self.assertTrue(all(checks.values()), checks)
        self.assertFalse(summary["command"]["outputDeltaObserved"])
        self.assertEqual(
            summary["command"]["controlledOutputRetained"],
            "<WORKSPACE>\nCHIVE_SP2_MARKER\n",
        )
        self.assertLess(len(summary["timeline"]), summary["eventCount"])

    def test_safe_stream_transcript_keeps_counts_not_raw_content(self) -> None:
        """Discard model text, command text, and stderr from stream evidence."""

        class ExitedProcess:
            """Provide the process fields used by the transcript reducer."""

            pid = 4321

            @staticmethod
            def poll() -> int:
                """Act like app-server exited cleanly."""
                return 0

        class PrivateStreamProcess:
            """Hold synthetic raw stream content that evidence must drop."""

            def __init__(self, workspace: Path) -> None:
                """Build one request, one delta, one warning, and private stderr."""
                self.argv = ["codex", "app-server", "--stdio"]
                self.cwd = workspace
                self.started_ms = 0
                self.process = ExitedProcess()
                self.stderr = ["private-stream-stderr"]
                self.messages = [
                    {
                        "direction": "client",
                        "message": {"id": 1, "method": "turn/start", "params": {}},
                    },
                    {
                        "direction": "server",
                        "message": {
                            "method": "item/agentMessage/delta",
                            "params": {
                                "threadId": "thread-one",
                                "turnId": "turn-one",
                                "itemId": "item-one",
                                "delta": "private-stream-text",
                            },
                        },
                    },
                    {
                        "direction": "server",
                        "message": {
                            "unparsed": (
                                "WARN --no-rollback is active; rollback flags "
                                "have no effect"
                            )
                        },
                    },
                ]

        with tempfile.TemporaryDirectory(prefix="chive-stream-transcript-") as temp:
            transcript = safe_stream_transcript(  # type: ignore[arg-type]
                PrivateStreamProcess(Path(temp)),
                Path(temp),
            )

        self.assertEqual(transcript["requestMethods"], ["turn/start"])
        self.assertEqual(
            transcript["eventMethodCounts"],
            {"item/agentMessage/delta": 1},
        )
        self.assertEqual(
            transcript["unparsedServerLineKindCounts"],
            {"knownNonoNoRollbackWarning": 1},
        )
        saved = repr(transcript)
        self.assertNotIn("private-stream-text", saved)
        self.assertNotIn("private-stream-stderr", saved)


class CodexInterruptTests(unittest.TestCase):
    """Check E6 reducers without starting Codex or signalling real processes."""

    @staticmethod
    def server(method: str, params: dict[str, object]) -> dict[str, object]:
        """Build one synthetic server event in the probe's in-memory shape."""
        return {
            "direction": "server",
            "message": {"method": method, "params": params},
        }

    def test_process_end_summary_works_on_python_3_9(self) -> None:
        """Pair the two controlled roles without newer `zip` arguments."""
        summary = summarize_fixture_process_end(
            [
                {"pid": 101, "alive": False, "status": None},
                {"pid": 102, "alive": True, "status": "S"},
            ]
        )

        self.assertEqual(summary["shell"]["pid"], 101)
        self.assertEqual(summary["child"]["pid"], 102)
        with self.assertRaisesRegex(ValueError, "one shell snapshot"):
            summarize_fixture_process_end([])

    def test_interrupted_turn_keeps_status_and_order_not_raw_output(self) -> None:
        """Retain interruption facts while dropping command output text."""
        turn_id = "turn-interrupted"
        command_id = "command-one"
        private_output = "private-command-output"
        messages = [
            self.server("turn/started", {"turn": {"id": turn_id}}),
            self.server(
                "item/started",
                {
                    "turnId": turn_id,
                    "item": {
                        "id": command_id,
                        "type": "commandExecution",
                        "status": "inProgress",
                    },
                },
            ),
            self.server(
                "item/commandExecution/outputDelta",
                {
                    "turnId": turn_id,
                    "itemId": command_id,
                    "delta": private_output,
                },
            ),
            self.server(
                "item/completed",
                {
                    "turnId": turn_id,
                    "item": {
                        "id": command_id,
                        "type": "commandExecution",
                        "status": "failed",
                        "exitCode": 143,
                        "aggregatedOutput": private_output,
                    },
                },
            ),
            self.server(
                "turn/completed",
                {"turn": {"id": turn_id, "status": "interrupted"}},
            ),
        ]

        checks, summary = analyze_codex_interrupted_turn(  # type: ignore[arg-type]
            messages,
            turn_id,
        )

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(summary["status"], "interrupted")
        self.assertEqual(summary["command"]["exitCode"], 143)
        self.assertFalse(summary["command"]["rawOutputRetained"])
        self.assertNotIn(private_output, repr(summary))

    def test_fixture_process_summary_checks_each_role_and_relationship(self) -> None:
        """Prove fixture identity without saving either process command line."""
        run_id = "e6-synthetic-run"
        shell = {
            "pid": 100,
            "ppid": 50,
            "pgid": 100,
            "status": "S",
            "alive": True,
            "ps": f"100 50 100 100 S /bin/sh ./slow-command.sh {run_id}",
        }
        child = {
            "pid": 101,
            "ppid": 100,
            "pgid": 100,
            "status": "S",
            "alive": True,
            "ps": f"101 100 100 100 S ./.slow-child-{run_id} 300",
        }

        checks, summary = summarize_fixture_process_start(shell, child, run_id)

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(
            summary["shell"],
            {"pid": 100, "ppid": 50, "pgid": 100, "alive": True, "status": "S"},
        )
        self.assertEqual(
            summary["child"],
            {"pid": 101, "ppid": 100, "pgid": 100, "alive": True, "status": "S"},
        )
        self.assertFalse(summary["rawCommandsRetained"])
        self.assertNotIn("slow-command.sh", repr(summary))
        self.assertNotIn(run_id, repr(summary))


class CodexLifecycleTests(unittest.TestCase):
    """Check E7 process-tree resolution without starting a model turn."""

    def test_roles_and_groups_are_resolved_from_lineage(self) -> None:
        """Separate the detached tool group from the outer runtime group."""
        table = parse_process_table(
            "\n".join(
                (
                    "100 50 100 100 S /tmp/sidecar-harness --nono /opt/nono",
                    "101 100 100 100 S /opt/homebrew/bin/nono run -- codex app-server",
                    "102 101 100 100 S /home/test/codex app-server --stdio",
                    "103 102 103 103 Ss /bin/sh ./slow-command.sh e7-test",
                    "104 103 103 103 S ./.slow-child-e7-test 300",
                )
            )
        )

        roles, checks = resolve_codex_lifecycle_roles(100, 103, 104, table)
        root_target = codex_lifecycle_target("app-server-root", roles)
        app_group_target = codex_lifecycle_target("app-server-group", roles)
        outer_group_target = codex_lifecycle_target("outer-sidecar-group", roles)
        safe = safe_lifecycle_states(roles)

        self.assertTrue(all(checks.values()), checks)
        self.assertEqual(root_target, ("pid", 102, [102]))
        self.assertEqual(app_group_target, ("group", 100, [100, 101, 102]))
        self.assertEqual(outer_group_target, app_group_target)
        self.assertEqual(safe["toolShell"]["pgid"], 103)
        self.assertNotIn("command", repr(safe))
        self.assertNotIn("slow-command.sh", repr(safe))


class SchemaCommandTests(unittest.TestCase):
    """Check the Phase 2 command through its saved JSON interface."""

    def assert_no_raw_command_output(self, value: object) -> None:
        """Reject raw command streams anywhere in saved evidence."""
        if isinstance(value, dict):
            self.assertNotIn("stdout", value)
            self.assertNotIn("stderr", value)
            for child in value.values():
                self.assert_no_raw_command_output(child)
        elif isinstance(value, list):
            for child in value:
                self.assert_no_raw_command_output(child)

    def test_schema_command_writes_only_generated_schema_evidence(self) -> None:
        """Generate both schemas without repeating auth or starting a model."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-schema-test-") as temp:
            out = Path(temp) / "schema.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(Path(__file__).with_name("probe.py")),
                    "schema",
                    "--out",
                    str(out),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            evidence = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(set(evidence["probes"]), {"schema"})
            schema = evidence["probes"]["schema"]
            self.assertNotIn("auth", schema)
            self.assert_no_raw_command_output(schema)
            self.assertEqual(schema["codex"]["version"]["version"], "0.145.0")
            self.assertGreater(schema["stable"]["fileCount"], 0)
            self.assertGreater(schema["experimental"]["fileCount"], 0)
            self.assertTrue(schema["requiredStableMethodsPresent"])
            self.assertTrue(schema["requiredStableFieldsPresent"])

    def test_schema_hashes_ignore_json_object_order(self) -> None:
        """Give equivalent generated schemas the same recorded fingerprint."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-schema-order-") as temp:
            root = Path(temp)
            evidence = []
            for name in ("first.json", "second.json"):
                out = root / name
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-B",
                        str(Path(__file__).with_name("probe.py")),
                        "schema",
                        "--out",
                        str(out),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                    check=False,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                evidence.append(json.loads(out.read_text(encoding="utf-8")))

            first = evidence[0]["probes"]["schema"]
            second = evidence[1]["probes"]["schema"]
            self.assertEqual(
                first["stable"]["v2BundleSha256"],
                second["stable"]["v2BundleSha256"],
            )
            self.assertEqual(
                first["experimental"]["v2BundleSha256"],
                second["experimental"]["v2BundleSha256"],
            )


class InventoryCommandTests(unittest.TestCase):
    """Check the Phase 0 command through its saved JSON interface."""

    def test_inventory_keeps_versions_and_auth_facts_not_raw_output(self) -> None:
        """Reduce synthetic command text before writing inventory evidence."""
        scripts = {
            "codex": """#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'codex-cli 0.145.0\\n'
  printf 'CODEX_VERSION_DIAGNOSTIC\\n' >&2
else
  printf 'Logged in using ChatGPT\\n'
  printf 'CODEX_AUTH_DIAGNOSTIC\\n' >&2
fi
""",
            "claude": """#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '2.1.218 (Claude Code)\\n'
  printf 'CLAUDE_VERSION_DIAGNOSTIC\\n' >&2
else
  printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}\\n'
  printf 'CLAUDE_AUTH_DIAGNOSTIC\\n' >&2
fi
""",
            "opencode": """#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '1.18.4\\n'
  printf 'OPENCODE_VERSION_DIAGNOSTIC\\n' >&2
else
  printf '8 credentials\\n'
  printf 'OPENCODE_AUTH_DIAGNOSTIC\\n' >&2
fi
""",
            "nono": """#!/bin/sh
printf 'nono 0.69.0\\n'
printf 'NONO_VERSION_DIAGNOSTIC\\n' >&2
""",
        }
        with tempfile.TemporaryDirectory(prefix="chive-sp2-inventory-test-") as temp:
            root = Path(temp)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            for name, script in scripts.items():
                command = bin_dir / name
                command.write_text(script, encoding="utf-8")
                command.chmod(0o755)
            out = root / "inventory.json"
            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            completed = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(Path(__file__).with_name("probe.py")),
                    "inventory",
                    "--out",
                    str(out),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
                check=False,
                env=env,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            evidence = json.loads(out.read_text(encoding="utf-8"))
            serialized = json.dumps(evidence)
            self.assertNotIn("DIAGNOSTIC", serialized)
            self.assertNotIn('"stdout"', serialized)
            self.assertNotIn('"stderr"', serialized)
            inventory = evidence["probes"]["inventory"]
            self.assertEqual(inventory["commands"]["codexVersion"]["version"], "0.145.0")
            self.assertTrue(inventory["auth"]["codex"]["status"]["loggedIn"])


class WorkspaceFixtureTests(unittest.TestCase):
    """Check the controlled files copied into each temporary workspace."""

    def test_prepare_workspace_copies_only_the_controlled_files(self) -> None:
        """Copy the three known fixtures and remove the workspace afterward."""
        with prepare_workspace("fixture-check") as temp:
            workspace = Path(temp)
            self.assertEqual(
                {path.name for path in workspace.iterdir()},
                {
                    "probe-marker.txt",
                    "slow-command.sh",
                    "claude-settings.json",
                },
            )
            self.assertEqual(
                (workspace / "probe-marker.txt").read_text(encoding="utf-8"),
                "CHIVE_SP2_MARKER\n",
            )
            self.assertEqual(
                json.loads(
                    (workspace / "claude-settings.json").read_text(
                        encoding="utf-8"
                    )
                ),
                {"sandbox": {"enabled": False}},
            )

            slow_command = workspace / "slow-command.sh"
            self.assertTrue(os.access(slow_command, os.R_OK))

        self.assertFalse(workspace.exists())


class SlowCommandFixtureTests(unittest.TestCase):
    """Check the process lifecycle used by interruption experiments."""

    def test_term_stops_and_reaps_the_identified_shell_and_child(self) -> None:
        """Keep both PIDs identifiable, then stop both through the shell trap."""
        run_id = "run-20260727-008"
        with prepare_workspace("slow-command-check") as temp:
            workspace = Path(temp)
            process = subprocess.Popen(
                ["/bin/sh", "./slow-command.sh", run_id],
                cwd=workspace,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            try:
                parent_file = workspace / f".slow-parent-{run_id}.pid"
                child_file = workspace / f".slow-child-{run_id}.pid"
                parent_pid = wait_for_pid_file(parent_file, timeout=5)
                child_pid = wait_for_pid_file(child_file, timeout=5)
                child_command = workspace / f".slow-child-{run_id}"
                parent = process_snapshot(parent_pid, workspace)
                child = process_snapshot(child_pid, workspace)

                self.assertEqual(parent_pid, process.pid)
                self.assertTrue(child_command.is_symlink())
                self.assertEqual(os.readlink(child_command), "/bin/sleep")
                self.assertTrue(parent["alive"])
                self.assertTrue(child["alive"])
                self.assertEqual(parent["pgid"], child["pgid"])
                self.assertEqual(parent["session"], child["session"])
                self.assertIn(run_id, parent["ps"])
                self.assertIn(run_id, child["ps"])

                process.send_signal(signal.SIGTERM)
                self.assertEqual(process.wait(timeout=5), 143)
                stopped = wait_until_stopped(
                    [parent_pid, child_pid],
                    workspace=workspace,
                    timeout=5,
                )
                self.assertFalse(any(item["alive"] for item in stopped))
                self.assertTrue(all(item["status"] is None for item in stopped))
                self.assertFalse(child_command.exists())
            finally:
                # The process group was created by this test. If an assertion
                # fails early, stop that whole group so no fixture is leaked.
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)


class CleanupSafetyTests(unittest.TestCase):
    """Check that fallback cleanup never signals an unrelated process."""

    def test_cleanup_refuses_a_pid_without_the_exact_run_id(self) -> None:
        """Leave a test-owned sleep alive when its command lacks the run id."""
        process = subprocess.Popen(
            ["/bin/sleep", "300"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            cleaned = clean_known_slow_processes(
                [process.pid],
                run_id="run-20260727-006",
            )
            self.assertEqual(cleaned[0]["result"], "refused")
            self.assertIsNone(process.poll())
        finally:
            # This PID belongs to the test, so direct cleanup is safe even when
            # the helper correctly refuses to touch it.
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)


class RedactionTests(unittest.TestCase):
    """Check that saved evidence keeps behavior but removes private values."""

    def test_mcp_disable_override_hides_the_server_name(self) -> None:
        """Hide an MCP name when a launch command contains its config key."""
        self.assertEqual(
            redact_text("mcp_servers.private-tools.enabled=false"),
            "mcp_servers.<MCP_SERVER>.enabled=false",
        )

    def test_local_hostname_is_hidden_in_text_and_structured_fields(self) -> None:
        """Do not save a machine name just because it did not follow DNS error text."""
        source = {
            "message": "connected to build-node.local",
            "params": {"serverName": "build-node.local"},
        }

        self.assertEqual(
            redact(source),
            {
                "message": "connected to <REDACTED_HOST>",
                "params": {"serverName": "<REDACTED_HOST>"},
            },
        )

    def test_codex_protocol_transcript_drops_raw_messages_and_stderr(self) -> None:
        """Keep operation order and counts without keeping private runtime text."""
        process = SimpleNamespace(
            argv=["codex", "app-server", "--stdio"],
            cwd=Path("/tmp/chive-sp2-safe-transcript"),
            process=SimpleNamespace(pid=123, poll=lambda: 0),
            started_ms=0,
            messages=[
                {
                    "direction": "client",
                    "message": {"id": 1, "method": "initialize", "params": {}},
                },
                {
                    "direction": "server",
                    "message": {"id": 1, "result": {"serverName": "private.local"}},
                },
                {
                    "direction": "client",
                    "message": {"method": "initialized", "params": {}},
                },
                {
                    "direction": "server",
                    "message": {"method": "server/ready", "params": {}},
                },
            ],
            stderr=["private diagnostic from private.local"],
        )

        transcript = safe_codex_protocol_transcript(process, process.cwd)

        self.assertEqual(transcript["requestMethods"], ["initialize"])
        self.assertEqual(transcript["notificationMethods"], ["initialized"])
        self.assertEqual(transcript["serverResponseCount"], 1)
        self.assertEqual(transcript["serverEventMethodCounts"], {"server/ready": 1})
        self.assertEqual(transcript["stderrLineCount"], 1)
        self.assertFalse(transcript["rawResponsesRetained"])
        self.assertFalse(transcript["rawStderrRetained"])
        self.assertNotIn("private.local", repr(transcript))

    def test_private_values_are_replaced_with_stable_placeholders(self) -> None:
        """Redact synthetic secrets and leave harmless runtime fields alone."""
        # Build fake private values in pieces so a repo secret scan does not
        # mistake the test source for a real email or credential.
        synthetic_email = "person" + "@" + "example.test"
        synthetic_token = "sk-" + "synthetic1234567890"
        source = {
            "email": synthetic_email,
            "token": synthetic_token,
            "homePath": str(Path.home() / "private.txt"),
            "mcpText": "MCP client for `private-tools` failed",
            "mcpEvent": {
                "method": "mcpServer/startupStatus/updated",
                "params": {
                    "name": "private-tools",
                    "status": "failed",
                },
            },
            "hostError": "ENOTFOUND private.service.internal",
            "safe": {
                "runtime": "codex",
                "status": "failed",
                "count": 3,
            },
        }

        self.assertEqual(
            redact(source),
            {
                "email": "<REDACTED_EMAIL>",
                "token": "<REDACTED_TOKEN>",
                "homePath": "<HOME>/private.txt",
                "mcpText": "MCP client for `<MCP_SERVER>` failed",
                "mcpEvent": {
                    "method": "mcpServer/startupStatus/updated",
                    "params": {
                        "name": "<MCP_SERVER>",
                        "status": "failed",
                    },
                },
                "hostError": "ENOTFOUND <REDACTED_HOST>",
                "safe": {
                    "runtime": "codex",
                    "status": "failed",
                    "count": 3,
                },
            },
        )


class JsonLineProcessTests(unittest.TestCase):
    """Check the JSONL behavior that later runtime probes depend on."""

    def test_timeout_stops_and_reaps_the_owned_process(self) -> None:
        """Do not leave the child running after a bounded wait expires."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            process = JsonLineProcess(
                ["/bin/sleep", "300"],
                cwd=workspace,
                writable_stdin=False,
            )
            pid = process.evidence()["pid"]
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    process.wait(timeout=0.1)

                self.assertIsInstance(process.wait(timeout=0), int)
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
            finally:
                process.close()

    def test_full_stderr_pipe_does_not_block_stdout(self) -> None:
        """Read stdout even after the child writes more than a pipe can hold."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            child_code = (
                "import json, sys; "
                "sys.stderr.write('x' * 1_048_576); "
                "sys.stderr.flush(); "
                "print(json.dumps({'stdout': 'still-readable'}), flush=True)"
            )
            process = JsonLineProcess(
                [sys.executable, "-u", "-c", child_code],
                cwd=workspace,
                writable_stdin=False,
            )
            try:
                message = process.wait_for(
                    lambda item: item == {"stdout": "still-readable"},
                    timeout=5,
                )
                self.assertEqual(message, {"stdout": "still-readable"})
                self.assertEqual(process.wait(timeout=5), 0)
            finally:
                process.close()

    def test_malformed_json_is_kept_as_an_unparsed_message(self) -> None:
        """Keep one bad stdout line so evidence does not silently lose it."""
        with tempfile.TemporaryDirectory(prefix="chive-sp2-test-") as temp:
            workspace = Path(temp)
            child_argv = [
                sys.executable,
                "-u",
                "-c",
                'print("this is not json", flush=True)',
            ]
            process = JsonLineProcess(
                child_argv,
                cwd=workspace,
                writable_stdin=False,
            )
            try:
                message = process.wait_for(
                    lambda item: "unparsed" in item,
                    timeout=5,
                )
                self.assertEqual(message, {"unparsed": "this is not json"})
                self.assertEqual(process.wait(timeout=5), 0)

                server_messages = [
                    entry["message"]
                    for entry in process.evidence()["messages"]
                    if entry["direction"] == "server"
                ]
                self.assertEqual(
                    server_messages,
                    [{"unparsed": "this is not json"}],
                )
            finally:
                process.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
