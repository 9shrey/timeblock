//! Export/import file I/O through native dialogs, so the webview needs no fs permissions.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    pub contents: String,
}

/// Shows a save dialog and writes `contents`. Returns the chosen path, or None if cancelled.
#[tauri::command]
pub async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
    contents: String,
    filter_name: String,
    filter_extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let extensions: Vec<&str> = filter_extensions.iter().map(String::as_str).collect();
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &extensions);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents)
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Shows an open dialog and reads the chosen file as UTF-8. None if cancelled.
#[tauri::command]
pub async fn open_text_file<R: Runtime>(
    app: AppHandle<R>,
    filter_name: String,
    filter_extensions: Vec<String>,
) -> Result<Option<OpenedFile>, String> {
    let extensions: Vec<&str> = filter_extensions.iter().map(String::as_str).collect();
    let mut dialog = app.dialog().file().add_filter(&filter_name, &extensions);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(path) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("File is larger than 50 MB".into());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(Some(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        contents,
    }))
}
