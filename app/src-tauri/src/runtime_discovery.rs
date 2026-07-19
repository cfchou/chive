use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read};
#[cfg(unix)]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const CHILD_TIMEOUT: Duration = Duration::from_secs(3);
const RUNTIME_BUDGET: Duration = Duration::from_secs(4);
const OUTPUT_LIMIT: usize = 8 * 1024;
const VERSION_LIMIT: usize = 256;
#[cfg(unix)]
const DRAIN_CHUNKS_PER_TICK: usize = 64;

struct DiscoveryEnvironment {
    home: Option<PathBuf>,
    path_directories: Vec<PathBuf>,
    npm_prefix: Option<PathBuf>,
    mise_data_dir: Option<PathBuf>,
    system_directories: Vec<PathBuf>,
    codex_app_paths: Vec<PathBuf>,
}

impl DiscoveryEnvironment {
    fn system() -> Self {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut codex_app_paths = vec![PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        )];
        if let Some(home) = &home {
            codex_app_paths.push(home.join("Applications/Codex.app/Contents/Resources/codex"));
        }
        Self {
            home,
            path_directories: std::env::var_os("PATH")
                .map(|value| std::env::split_paths(&value).collect())
                .unwrap_or_default(),
            npm_prefix: std::env::var_os("NPM_CONFIG_PREFIX")
                .or_else(|| std::env::var_os("npm_config_prefix"))
                .map(PathBuf::from),
            mise_data_dir: std::env::var_os("MISE_DATA_DIR").map(PathBuf::from),
            system_directories: vec![
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
            ],
            codex_app_paths,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeDiscoveryRequest {
    pub(crate) executable_override: Option<ExecutableOverride>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutableOverride {
    pub(crate) runtime: RuntimeId,
    pub(crate) path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RuntimeId {
    Codex,
    Opencode,
    ClaudeCode,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeDiscoveryReport {
    pub(crate) runtimes: Vec<RuntimeProbe>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum RuntimeProbe {
    Ready {
        runtime: RuntimeId,
        executable_path: String,
        display_path: String,
        version: String,
        source: RuntimeSource,
    },
    Unavailable {
        runtime: RuntimeId,
        reason: UnavailableReason,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<RuntimeSource>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RuntimeSource {
    ExecutableOverride,
    InheritedPath,
    KnownLocation,
    CodexAppBundle,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum UnavailableReason {
    NotFound,
    OverrideNotAbsolute,
    PathNotFound,
    PathNotFile,
    PathNotExecutable,
    ProbeTimeout,
    ScanBudgetExhausted,
    ProbeFailed,
    VersionUnreadable,
}

pub(crate) fn scan(request: RuntimeDiscoveryRequest) -> RuntimeDiscoveryReport {
    scan_with_environment(request, &DiscoveryEnvironment::system())
}

fn scan_with_environment(
    request: RuntimeDiscoveryRequest,
    environment: &DiscoveryEnvironment,
) -> RuntimeDiscoveryReport {
    RuntimeDiscoveryReport {
        runtimes: [RuntimeId::Codex, RuntimeId::Opencode, RuntimeId::ClaudeCode]
            .into_iter()
            .map(|runtime| {
                request
                    .executable_override
                    .as_ref()
                    .filter(|executable_override| executable_override.runtime == runtime)
                    .map(|executable_override| probe_override(executable_override, environment))
                    .unwrap_or_else(|| probe_automatic(runtime, environment))
            })
            .collect(),
    }
}

fn probe_override(
    executable_override: &ExecutableOverride,
    environment: &DiscoveryEnvironment,
) -> RuntimeProbe {
    let path = PathBuf::from(&executable_override.path);
    let source = Some(RuntimeSource::ExecutableOverride);
    if !path.is_absolute() {
        return unavailable(
            executable_override.runtime,
            UnavailableReason::OverrideNotAbsolute,
            Some(display_path(&path, environment.home.as_deref())),
            source,
        );
    }

    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return unavailable(
                executable_override.runtime,
                UnavailableReason::PathNotFound,
                Some(display_path(&path, environment.home.as_deref())),
                source,
            );
        }
        Err(_) => {
            return unavailable(
                executable_override.runtime,
                UnavailableReason::PathNotExecutable,
                Some(display_path(&path, environment.home.as_deref())),
                source,
            );
        }
    };
    if !metadata.is_file() {
        return unavailable(
            executable_override.runtime,
            UnavailableReason::PathNotFile,
            Some(display_path(&path, environment.home.as_deref())),
            source,
        );
    }
    if !is_executable(&metadata) {
        return unavailable(
            executable_override.runtime,
            UnavailableReason::PathNotExecutable,
            Some(display_path(&path, environment.home.as_deref())),
            source,
        );
    }

    match probe_version(&path, CHILD_TIMEOUT) {
        Ok(version) => RuntimeProbe::Ready {
            runtime: executable_override.runtime,
            executable_path: path.to_string_lossy().into_owned(),
            display_path: display_path(&path, environment.home.as_deref()),
            version,
            source: RuntimeSource::ExecutableOverride,
        },
        Err(reason) => unavailable(
            executable_override.runtime,
            reason,
            Some(display_path(&path, environment.home.as_deref())),
            source,
        ),
    }
}

fn probe_automatic(runtime: RuntimeId, environment: &DiscoveryEnvironment) -> RuntimeProbe {
    probe_automatic_with_limits(runtime, environment, CHILD_TIMEOUT, RUNTIME_BUDGET)
}

fn probe_automatic_with_limits(
    runtime: RuntimeId,
    environment: &DiscoveryEnvironment,
    child_timeout: Duration,
    runtime_budget: Duration,
) -> RuntimeProbe {
    let mut first_failure = None;
    let started = Instant::now();
    for candidate in automatic_candidates(runtime, environment) {
        // Read metadata once. It tells us both whether the candidate exists and whether it can run.
        let Ok(metadata) = fs::metadata(&candidate.path) else {
            continue;
        };
        let remaining = runtime_budget.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return unavailable(
                runtime,
                UnavailableReason::ScanBudgetExhausted,
                Some(display_path(&candidate.path, environment.home.as_deref())),
                Some(candidate.source),
            );
        }
        match probe_candidate(
            runtime,
            &candidate.path,
            candidate.source,
            environment.home.as_deref(),
            &metadata,
            child_timeout.min(remaining),
        ) {
            ready @ RuntimeProbe::Ready { .. } => return ready,
            unavailable @ RuntimeProbe::Unavailable { .. } => {
                if started.elapsed() >= runtime_budget {
                    return unavailable_probe(
                        runtime,
                        UnavailableReason::ScanBudgetExhausted,
                        &candidate,
                        environment.home.as_deref(),
                    );
                }
                if first_failure.is_none() {
                    first_failure = Some(unavailable);
                }
            }
        }
    }
    first_failure.unwrap_or_else(|| unavailable(runtime, UnavailableReason::NotFound, None, None))
}

#[derive(Clone)]
struct Candidate {
    path: PathBuf,
    source: RuntimeSource,
}

fn automatic_candidates(runtime: RuntimeId, environment: &DiscoveryEnvironment) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for directory in &environment.path_directories {
        add_binary_candidates(
            &mut candidates,
            &mut seen,
            runtime,
            directory,
            RuntimeSource::InheritedPath,
        );
    }
    if let Some(prefix) = &environment.npm_prefix {
        add_binary_candidates(
            &mut candidates,
            &mut seen,
            runtime,
            &prefix.join("bin"),
            RuntimeSource::KnownLocation,
        );
    }
    if let Some(mise) = &environment.mise_data_dir {
        add_binary_candidates(
            &mut candidates,
            &mut seen,
            runtime,
            &mise.join("shims"),
            RuntimeSource::KnownLocation,
        );
        add_version_root(
            &mut candidates,
            &mut seen,
            runtime,
            &mise.join("installs/node"),
            &["bin"],
        );
        add_version_root(
            &mut candidates,
            &mut seen,
            runtime,
            &mise.join("installs/npm-openai-codex"),
            &["bin"],
        );
    }
    if let Some(home) = &environment.home {
        for relative in [
            ".local/bin",
            ".bun/bin",
            ".volta/bin",
            ".asdf/shims",
            "Library/pnpm",
            ".npm-global/bin",
            ".npm-packages/bin",
            ".local/share/mise/shims",
            ".mise/shims",
        ] {
            add_binary_candidates(
                &mut candidates,
                &mut seen,
                runtime,
                &home.join(relative),
                RuntimeSource::KnownLocation,
            );
        }
        for (root, suffix) in [
            (".nvm/versions/node", &["bin"][..]),
            (
                ".local/share/fnm/node-versions",
                &["installation", "bin"][..],
            ),
            (".fnm/node-versions", &["installation", "bin"][..]),
            (".local/share/mise/installs/node", &["bin"][..]),
            (".local/share/mise/installs/npm-openai-codex", &["bin"][..]),
            (".mise/installs/node", &["bin"][..]),
            (".mise/installs/npm-openai-codex", &["bin"][..]),
        ] {
            add_version_root(
                &mut candidates,
                &mut seen,
                runtime,
                &home.join(root),
                suffix,
            );
        }
    }
    for directory in &environment.system_directories {
        add_binary_candidates(
            &mut candidates,
            &mut seen,
            runtime,
            directory,
            RuntimeSource::KnownLocation,
        );
    }
    if runtime == RuntimeId::Codex {
        for path in &environment.codex_app_paths {
            add_candidate(
                &mut candidates,
                &mut seen,
                path.clone(),
                RuntimeSource::CodexAppBundle,
            );
        }
    }
    candidates
}

fn add_binary_candidates(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<PathBuf>,
    runtime: RuntimeId,
    directory: &Path,
    source: RuntimeSource,
) {
    for binary_name in binary_names(runtime) {
        add_candidate(candidates, seen, directory.join(binary_name), source);
    }
}

fn add_candidate(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<PathBuf>,
    path: PathBuf,
    source: RuntimeSource,
) {
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    if seen.insert(absolute.clone()) {
        candidates.push(Candidate {
            path: absolute,
            source,
        });
    }
}

fn add_version_root(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<PathBuf>,
    runtime: RuntimeId,
    root: &Path,
    suffix: &[&str],
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut versions: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }
            Some((
                entry.file_name().to_string_lossy().into_owned(),
                entry.path(),
            ))
        })
        .collect();
    versions.sort_by(|left, right| compare_versions(&right.0, &left.0));
    for (_, mut directory) in versions {
        for segment in suffix {
            directory.push(segment);
        }
        add_binary_candidates(
            candidates,
            seen,
            runtime,
            &directory,
            RuntimeSource::KnownLocation,
        );
    }
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    match (numeric_version(left), numeric_version(right)) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => left.cmp(right),
    }
}

fn numeric_version(value: &str) -> Option<Vec<u64>> {
    let value = value.strip_prefix('v').unwrap_or(value);
    let core = value.split(['-', '+']).next()?;
    let numbers: Option<Vec<u64>> = core.split('.').map(|part| part.parse().ok()).collect();
    numbers.filter(|parts| !parts.is_empty())
}

fn unavailable_probe(
    runtime: RuntimeId,
    reason: UnavailableReason,
    candidate: &Candidate,
    home: Option<&Path>,
) -> RuntimeProbe {
    unavailable(
        runtime,
        reason,
        Some(display_path(&candidate.path, home)),
        Some(candidate.source),
    )
}

fn binary_names(runtime: RuntimeId) -> &'static [&'static str] {
    match runtime {
        RuntimeId::Codex => &["codex"],
        RuntimeId::Opencode => &["opencode", "opencode-cli"],
        RuntimeId::ClaudeCode => &["claude"],
    }
}

fn probe_candidate(
    runtime: RuntimeId,
    path: &Path,
    source: RuntimeSource,
    home: Option<&Path>,
    metadata: &fs::Metadata,
    timeout: Duration,
) -> RuntimeProbe {
    let display = Some(display_path(path, home));
    if !metadata.is_file() {
        return unavailable(
            runtime,
            UnavailableReason::PathNotFile,
            display,
            Some(source),
        );
    }
    if !is_executable(metadata) {
        return unavailable(
            runtime,
            UnavailableReason::PathNotExecutable,
            display,
            Some(source),
        );
    }
    match probe_version(path, timeout) {
        Ok(version) => RuntimeProbe::Ready {
            runtime,
            executable_path: path.to_string_lossy().into_owned(),
            display_path: display_path(path, home),
            version,
            source,
        },
        Err(reason) => unavailable(runtime, reason, display, Some(source)),
    }
}

fn unavailable(
    runtime: RuntimeId,
    reason: UnavailableReason,
    display_path: Option<String>,
    source: Option<RuntimeSource>,
) -> RuntimeProbe {
    RuntimeProbe::Unavailable {
        runtime,
        reason,
        display_path,
        source,
    }
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(unix)]
fn probe_version(path: &Path, timeout: Duration) -> Result<String, UnavailableReason> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| UnavailableReason::ProbeFailed)?;
    let mut stdout = child.stdout.take().ok_or(UnavailableReason::ProbeFailed)?;
    let mut stderr = child.stderr.take().ok_or(UnavailableReason::ProbeFailed)?;
    set_nonblocking(&stdout).map_err(|_| UnavailableReason::ProbeFailed)?;
    set_nonblocking(&stderr).map_err(|_| UnavailableReason::ProbeFailed)?;
    let mut stdout_bytes = Vec::with_capacity(OUTPUT_LIMIT);
    let mut stderr_bytes = Vec::with_capacity(OUTPUT_LIMIT);
    let deadline = Instant::now() + timeout;

    let status = loop {
        drain_available(&mut stdout, &mut stdout_bytes)
            .map_err(|_| UnavailableReason::ProbeFailed)?;
        drain_available(&mut stderr, &mut stderr_bytes)
            .map_err(|_| UnavailableReason::ProbeFailed)?;
        if let Some(status) = child
            .try_wait()
            .map_err(|_| UnavailableReason::ProbeFailed)?
        {
            break status;
        }
        if Instant::now() >= deadline {
            // Always reap a timed-out child so repeated rescans cannot leave zombies behind.
            let _ = child.kill();
            let _ = child.wait();
            return Err(UnavailableReason::ProbeTimeout);
        }
        thread::sleep(Duration::from_millis(10));
    };

    // Read bytes that were written just before the child exited. Do not wait for EOF because a
    // descendant may still own the write side of either pipe.
    drain_available(&mut stdout, &mut stdout_bytes).map_err(|_| UnavailableReason::ProbeFailed)?;
    drain_available(&mut stderr, &mut stderr_bytes).map_err(|_| UnavailableReason::ProbeFailed)?;
    if !status.success() {
        return Err(UnavailableReason::ProbeFailed);
    }

    first_version_line(&stdout_bytes)
        .or_else(|| first_version_line(&stderr_bytes))
        .ok_or(UnavailableReason::VersionUnreadable)
}

#[cfg(unix)]
fn set_nonblocking(pipe: &impl AsRawFd) -> io::Result<()> {
    let file_descriptor = pipe.as_raw_fd();
    // fcntl only reads or updates flags on this pipe. The descriptor stays owned by ChildStdout
    // or ChildStderr and is closed normally when that value is dropped.
    let flags = unsafe { libc::fcntl(file_descriptor, libc::F_GETFL) };
    if flags == -1 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(file_descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn drain_available(reader: &mut impl Read, kept: &mut Vec<u8>) -> io::Result<()> {
    let mut chunk = [0_u8; 1024];
    for _ in 0..DRAIN_CHUNKS_PER_TICK {
        match reader.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(count) => {
                let remaining = OUTPUT_LIMIT.saturating_sub(kept.len());
                kept.extend_from_slice(&chunk[..count.min(remaining)]);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn probe_version(path: &Path, timeout: Duration) -> Result<String, UnavailableReason> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| UnavailableReason::ProbeFailed)?;
    let stdout = child.stdout.take().ok_or(UnavailableReason::ProbeFailed)?;
    let stderr = child.stderr.take().ok_or(UnavailableReason::ProbeFailed)?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout));
    let stderr_reader = thread::spawn(move || read_bounded(stderr));
    let deadline = Instant::now() + timeout;

    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| UnavailableReason::ProbeFailed)?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(UnavailableReason::ProbeTimeout);
        }
        thread::sleep(Duration::from_millis(10));
    };

    let stdout = stdout_reader
        .join()
        .map_err(|_| UnavailableReason::ProbeFailed)?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| UnavailableReason::ProbeFailed)?;
    if !status.success() {
        return Err(UnavailableReason::ProbeFailed);
    }

    first_version_line(&stdout)
        .or_else(|| first_version_line(&stderr))
        .ok_or(UnavailableReason::VersionUnreadable)
}

#[cfg(not(unix))]
fn read_bounded(mut reader: impl Read) -> Vec<u8> {
    let mut kept = Vec::with_capacity(OUTPUT_LIMIT);
    let mut chunk = [0_u8; 1024];
    loop {
        let Ok(count) = reader.read(&mut chunk) else {
            break;
        };
        if count == 0 {
            break;
        }
        // Keep draining after the cap so the child never blocks on a full pipe.
        let remaining = OUTPUT_LIMIT.saturating_sub(kept.len());
        kept.extend_from_slice(&chunk[..count.min(remaining)]);
    }
    kept
}

fn first_version_line(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .lines()
        .map(|line| {
            line.chars()
                .filter(|character| !character.is_control())
                .collect::<String>()
                .trim()
                .chars()
                .take(VERSION_LIMIT)
                .collect::<String>()
        })
        .find(|line| !line.is_empty())
}

fn display_path(path: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home {
        if let Ok(relative) = path.strip_prefix(home) {
            return if relative.as_os_str().is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", relative.to_string_lossy())
            };
        }
    }
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should follow the Unix epoch")
                .as_nanos();
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "chive-runtime-discovery-{}-{unique}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_executable(path: &Path, body: &str) {
        fs::write(path, body).expect("test executable should be written");
        let mut permissions = fs::metadata(path)
            .expect("test executable should have metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("test executable should be executable");
    }

    fn first_unavailable_reason(report: &RuntimeDiscoveryReport) -> UnavailableReason {
        match &report.runtimes[0] {
            RuntimeProbe::Unavailable { reason, .. } => *reason,
            probe => panic!("expected unavailable Codex, got {probe:?}"),
        }
    }

    #[test]
    fn scan_returns_every_runtime_in_builtin_priority_order() {
        let report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: None,
            },
            &DiscoveryEnvironment {
                home: None,
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );
        let runtimes: Vec<RuntimeId> = report
            .runtimes
            .iter()
            .map(|probe| match probe {
                RuntimeProbe::Ready { runtime, .. } | RuntimeProbe::Unavailable { runtime, .. } => {
                    *runtime
                }
            })
            .collect();

        assert_eq!(
            runtimes,
            vec![RuntimeId::Codex, RuntimeId::Opencode, RuntimeId::ClaudeCode]
        );
    }

    #[test]
    fn executable_override_is_launched_directly_and_reports_its_version() {
        let directory = TestDir::new();
        let executable = directory.path().join("codex $(do-not-run) ; safe");
        write_executable(
            &executable,
            "#!/bin/sh\n[ \"$1\" = \"--version\" ] || exit 9\nprintf '  codex 1.2.3\\n'\n",
        );

        let report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: Some(ExecutableOverride {
                    runtime: RuntimeId::Codex,
                    path: executable.to_string_lossy().into_owned(),
                }),
            },
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        match &report.runtimes[0] {
            RuntimeProbe::Ready {
                runtime,
                executable_path,
                display_path,
                version,
                source,
                ..
            } => {
                assert_eq!(*runtime, RuntimeId::Codex);
                assert_eq!(executable_path, executable.to_string_lossy().as_ref());
                assert_eq!(display_path, "~/codex $(do-not-run) ; safe");
                assert_eq!(version, "codex 1.2.3");
                assert_eq!(*source, RuntimeSource::ExecutableOverride);
            }
            probe => panic!("expected a ready Codex override, got {probe:?}"),
        }
    }

    #[test]
    fn executable_override_does_not_wait_for_a_descendant_holding_stdout() {
        let directory = TestDir::new();
        let executable = directory.path().join("codex-with-descendant");
        write_executable(
            &executable,
            "#!/bin/sh\nsleep 2 &\nprintf 'codex parent exited\\n'\n",
        );

        let started = Instant::now();
        let report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: Some(ExecutableOverride {
                    runtime: RuntimeId::Codex,
                    path: executable.to_string_lossy().into_owned(),
                }),
            },
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        assert!(
            started.elapsed() < Duration::from_secs(1),
            "discovery waited for a descendant that outlived the executable"
        );
        assert!(matches!(
            &report.runtimes[0],
            RuntimeProbe::Ready { version, .. } if version == "codex parent exited"
        ));
    }

    #[test]
    fn timed_out_probe_kills_and_reaps_its_child() {
        let directory = TestDir::new();
        let executable = directory.path().join("codex-hangs");
        let pid_file = directory.path().join("child.pid");
        write_executable(
            &executable,
            &format!(
                "#!/bin/sh\nprintf '%s' $$ > '{}'\nwhile :; do :; done\n",
                pid_file.to_string_lossy()
            ),
        );

        let started = Instant::now();
        assert_eq!(
            probe_version(&executable, Duration::from_millis(500)),
            Err(UnavailableReason::ProbeTimeout)
        );
        assert!(started.elapsed() < Duration::from_secs(2));

        let pid: i32 = fs::read_to_string(&pid_file)
            .expect("the child should write its pid")
            .parse()
            .expect("the child pid should be a number");
        // Signal 0 only checks whether the reaped child still exists.
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    }

    #[test]
    fn automatic_probe_stops_at_its_budget_and_leaves_the_next_runtime_a_fresh_budget() {
        let directory = TestDir::new();
        let first_bin = directory.path().join("first/bin");
        let second_bin = directory.path().join("second/bin");
        let third_bin = directory.path().join("third/bin");
        fs::create_dir_all(&first_bin).expect("first bin should be created");
        fs::create_dir_all(&second_bin).expect("second bin should be created");
        fs::create_dir_all(&third_bin).expect("third bin should be created");
        write_executable(&first_bin.join("codex"), "#!/bin/sh\nwhile :; do :; done\n");
        write_executable(
            &second_bin.join("codex"),
            "#!/bin/sh\nwhile :; do :; done\n",
        );
        let marker = directory.path().join("third-ran");
        write_executable(
            &third_bin.join("codex"),
            &format!(
                "#!/bin/sh\ntouch '{}'\nprintf 'codex late\n'\n",
                marker.to_string_lossy()
            ),
        );
        write_executable(
            &first_bin.join("opencode"),
            "#!/bin/sh\nprintf 'opencode ready\n'\n",
        );
        let environment = DiscoveryEnvironment {
            home: Some(directory.path().to_path_buf()),
            path_directories: vec![first_bin, second_bin, third_bin],
            npm_prefix: None,
            mise_data_dir: None,
            system_directories: vec![],
            codex_app_paths: vec![],
        };

        let started = Instant::now();
        let codex = probe_automatic_with_limits(
            RuntimeId::Codex,
            &environment,
            Duration::from_millis(500),
            Duration::from_millis(700),
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(matches!(
            codex,
            RuntimeProbe::Unavailable {
                reason: UnavailableReason::ScanBudgetExhausted,
                ..
            }
        ));
        assert!(
            !marker.exists(),
            "the candidate after the budget must not run"
        );

        let opencode = probe_automatic_with_limits(
            RuntimeId::Opencode,
            &environment,
            CHILD_TIMEOUT,
            RUNTIME_BUDGET,
        );
        assert!(
            matches!(
                &opencode,
                RuntimeProbe::Ready { version, .. } if version == "opencode ready"
            ),
            "expected the next runtime to keep its own budget, got {opencode:?}"
        );
    }

    #[test]
    fn invalid_executable_overrides_are_terminal() {
        let directory = TestDir::new();
        let fallback_bin = directory.path().join("fallback-bin");
        fs::create_dir_all(&fallback_bin).expect("fallback bin should be created");
        write_executable(
            &fallback_bin.join("codex"),
            "#!/bin/sh\nprintf 'codex fallback\\n'\n",
        );
        let override_directory = directory.path().join("override-directory");
        fs::create_dir_all(&override_directory).expect("override directory should be created");
        let non_executable = directory.path().join("non-executable");
        fs::write(&non_executable, "not executable")
            .expect("non-executable fixture should be written");

        let cases = [
            (
                "relative/codex".to_string(),
                UnavailableReason::OverrideNotAbsolute,
            ),
            (
                directory
                    .path()
                    .join("missing")
                    .to_string_lossy()
                    .into_owned(),
                UnavailableReason::PathNotFound,
            ),
            (
                override_directory.to_string_lossy().into_owned(),
                UnavailableReason::PathNotFile,
            ),
            (
                non_executable.to_string_lossy().into_owned(),
                UnavailableReason::PathNotExecutable,
            ),
        ];

        for (path, expected_reason) in cases {
            let report = scan_with_environment(
                RuntimeDiscoveryRequest {
                    executable_override: Some(ExecutableOverride {
                        runtime: RuntimeId::Codex,
                        path,
                    }),
                },
                &DiscoveryEnvironment {
                    home: Some(directory.path().to_path_buf()),
                    path_directories: vec![fallback_bin.clone()],
                    npm_prefix: None,
                    mise_data_dir: None,
                    system_directories: vec![],
                    codex_app_paths: vec![],
                },
            );

            assert_eq!(first_unavailable_reason(&report), expected_reason);
        }
    }

    #[test]
    fn version_output_uses_stderr_sanitizes_controls_and_caps_length() {
        let directory = TestDir::new();
        let stderr_executable = directory.path().join("codex-stderr");
        write_executable(
            &stderr_executable,
            "#!/bin/sh\nprintf '   \\n'\nprintf '\\033codex\\t1.2.3\\n' >&2\n",
        );
        assert_eq!(
            probe_version(&stderr_executable, CHILD_TIMEOUT),
            Ok("codex1.2.3".to_string())
        );

        let long_executable = directory.path().join("codex-long");
        let long_version = "x".repeat(OUTPUT_LIMIT * 16);
        write_executable(
            &long_executable,
            &format!("#!/bin/sh\nprintf '{long_version}\\n'\n"),
        );
        assert_eq!(
            probe_version(&long_executable, CHILD_TIMEOUT),
            Ok("x".repeat(VERSION_LIMIT))
        );
    }

    #[test]
    fn failed_or_empty_version_output_returns_only_a_fixed_reason() {
        let directory = TestDir::new();
        let failed = directory.path().join("codex-failed");
        write_executable(
            &failed,
            "#!/bin/sh\nprintf 'private child output\\n' >&2\nexit 7\n",
        );
        let failed_report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: Some(ExecutableOverride {
                    runtime: RuntimeId::Codex,
                    path: failed.to_string_lossy().into_owned(),
                }),
            },
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );
        assert_eq!(
            first_unavailable_reason(&failed_report),
            UnavailableReason::ProbeFailed
        );
        assert!(!serde_json::to_string(&failed_report)
            .expect("report should serialize")
            .contains("private child output"));

        let empty = directory.path().join("codex-empty");
        write_executable(&empty, "#!/bin/sh\nexit 0\n");
        assert_eq!(
            probe_version(&empty, CHILD_TIMEOUT),
            Err(UnavailableReason::VersionUnreadable)
        );
    }

    #[test]
    fn broken_opencode_candidate_falls_through_to_the_alias() {
        let directory = TestDir::new();
        let bin = directory.path().join("bin");
        fs::create_dir_all(&bin).expect("bin should be created");
        write_executable(&bin.join("opencode"), "#!/bin/sh\nexit 7\n");
        write_executable(
            &bin.join("opencode-cli"),
            "#!/bin/sh\nprintf 'opencode alias ready\\n'\n",
        );

        let probe = probe_automatic(
            RuntimeId::Opencode,
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![bin.clone()],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        assert!(matches!(
            probe,
            RuntimeProbe::Ready {
                executable_path,
                version,
                source: RuntimeSource::InheritedPath,
                ..
            } if executable_path == bin.join("opencode-cli").to_string_lossy()
                && version == "opencode alias ready"
        ));
    }

    #[test]
    fn version_manager_candidates_use_newest_numeric_version_first() {
        let directory = TestDir::new();
        let old_bin = directory.path().join(".nvm/versions/node/v2.9.0/bin");
        let new_bin = directory.path().join(".nvm/versions/node/v10.1.0/bin");
        fs::create_dir_all(&old_bin).expect("old version bin should be created");
        fs::create_dir_all(&new_bin).expect("new version bin should be created");
        write_executable(&old_bin.join("codex"), "#!/bin/sh\nprintf 'codex old\\n'\n");
        write_executable(
            &new_bin.join("codex"),
            "#!/bin/sh\nprintf 'codex newest\\n'\n",
        );

        let probe = probe_automatic(
            RuntimeId::Codex,
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        assert!(matches!(
            probe,
            RuntimeProbe::Ready {
                executable_path,
                version,
                source: RuntimeSource::KnownLocation,
                ..
            } if executable_path == new_bin.join("codex").to_string_lossy()
                && version == "codex newest"
        ));
    }

    #[test]
    fn npm_and_mise_environment_overrides_are_discovered() {
        let directory = TestDir::new();
        let npm_prefix = directory.path().join("npm-prefix");
        let npm_bin = npm_prefix.join("bin");
        let mise_data = directory.path().join("mise-data");
        let mise_shims = mise_data.join("shims");
        fs::create_dir_all(&npm_bin).expect("npm bin should be created");
        fs::create_dir_all(&mise_shims).expect("mise shims should be created");
        write_executable(&npm_bin.join("codex"), "#!/bin/sh\nprintf 'codex npm\n'\n");
        write_executable(
            &mise_shims.join("opencode"),
            "#!/bin/sh\nprintf 'opencode mise\n'\n",
        );
        let environment = DiscoveryEnvironment {
            home: Some(directory.path().to_path_buf()),
            path_directories: vec![],
            npm_prefix: Some(npm_prefix),
            mise_data_dir: Some(mise_data),
            system_directories: vec![],
            codex_app_paths: vec![],
        };

        assert!(matches!(
            probe_automatic(RuntimeId::Codex, &environment),
            RuntimeProbe::Ready {
                version,
                source: RuntimeSource::KnownLocation,
                ..
            } if version == "codex npm"
        ));
        assert!(matches!(
            probe_automatic(RuntimeId::Opencode, &environment),
            RuntimeProbe::Ready {
                version,
                source: RuntimeSource::KnownLocation,
                ..
            } if version == "opencode mise"
        ));
    }

    #[test]
    fn duplicate_candidates_are_removed_and_codex_app_bundles_stay_last() {
        let directory = TestDir::new();
        let npm_prefix = directory.path().join("shared");
        let shared_bin = npm_prefix.join("bin");
        let environment = DiscoveryEnvironment {
            home: Some(directory.path().to_path_buf()),
            path_directories: vec![shared_bin.clone(), shared_bin.clone()],
            npm_prefix: Some(npm_prefix),
            mise_data_dir: None,
            system_directories: vec![],
            codex_app_paths: vec![
                PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
                directory
                    .path()
                    .join("Applications/Codex.app/Contents/Resources/codex"),
            ],
        };

        let candidates = automatic_candidates(RuntimeId::Codex, &environment);
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate.path == shared_bin.join("codex"))
                .count(),
            1
        );
        let last_two = &candidates[candidates.len() - 2..];
        assert_eq!(
            last_two[0].path,
            PathBuf::from("/Applications/Codex.app/Contents/Resources/codex")
        );
        assert_eq!(
            last_two[1].path,
            directory
                .path()
                .join("Applications/Codex.app/Contents/Resources/codex")
        );
        assert!(last_two
            .iter()
            .all(|candidate| candidate.source == RuntimeSource::CodexAppBundle));
    }

    #[test]
    fn inherited_path_uses_the_first_ready_codex_executable() {
        let directory = TestDir::new();
        let first_bin = directory.path().join("first/bin");
        let second_bin = directory.path().join("second/bin");
        fs::create_dir_all(&first_bin).expect("first bin should be created");
        fs::create_dir_all(&second_bin).expect("second bin should be created");
        write_executable(
            &first_bin.join("codex"),
            "#!/bin/sh\nprintf 'codex first\\n'\n",
        );
        write_executable(
            &second_bin.join("codex"),
            "#!/bin/sh\nprintf 'codex second\\n'\n",
        );

        let report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: None,
            },
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![first_bin.clone(), second_bin],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        match &report.runtimes[0] {
            RuntimeProbe::Ready {
                executable_path,
                version,
                source,
                ..
            } => {
                assert_eq!(
                    executable_path,
                    first_bin.join("codex").to_string_lossy().as_ref()
                );
                assert_eq!(version, "codex first");
                assert_eq!(*source, RuntimeSource::InheritedPath);
            }
            probe => panic!("expected Codex from inherited PATH, got {probe:?}"),
        }
    }

    #[test]
    fn known_home_locations_fill_the_gui_path_gap_for_all_runtimes() {
        let directory = TestDir::new();
        let local_bin = directory.path().join(".local/bin");
        let bun_bin = directory.path().join(".bun/bin");
        fs::create_dir_all(&local_bin).expect("local bin should be created");
        fs::create_dir_all(&bun_bin).expect("bun bin should be created");
        write_executable(&local_bin.join("codex"), "#!/bin/sh\nprintf 'codex 2\\n'\n");
        write_executable(
            &bun_bin.join("opencode"),
            "#!/bin/sh\nprintf 'opencode 3\\n'\n",
        );
        write_executable(
            &local_bin.join("claude"),
            "#!/bin/sh\nprintf 'claude 4\\n'\n",
        );

        let report = scan_with_environment(
            RuntimeDiscoveryRequest {
                executable_override: None,
            },
            &DiscoveryEnvironment {
                home: Some(directory.path().to_path_buf()),
                path_directories: vec![],
                npm_prefix: None,
                mise_data_dir: None,
                system_directories: vec![],
                codex_app_paths: vec![],
            },
        );

        let versions: Vec<(&str, &str)> = report
            .runtimes
            .iter()
            .map(|probe| match probe {
                RuntimeProbe::Ready {
                    version,
                    display_path,
                    source,
                    ..
                } => {
                    assert_eq!(*source, RuntimeSource::KnownLocation);
                    (version.as_str(), display_path.as_str())
                }
                probe => {
                    panic!("expected a ready runtime from a known home location, got {probe:?}")
                }
            })
            .collect();

        assert_eq!(
            versions,
            vec![
                ("codex 2", "~/.local/bin/codex"),
                ("opencode 3", "~/.bun/bin/opencode"),
                ("claude 4", "~/.local/bin/claude"),
            ]
        );
    }
}
