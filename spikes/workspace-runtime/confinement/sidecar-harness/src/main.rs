use std::path::PathBuf;
use std::process::{Command, ExitCode};

const USAGE: &str = "\
Usage:
  sidecar-harness --nono <path> --profile <name-or-path> --workspace-rw <path> --net <open|agent-only|restricted> [network options] -- <command> [args...]

Options:
  --nono <path>                  Selected installed nono executable.
  --profile <name-or-path>       Selected packed or user profile.
  --workspace-rw <path>          Runtime working directory, granted read-write.
  --net <open|agent-only|restricted>
                                 open: Add no network restriction.
                                 The selected profile must also allow outbound traffic.
                                 agent-only: Allow only the selected agent's required hosts.
                                 restricted: Also allow the user's extra sites.
  --allow-domain <domain>        One final allowed domain; may be repeated.
                                 Chive builds this list before starting the harness.
                                 agent-only: include only hosts the selected agent needs.
                                 restricted: also include user-approved extra sites.
  --credential <service>         Credential service; may be repeated.
  -h, --help                     Print this help.
";

/// The three network choices exposed by Chive's sidecar seam.
enum NetworkPolicy {
    Open,
    AgentOnly,
    Restricted,
}

/// The checked command-line values passed to nono.
struct Args {
    nono: PathBuf,
    profile: String,
    workspace: PathBuf,
    net: NetworkPolicy,
    allow_domains: Vec<String>,
    credentials: Vec<String>,
    command: Vec<String>,
}

/// Runs the harness and turns errors into a short message plus usage help.
fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(code),
        Err(message) => {
            eprintln!("sidecar-harness: {message}");
            eprintln!();
            eprint!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

/// Builds one `nono run` command and returns its exit code.
fn run() -> Result<u8, String> {
    let values: Vec<String> = std::env::args().skip(1).collect();
    if matches!(values.as_slice(), [flag] if flag == "-h" || flag == "--help") {
        print!("{USAGE}");
        return Ok(0);
    }

    let args = parse_args(values)?;
    own_process_group()?;
    let mut child = Command::new(&args.nono);
    // `-a` grants the workspace. `--workdir` also starts the command there.
    child
        .arg("run")
        .args(["--profile", &args.profile])
        .arg("-a")
        .arg(&args.workspace)
        .arg("--workdir")
        .arg(&args.workspace)
        .args(["--no-rollback", "--diagnostics-json"]);

    // Repeat this switch once for every requested credential service.
    for credential in &args.credentials {
        child.args(["--credential", credential]);
    }

    // Open adds no switch. The selected profile can still block the network.
    match args.net {
        NetworkPolicy::Open => {}
        NetworkPolicy::AgentOnly | NetworkPolicy::Restricted => {
            // Nono receives the final list after Chive has combined agent hosts
            // with any user-approved extras required by the selected mode.
            for domain in &args.allow_domains {
                child.args(["--allow-domain", domain]);
            }
        }
    }

    let status = child
        .arg("--")
        .args(&args.command)
        .status()
        .map_err(|error| format!("cannot start `{}`: {error}", args.nono.display()))?;

    // A child killed by a signal has no exit code, so report a normal failure.
    Ok(status.code().unwrap_or(1).clamp(0, 255) as u8)
}

/// Gives this adapter one process group that its nono tree inherits.
#[cfg(unix)]
fn own_process_group() -> Result<(), String> {
    // A caller can stop this group without touching unrelated Chive processes.
    let process_id = unsafe { libc::getpid() };
    let current_group = unsafe { libc::getpgrp() };
    if current_group == process_id {
        return Ok(());
    }

    // `setpgid(0, 0)` makes this process the leader before nono is started.
    let result = unsafe { libc::setpgid(0, 0) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "cannot create the adapter process group: {}",
            std::io::Error::last_os_error()
        ))
    }
}

/// Other platforms need their own process-tree owner before this adapter ships.
#[cfg(not(unix))]
fn own_process_group() -> Result<(), String> {
    Err("process-tree ownership is not implemented on this platform".to_string())
}

/// Splits harness options from the child command and checks required values.
fn parse_args(values: Vec<String>) -> Result<Args, String> {
    let separator = values
        .iter()
        .position(|value| value == "--")
        .ok_or("missing `--` before the child command")?;
    let (options, command_with_separator) = values.split_at(separator);
    let command = command_with_separator[1..].to_vec();
    if command.is_empty() {
        return Err("missing child command".to_string());
    }

    let mut nono = None;
    let mut profile = None;
    let mut workspace = None;
    let mut net = None;
    let mut allow_domains = Vec::new();
    let mut credentials = Vec::new();
    let mut index = 0;
    while index < options.len() {
        let value = options
            .get(index + 1)
            .ok_or_else(|| format!("missing value for `{}`", options[index]))?;
        match options[index].as_str() {
            "--nono" => nono = Some(PathBuf::from(value)),
            "--profile" => profile = Some(value.clone()),
            "--workspace-rw" => workspace = Some(PathBuf::from(value)),
            "--allow-domain" => allow_domains.push(value.clone()),
            "--credential" => credentials.push(value.clone()),
            "--net" => {
                net = Some(match value.as_str() {
                    "open" => NetworkPolicy::Open,
                    "agent-only" => NetworkPolicy::AgentOnly,
                    "restricted" => NetworkPolicy::Restricted,
                    "blocked" => {
                        return Err(
                            "network mode `blocked` was renamed to `agent-only`".to_string()
                        );
                    }
                    other => return Err(format!("unsupported network mode `{other}`")),
                });
            }
            other => return Err(format!("unknown option `{other}`")),
        }
        index += 2;
    }

    // Resolve both paths before spawning so nono receives stable absolute paths.
    let nono = nono
        .ok_or("missing `--nono`")?
        .canonicalize()
        .map_err(|error| format!("cannot resolve nono binary: {error}"))?;
    let workspace = workspace
        .ok_or("missing `--workspace-rw`")?
        .canonicalize()
        .map_err(|error| format!("cannot resolve workspace: {error}"))?;
    if !workspace.is_dir() {
        return Err(format!(
            "workspace is not a directory: `{}`",
            workspace.display()
        ));
    }

    let net = net.ok_or("missing `--net`")?;
    // Open mode should not pretend an allowlist was applied when it was ignored.
    if matches!(net, NetworkPolicy::Open) && !allow_domains.is_empty() {
        return Err("open mode does not accept network allowlist options".to_string());
    }
    if matches!(net, NetworkPolicy::AgentOnly) && allow_domains.is_empty() {
        return Err("agent-only mode needs at least one `--allow-domain`".to_string());
    }
    if matches!(net, NetworkPolicy::Restricted) && allow_domains.is_empty() {
        return Err("restricted mode needs at least one `--allow-domain`".to_string());
    }

    Ok(Args {
        nono,
        profile: profile.ok_or("missing `--profile`")?,
        workspace,
        net,
        allow_domains,
        credentials,
        command,
    })
}
