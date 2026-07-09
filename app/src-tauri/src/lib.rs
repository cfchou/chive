use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

#[tauri::command]
fn read_pdf(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_pdf_atomic(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(path);
    let parent = target
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Target path has no valid file name".to_string())?;
    let temp = parent.join(format!(".{file_name}.tmp"));

    fs::write(&temp, bytes).map_err(|error| error.to_string())?;

    if target.exists() {
        let backup = backup_path(&target);
        fs::copy(&target, backup).map_err(|error| error.to_string())?;
    }

    fs::rename(&temp, &target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })
}

fn backup_path(target: &Path) -> PathBuf {
    let extension = target
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("pdf");
    target.with_extension(format!("{extension}.bak"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // D11: single-instance enforcement — second launch focuses the existing
    // window and forwards argv PDF paths as an event to the frontend.
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let window = app.get_webview_window("main");
        if let Some(window) = window {
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Forward argv entries that look like PDF paths to the frontend.
        let pdf_args: Vec<String> = argv
            .iter()
            .filter(|arg| arg.ends_with(".pdf"))
            .cloned()
            .collect();
        if !pdf_args.is_empty() {
            let _ = app.emit("single-instance-pdf-paths", pdf_args);
        }
    }));

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![read_pdf, write_pdf_atomic])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
