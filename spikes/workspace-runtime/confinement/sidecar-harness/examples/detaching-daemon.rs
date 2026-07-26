use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, Instant};

/// Starts a real double-forked daemon and writes its final PID for the test.
fn main() -> ExitCode {
    let Some(pid_file) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: detaching-daemon <pid-file>");
        return ExitCode::from(2);
    };

    match detach(&pid_file) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("detaching-daemon: {message}");
            ExitCode::from(1)
        }
    }
}

/// Forks twice so the final child leaves both the original group and parent tree.
#[cfg(unix)]
fn detach(pid_file: &std::path::Path) -> Result<(), String> {
    let first_child = unsafe { libc::fork() };
    if first_child < 0 {
        return Err(format!(
            "first fork failed: {}",
            std::io::Error::last_os_error()
        ));
    }

    if first_child == 0 {
        become_daemon(pid_file);
    }

    // Reap the middle process, then wait until the daemon has published its PID.
    let mut status = 0;
    if unsafe { libc::waitpid(first_child, &mut status, 0) } < 0 {
        return Err(format!(
            "cannot reap first child: {}",
            std::io::Error::last_os_error()
        ));
    }
    if !libc::WIFEXITED(status) || libc::WEXITSTATUS(status) != 0 {
        return Err("first child could not start the daemon".to_string());
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if pid_file.is_file() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Err("daemon did not publish its PID".to_string())
}

/// Creates a new session, forks once more, and leaves the final child alive.
#[cfg(unix)]
fn become_daemon(pid_file: &std::path::Path) -> ! {
    if unsafe { libc::setsid() } < 0 {
        unsafe { libc::_exit(10) };
    }

    let daemon = unsafe { libc::fork() };
    if daemon < 0 {
        unsafe { libc::_exit(11) };
    }
    if daemon > 0 {
        unsafe { libc::_exit(0) };
    }

    let pid = unsafe { libc::getpid() };
    if std::fs::write(pid_file, format!("{pid}\n")).is_err() {
        unsafe { libc::_exit(12) };
    }

    // Stay alive long enough for the cancellation test to find and stop us.
    loop {
        std::thread::sleep(Duration::from_secs(60));
    }
}

/// The lifecycle spike currently targets Unix process groups only.
#[cfg(not(unix))]
fn detach(_pid_file: &std::path::Path) -> Result<(), String> {
    Err("detaching daemon test is only available on Unix".to_string())
}
