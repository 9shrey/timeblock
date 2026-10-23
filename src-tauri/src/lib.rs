mod db;
mod files;
mod tray;

use db::{BackupInfo, Db, Row, Stmt};
use serde_json::Value as Json;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

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
    // Same reasoning as single-instance: an e2e run shouldn't inherit (or leave behind)
    // window geometry from a real session, so it skips remembering it.
    if option_env!("VITE_E2E") != Some("1") {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let db = Db::open(&dir)
                .map_err(|e| format!("Could not open database in {}: {e}", dir.display()))?;
            app.manage(db);
            // Same reasoning as single-instance and window-state: an e2e run shouldn't depend
            // on, or leave behind, a real system tray icon.
            if option_env!("VITE_E2E") != Some("1") {
                tray::build(app.handle())?;
                if let Some(window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let close_to_tray = app_handle
                                .try_state::<tray::TrayState>()
                                .is_some_and(|s| s.close_to_tray());
                            if close_to_tray {
                                api.prevent_close();
                                if let Some(w) = app_handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            }
                        }
                    });
                }
            }
            Ok(())
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
            files::save_text_file,
            files::open_text_file,
            tray::set_tray_next_block,
            tray::set_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
