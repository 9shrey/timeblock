mod db;
mod files;
mod tray;

use db::{BackupInfo, Db, Row, Stmt};
use serde_json::Value as Json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Whether closing the main window should hide it to the tray instead of quitting.
/// Set from the frontend (`set_close_to_tray`) to mirror the `closeToTray` setting.
pub struct CloseToTray(pub AtomicBool);

#[tauri::command]
async fn db_select(db: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<Vec<Row>, String> {
    db.select(&sql, &params)
}

#[tauri::command]
async fn db_batch(db: State<'_, Db>, stmts: Vec<Stmt>) -> Result<(), String> {
    db.batch(&stmts)
}

#[tauri::command]
async fn db_exec_script(db: State<'_, Db>, sql: String) -> Result<(), String> {
    db.exec_script(&sql)
}

#[tauri::command]
async fn backup_now(db: State<'_, Db>, reason: String) -> Result<String, String> {
    db.backup_now(&reason)
}

#[tauri::command]
async fn backup_if_stale(db: State<'_, Db>, max_age_hours: u64) -> Result<Option<String>, String> {
    db.backup_if_stale(max_age_hours)
}

#[tauri::command]
async fn list_backups(db: State<'_, Db>) -> Result<Vec<BackupInfo>, String> {
    db.backups()
}

#[tauri::command]
async fn restore_backup(db: State<'_, Db>, name: String) -> Result<(), String> {
    db.restore_backup(&name)
}

#[tauri::command]
fn data_dir(db: State<'_, Db>) -> String {
    db.dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn reveal_data_dir(app: tauri::AppHandle, db: State<'_, Db>) -> Result<(), String> {
    app.opener()
        .open_path(db.dir().to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Mirrors the `closeToTray` setting: when true, closing the main window hides it
/// instead of quitting the app (the tray's Quit item still exits for real).
#[tauri::command]
fn set_close_to_tray(close_to_tray: State<'_, CloseToTray>, value: bool) {
    close_to_tray.0.store(value, Ordering::Relaxed);
}

/// Updates the tray menu's "next block" label, or clears it to "No upcoming block today"
/// when `title` is `None`. Called from the frontend's clock tick.
#[tauri::command]
fn set_tray_next_block(app: tauri::AppHandle, title: Option<String>) -> Result<(), String> {
    tray::set_next_block_label(&app, title.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // Must be registered first. A second launch focuses the running window and exits, so two
    // copies never write the same database. E2E builds skip it so a test run can't collide with
    // a Timeblock you have open (they use their own data folder).
    if option_env!("VITE_E2E") != Some("1") {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(CloseToTray(AtomicBool::new(false)))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let db = Db::open(&dir)
                .map_err(|e| format!("Could not open database in {}: {e}", dir.display()))?;
            app.manage(db);
            tray::build(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
                && window.state::<CloseToTray>().0.load(Ordering::Relaxed)
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_batch,
            db_exec_script,
            backup_now,
            backup_if_stale,
            list_backups,
            restore_backup,
            data_dir,
            reveal_data_dir,
            set_close_to_tray,
            set_tray_next_block,
            files::save_text_file,
            files::open_text_file,
            files::save_ics_file,
            files::open_ics_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
