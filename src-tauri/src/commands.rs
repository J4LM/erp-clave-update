use std::path::PathBuf;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::backup::{self, Backup, NewBackup, Progress, RestoreStats, BACKUP_DIR_SETTING};
use crate::compare::{self, Comparison};
use crate::db::Database;
use crate::error::AppResult;
use crate::exclusions::{self, ExclusionPreview, ExclusionSet};
use crate::net::{self, ConnectionTest, Credentials};
use crate::profiles::{Profile, ProfileInput, ProfileSummary, Server, ServerInput};
use crate::secrets;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    database_path: String,
    /// Carpeta de backups que se usa si no se ha configurado otra.
    default_backup_dir: String,
}

fn default_backup_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join("backups"))
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, db: State<'_, Database>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        database_path: db.path().display().to_string(),
        default_backup_dir: default_backup_dir(&app)?.display().to_string(),
    })
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

fn credentials_of(server: &Server) -> AppResult<Option<Credentials>> {
    match &server.username {
        Some(username) => Ok(Some(Credentials {
            username: username.clone(),
            password: secrets::get_password(server.id)?.unwrap_or_default(),
        })),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn test_server(db: State<'_, Database>, id: i64) -> AppResult<ConnectionTest> {
    let server = db.get_server(id)?;
    let credentials = credentials_of(&server)?;
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

/// Compara la publicación de un perfil con la carpeta de uno de sus servidores.
#[tauri::command]
pub async fn compare_server(
    db: State<'_, Database>,
    profile_id: i64,
    server_id: i64,
) -> AppResult<Comparison> {
    let source = PathBuf::from(db.get_profile(profile_id)?.source_path);
    let server = db.get_server(server_id)?;
    let credentials = credentials_of(&server)?;
    let exclusions = ExclusionSet::new(&db.exclusion_patterns(profile_id, Some(server_id))?)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = net::connect(&server.share, credentials.as_ref())?;
        compare::compare(&source, &target, &exclusions)
    })
    .await?
}

#[tauri::command]
pub fn list_backups(db: State<'_, Database>) -> AppResult<Vec<Backup>> {
    db.list_backups()
}

/// Comprime la carpeta del servidor. Con `include_excluded` falso se dejan
/// fuera los archivos que coinciden con las exclusiones.
#[tauri::command]
pub async fn create_backup(
    app: AppHandle,
    db: State<'_, Database>,
    server_id: i64,
    note: String,
    include_excluded: bool,
    on_progress: Channel<Progress>,
) -> AppResult<Backup> {
    let server = db.get_server(server_id)?;
    let profile_name = db.profile_name(server.profile_id)?;
    let credentials = credentials_of(&server)?;
    let patterns = if include_excluded {
        Vec::new()
    } else {
        db.exclusion_patterns(server.profile_id, Some(server_id))?
    };
    let skip = ExclusionSet::new(&patterns)?;
    let base = match db.get_setting(BACKUP_DIR_SETTING)? {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => default_backup_dir(&app)?,
    };
    let archive = db.new_backup_path(&base, &profile_name, &server.name)?;

    let share = server.share.clone();
    let archive_path = archive.clone();
    let stats = tauri::async_runtime::spawn_blocking(move || {
        let source = net::connect(&share, credentials.as_ref())?;
        backup::create_archive(&source, &archive_path, &skip, &|progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await??;

    let created = db.insert_backup(&NewBackup {
        profile_id: server.profile_id,
        server_id,
        profile_name: &profile_name,
        server_name: &server.name,
        file_path: &archive,
        stats: &stats,
        complete: include_excluded,
        note: &note,
    })?;
    db.apply_retention(server_id, db.backup_keep()?)?;
    Ok(created)
}

/// Restaura un backup en su servidor. Con `include_excluded` falso los
/// archivos excluidos del servidor no se sobrescriben ni se borran.
#[tauri::command]
pub async fn restore_backup(
    db: State<'_, Database>,
    id: i64,
    include_excluded: bool,
    on_progress: Channel<Progress>,
) -> AppResult<RestoreStats> {
    let backup = db.get_backup(id)?;
    let server_id = backup.server_id.ok_or_else(|| {
        crate::error::AppError::Message(
            "El servidor de este backup se eliminó; no hay dónde restaurarlo".into(),
        )
    })?;
    let server = db.get_server(server_id)?;
    let credentials = credentials_of(&server)?;
    // Un backup sin los archivos excluidos no puede reponerlos: restaurarlo sin
    // protección los borraría del servidor.
    let patterns = if include_excluded && backup.complete {
        Vec::new()
    } else {
        db.exclusion_patterns(server.profile_id, Some(server_id))?
    };
    let protect = ExclusionSet::new(&patterns)?;

    tauri::async_runtime::spawn_blocking(move || {
        let target = net::connect(&server.share, credentials.as_ref())?;
        backup::restore_archive(
            &PathBuf::from(backup.file_path),
            &target,
            &protect,
            &|progress| {
                let _ = on_progress.send(progress);
            },
        )
    })
    .await?
}

#[tauri::command]
pub fn delete_backup(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.delete_backup(id)
}
