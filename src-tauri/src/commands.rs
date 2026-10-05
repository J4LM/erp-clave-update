use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::Database;
use crate::error::AppResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    database_path: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, db: State<'_, Database>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        database_path: db.path().display().to_string(),
    }
}

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> AppResult<Option<String>> {
    db.get_setting(&key)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Database>, key: String, value: String) -> AppResult<()> {
    db.set_setting(&key, &value)
}
