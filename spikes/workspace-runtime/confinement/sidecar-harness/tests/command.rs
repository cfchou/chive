use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

/// Creates a separate temporary directory for one command-building test.
fn fixture(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "chive-sidecar-harness-{}-{name}",
        std::process::id()
    ));
    // A stopped test may leave its old directory behind, so clear only this fixture.
    if root.exists() {
        fs::remove_dir_all(&root).expect("remove old test fixture");
    }
    fs::create_dir_all(&root).expect("create test fixture");
    root
}

/// Makes a fake nono that prints every argument for the test to inspect.
fn fake_nono(root: &std::path::Path) -> PathBuf {
    let path = root.join("nono");
    fs::write(&path, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").expect("write fake nono");
    let mut permissions = fs::metadata(&path).expect("read fake nono").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).expect("make fake nono executable");
    path
}

/// Shows the complete Chive-owned command shape in the help text.
#[test]
fn help_describes_the_chive_owned_seam() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .arg("--help")
        .output()
        .expect("run sidecar harness help");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("--nono <path>"));
    assert!(stdout.contains("Selected installed nono executable."));
    assert!(stdout.contains("--profile <name-or-path>"));
    assert!(stdout.contains("Selected packed or user profile."));
    assert!(stdout.contains("--workspace-rw <path>"));
    assert!(stdout.contains("Runtime working directory, granted read-write."));
    assert!(!stdout.contains("--workspace <path>"));
    assert!(stdout.contains("--net <open|agent-only|restricted>"));
    assert!(!stdout.contains("--net <open|blocked|restricted>"));
    assert!(stdout.contains("open: Add no network restriction."));
    assert!(stdout.contains("The selected profile must also allow outbound traffic."));
    assert!(!stdout.contains("--network-profile"));
    assert!(!stdout.contains("--allow-unix-socket"));
    assert!(stdout.contains("-- <command> [args...]"));
}

/// Keeps nono's broad named network lists out of Chive's explicit allowlist.
#[test]
fn network_profile_option_is_rejected() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--network-profile", "codex", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("unknown option `--network-profile`"));
}

/// Keeps the old name from hiding which part grants read-write access.
#[test]
fn old_workspace_name_is_rejected() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--workspace", "/tmp", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("unknown option `--workspace`"));
}

/// Keeps the removed agent-domain name from becoming a hidden second allowlist.
#[test]
fn agent_domain_name_is_rejected() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--agent-domain", "chatgpt.com", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("unknown option `--agent-domain`"));
}

/// Points old blocked-mode callers to the clearer agent-only name.
#[test]
fn blocked_network_name_points_to_agent_only() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--net", "blocked", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("network mode `blocked` was renamed to `agent-only`"));
}

/// Shows that agent-only keeps the agent online and denies other sites.
#[test]
fn help_explains_what_agent_only_network_means() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .arg("--help")
        .output()
        .expect("run sidecar harness help");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("agent-only: Allow only the selected agent's required hosts."));
    assert!(!stdout.contains("--agent-domain"));
    assert!(stdout.contains("--allow-domain <domain>"));
    assert!(stdout.contains("One final allowed domain; may be repeated."));
    assert!(stdout.contains("Chive builds this list before starting the harness."));
    assert!(stdout.contains("agent-only: include only hosts the selected agent needs."));
    assert!(stdout.contains("restricted: also include user-approved extra sites."));
}

/// Proves one path becomes both nono's read-write grant and working directory.
#[test]
fn open_mode_grants_only_the_named_workspace() {
    let root = fixture("open");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let workspace = workspace.canonicalize().expect("resolve workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "open", "--", "/bin/echo", "OK"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    let arguments: Vec<&str> = stdout.lines().collect();
    // Exact argument order makes accidental broad grants visible in review.
    assert_eq!(
        arguments,
        [
            "run",
            "--profile",
            "codex",
            "-a",
            workspace.to_str().expect("workspace path is UTF-8"),
            "--workdir",
            workspace.to_str().expect("workspace path is UTF-8"),
            "--no-rollback",
            "--diagnostics-json",
            "--",
            "/bin/echo",
            "OK",
        ]
    );
}

/// Stops open mode from silently ignoring a network allowlist.
#[test]
fn open_mode_rejects_network_allowlist_options() {
    let root = fixture("open-with-allowlist");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "open"])
        .args(["--allow-domain", "chatgpt.com"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("open mode does not accept network allowlist options"));
}

/// Proves that agent-only passes Chive's final allowlist to nono.
#[test]
fn agent_only_mode_passes_the_final_allowlist() {
    let root = fixture("agent-only");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let workspace = workspace.canonicalize().expect("resolve workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "agent-only"])
        .args(["--allow-domain", "chatgpt.com"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let arguments: Vec<&str> = stdout.lines().collect();
    assert!(
        arguments
            .windows(2)
            .any(|pair| pair == ["--allow-domain", "chatgpt.com"])
    );
    assert!(!arguments.contains(&"--block-net"));
}

/// Stops agent-only when Chive has not supplied a final network rule.
#[test]
fn agent_only_mode_requires_a_final_network_rule() {
    let root = fixture("agent-only-without-network-rule");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "opencode-0723a"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "agent-only", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("agent-only mode needs at least one `--allow-domain`"));
}

/// Proves that restricted mode passes only the reviewed network entries.
#[test]
fn restricted_mode_passes_only_the_named_network_rules() {
    let root = fixture("restricted");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let workspace = workspace.canonicalize().expect("resolve workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "restricted"])
        .args(["--allow-domain", "chatgpt.com"])
        .args(["--allow-domain", "docs.rs"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    let arguments: Vec<&str> = stdout.lines().collect();
    assert!(
        arguments
            .windows(2)
            .any(|pair| pair == ["--allow-domain", "chatgpt.com"])
    );
    assert!(
        arguments
            .windows(2)
            .any(|pair| pair == ["--allow-domain", "docs.rs"])
    );
    assert!(!arguments.contains(&"--block-net"));
}

/// Stops restricted mode when Chive has not supplied a final network rule.
#[test]
fn restricted_mode_requires_a_final_network_rule() {
    let root = fixture("restricted-without-network-rule");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "opencode-0723a"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "restricted"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("restricted mode needs at least one `--allow-domain`"));
}

/// Keeps socket policy inside the selected nono profile instead of Chive.
#[test]
fn unix_socket_option_is_rejected() {
    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--allow-unix-socket", "/var/run/mDNSResponder"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("unknown option `--allow-unix-socket`"));
}

/// Proves that each requested credential service is passed by name.
#[test]
fn credentials_are_explicit_and_repeatable() {
    let root = fixture("credentials");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let workspace = workspace.canonicalize().expect("resolve workspace");
    let nono = fake_nono(&root);

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "open"])
        .args(["--credential", "openai"])
        .args(["--credential", "anthropic"])
        .args(["--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let arguments: Vec<&str> = stdout.lines().collect();
    assert!(
        arguments
            .windows(2)
            .any(|pair| pair == ["--credential", "openai"])
    );
    assert!(
        arguments
            .windows(2)
            .any(|pair| pair == ["--credential", "anthropic"])
    );
}

/// Proves that a nono or runtime failure reaches the Chive caller.
#[test]
fn child_exit_code_reaches_the_harness_caller() {
    let root = fixture("exit-code");
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    // Exit 23 is unusual enough to prove the harness did not replace it.
    let nono = root.join("nono");
    fs::write(&nono, "#!/bin/sh\nexit 23\n").expect("write fake nono");
    let mut permissions = fs::metadata(&nono).expect("read fake nono").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&nono, permissions).expect("make fake nono executable");

    let output = Command::new(env!("CARGO_BIN_EXE_sidecar-harness"))
        .args(["--nono", nono.to_str().expect("nono path is UTF-8")])
        .args(["--profile", "codex"])
        .args([
            "--workspace-rw",
            workspace.to_str().expect("workspace path is UTF-8"),
        ])
        .args(["--net", "open", "--", "/bin/true"])
        .output()
        .expect("run sidecar harness");

    assert_eq!(output.status.code(), Some(23));
}
