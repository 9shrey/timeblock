mod db;
mod files;

use db::{Db, Row, Stmt};
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let db = Db::open(&dir)
                .map_err(|e| format!("Could not open database in {}: {e}", dir.display()))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_batch,
            db_exec_script,
            backup_now,
            backup_if_stale,
            data_dir,
            reveal_data_dir,
            files::save_text_file,
            files::open_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
