use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::Database;
use crate::error::AppResult;
use crate::exclusions::{self, ExclusionPreview};
use crate::net::{self, ConnectionTest, Credentials};
use crate::profiles::{Profile, ProfileInput, ProfileSummary, ServerInput};
use crate::secrets;

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

#[tauri::command]
pub fn list_profiles(db: State<'_, Database>) -> AppResult<Vec<ProfileSummary>> {
    db.list_profiles()
}

#[tauri::command]
pub fn get_profile(db: State<'_, Database>, id: i64) -> AppResult<Profile> {
    db.get_profile(id)
}

#[tauri::command]
pub fn create_profile(db: State<'_, Database>, input: ProfileInput) -> AppResult<i64> {
    db.create_profile(&input)
}

#[tauri::command]
pub fn update_profile(db: State<'_, Database>, id: i64, input: ProfileInput) -> AppResult<()> {
    db.update_profile(id, &input)
}

#[tauri::command]
pub fn delete_profile(db: State<'_, Database>, id: i64) -> AppResult<()> {
    for server_id in db.delete_profile(id)? {
        secrets::delete_password(server_id)?;
    }
    Ok(())
}

/// `password`: `None` conserva la guardada; una cadena vacía la elimina.
fn store_password(db: &Database, server_id: i64, password: Option<String>) -> AppResult<()> {
    match password.as_deref() {
        None => Ok(()),
        Some("") => {
            secrets::delete_password(server_id)?;
            db.set_server_has_password(server_id, false)
        }
        Some(password) => {
            secrets::set_password(server_id, password)?;
            db.set_server_has_password(server_id, true)
        }
    }
}

#[tauri::command]
pub fn create_server(
    db: State<'_, Database>,
    profile_id: i64,
    input: ServerInput,
    password: Option<String>,
) -> AppResult<i64> {
    let id = db.create_server(profile_id, &input)?;
    store_password(&db, id, password)?;
    Ok(id)
}

#[tauri::command]
pub fn update_server(
    db: State<'_, Database>,
    id: i64,
    input: ServerInput,
    password: Option<String>,
) -> AppResult<()> {
    db.update_server(id, &input)?;
    store_password(&db, id, password)
}

#[tauri::command]
pub fn delete_server(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.delete_server(id)?;
    secrets::delete_password(id)
}

#[tauri::command]
pub async fn test_server(db: State<'_, Database>, id: i64) -> AppResult<ConnectionTest> {
    let server = db.get_server(id)?;
    let credentials = match server.username {
        Some(username) => Some(Credentials {
            username,
            password: secrets::get_password(id)?.unwrap_or_default(),
        }),
        None => None,
    };
    // Las carpetas de red pueden tardar en responder; se hace fuera del hilo principal.
    let result = tauri::async_runtime::spawn_blocking(move || {
        net::test_connection(&server.share, credentials.as_ref())
    })
    .await?;
    Ok(result)
}

#[tauri::command]
pub fn add_exclusion(
    db: State<'_, Database>,
    profile_id: i64,
    server_id: Option<i64>,
    pattern: String,
) -> AppResult<i64> {
    db.add_exclusion(profile_id, server_id, &pattern)
}

#[tauri::command]
pub fn delete_exclusion(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.delete_exclusion(id)
}

/// Archivos de la publicación que captura `pattern` o, si no se indica, las
/// exclusiones guardadas que afectan a `server_id` (las comunes si es `None`).
#[tauri::command]
pub async fn preview_exclusions(
    db: State<'_, Database>,
    profile_id: i64,
    server_id: Option<i64>,
    pattern: Option<String>,
) -> AppResult<ExclusionPreview> {
    let source = PathBuf::from(db.get_profile(profile_id)?.source_path);
    let patterns = match pattern {
        Some(pattern) => vec![pattern],
        None => db.exclusion_patterns(profile_id, server_id)?,
    };
    tauri::async_runtime::spawn_blocking(move || exclusions::preview(&source, &patterns)).await?
}
