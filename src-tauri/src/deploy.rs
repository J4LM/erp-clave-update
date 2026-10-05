//! Despliegue: deja la carpeta del servidor igual que la publicación, salvo
//! los archivos excluidos.

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use crate::backup::remove_empty_parents;
use crate::compare::{compare, local_path, same_content, FileStatus};
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::exclusions::ExclusionSet;

/// Archivo que hace que IIS muestre una página de mantenimiento mientras exista.
pub const OFFLINE_FILE: &str = "app_offline.htm";

const OFFLINE_PAGE: &str = "<!doctype html>
<html lang=\"es\">
<head>
<meta charset=\"utf-8\">
<title>Aplicación en mantenimiento</title>
<style>
body { font-family: sans-serif; text-align: center; margin-top: 15vh; color: #333; }
</style>
</head>
<body>
<h1>Aplicación en mantenimiento</h1>
<p>Estamos instalando una actualización. Vuelve a intentarlo en unos minutos.</p>
</body>
</html>
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Connecting,
    Backup,
    Comparing,
    Copying,
    Deleting,
    Verifying,
    Restoring,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployProgress {
    pub phase: Phase,
    pub done: usize,
    pub total: usize,
    /// Archivo que se está procesando; vacío si la fase no va por archivos.
    pub path: String,
}

impl DeployProgress {
    pub fn phase(phase: Phase) -> Self {
        Self {
            phase,
            done: 0,
            total: 0,
            path: String::new(),
        }
    }
}

/// Avisa del avance de una fase como mucho unas diez veces por segundo, y
/// siempre al terminarla.
struct Reporter<'a> {
    callback: &'a dyn Fn(DeployProgress),
    phase: Phase,
    total: usize,
    last: Option<Instant>,
}

impl<'a> Reporter<'a> {
    fn start(callback: &'a dyn Fn(DeployProgress), phase: Phase, total: usize) -> Self {
        callback(DeployProgress {
            phase,
            done: 0,
            total,
            path: String::new(),
        });
        Self {
            callback,
            phase,
            total,
            last: None,
        }
    }

    fn report(&mut self, done: usize, path: &str) {
        let due = self
            .last
            .is_none_or(|last| last.elapsed() >= Duration::from_millis(100));
        if due || done == self.total {
            self.last = Some(Instant::now());
            (self.callback)(DeployProgress {
                phase: self.phase,
                done,
                total: self.total,
                path: path.to_string(),
            });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Added,
    Replaced,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub action: Action,
}

#[derive(Debug, Default)]
pub struct DeployStats {
    pub copied: usize,
    pub deleted: usize,
    pub bytes_copied: u64,
    pub files: Vec<ChangedFile>,
}

/// Windows no deja sobrescribir ni borrar un archivo de solo lectura.
fn make_writable(path: &Path) -> AppResult<()> {
    let metadata = path.metadata()?;
    let mut permissions = metadata.permissions();
    if permissions.readonly() {
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn with_path<T>(result: std::io::Result<T>, action: &str, path: &str) -> AppResult<T> {
    result.map_err(|error| AppError::Message(format!("No se pudo {action} {path}: {error}")))
}

/// Copia los archivos nuevos y modificados, borra los que sobran y comprueba
/// que lo copiado coincide con la publicación. Los excluidos no se tocan.
pub fn deploy(
    source: &Path,
    target: &Path,
    exclusions: &ExclusionSet,
    progress: &dyn Fn(DeployProgress),
) -> AppResult<DeployStats> {
    progress(DeployProgress::phase(Phase::Comparing));
    let comparison = compare(source, target, exclusions)?;
    // Una publicación vacía borraría la aplicación entera del servidor.
    if comparison
        .entries
        .iter()
        .all(|entry| entry.source_size.is_none())
    {
        return Err(AppError::Message(
            "La carpeta de publicación está vacía; no se despliega para no borrar el servidor"
                .into(),
        ));
    }

    let mut to_copy: Vec<_> = comparison
        .entries
        .iter()
        .filter(|entry| matches!(entry.status, FileStatus::New | FileStatus::Modified))
        .collect();
    // `bin` va al final: IIS reinicia la aplicación al cambiar sus archivos, y
    // así lo hace cuando el resto ya está en su sitio.
    to_copy.sort_by_key(|entry| entry.path.to_lowercase().starts_with("bin/"));
    let to_delete: Vec<_> = comparison
        .entries
        .iter()
        .filter(|entry| entry.status == FileStatus::Deleted)
        .collect();

    let mut stats = DeployStats::default();

    let mut reporter = Reporter::start(progress, Phase::Copying, to_copy.len());
    for (index, entry) in to_copy.iter().enumerate() {
        let destination = local_path(target, &entry.path);
        if let Some(dir) = destination.parent() {
            with_path(
                std::fs::create_dir_all(dir),
                "crear la carpeta de",
                &entry.path,
            )?;
        }
        if entry.status == FileStatus::Modified {
            make_writable(&destination)?;
        }
        let bytes = with_path(
            std::fs::copy(local_path(source, &entry.path), &destination),
            "copiar",
            &entry.path,
        )?;
        stats.copied += 1;
        stats.bytes_copied += bytes;
        stats.files.push(ChangedFile {
            path: entry.path.clone(),
            action: if entry.status == FileStatus::New {
                Action::Added
            } else {
                Action::Replaced
            },
        });
        reporter.report(index + 1, &entry.path);
    }

    let mut reporter = Reporter::start(progress, Phase::Deleting, to_delete.len());
    for (index, entry) in to_delete.iter().enumerate() {
        let path = local_path(target, &entry.path);
        make_writable(&path)?;
        with_path(std::fs::remove_file(&path), "borrar", &entry.path)?;
        remove_empty_parents(&path, target);
        stats.deleted += 1;
        stats.files.push(ChangedFile {
            path: entry.path.clone(),
            action: Action::Removed,
        });
        reporter.report(index + 1, &entry.path);
    }

    let mut reporter = Reporter::start(progress, Phase::Verifying, to_copy.len());
    for (index, entry) in to_copy.iter().enumerate() {
        let matches = same_content(
            &local_path(source, &entry.path),
            &local_path(target, &entry.path),
        )?;
        if !matches {
            return Err(AppError::Message(format!(
                "La copia de {} no coincide con la publicación",
                entry.path
            )));
        }
        reporter.report(index + 1, &entry.path);
    }

    Ok(stats)
}

/// Pone la página de mantenimiento. Devuelve `false` si ya había una, en cuyo
/// caso no es nuestra y no hay que quitarla al terminar.
pub fn put_offline_page(target: &Path) -> AppResult<bool> {
    let path = target.join(OFFLINE_FILE);
    if path.exists() {
        return Ok(false);
    }
    std::fs::write(path, OFFLINE_PAGE)?;
    Ok(true)
}

pub fn remove_offline_page(target: &Path) -> AppResult<()> {
    match std::fs::remove_file(target.join(OFFLINE_FILE)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeployStatus {
    /// Todo copiado y verificado.
    Ok,
    /// Falló y el servidor se dejó como estaba con el backup previo.
    Restored,
    /// Falló y el servidor puede haber quedado a medias.
    Failed,
}

impl DeployStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Restored => "restored",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "ok" => Self::Ok,
            "restored" => Self::Restored,
            _ => Self::Failed,
        }
    }
}

/// Qué operación cambió el servidor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Copia de la publicación al servidor.
    Deploy,
    /// Restauración manual de un backup; `copied` son los archivos restaurados.
    Restore,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Deploy => "deploy",
            Self::Restore => "restore",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "restore" => Self::Restore,
            _ => Self::Deploy,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub id: i64,
    pub kind: Kind,
    pub profile_name: String,
    pub server_name: String,
    /// Fechas UTC en formato `AAAA-MM-DD HH:MM:SS`.
    pub started_at: String,
    pub finished_at: String,
    pub status: DeployStatus,
    pub copied: i64,
    pub deleted: i64,
    pub bytes_copied: i64,
    /// Backup hecho justo antes, si se pidió y sigue existiendo.
    pub backup_id: Option<i64>,
    pub note: String,
    pub error: Option<String>,
    pub files: Vec<ChangedFile>,
}

pub struct NewDeployment<'a> {
    pub kind: Kind,
    pub profile_id: i64,
    pub server_id: i64,
    pub profile_name: &'a str,
    pub server_name: &'a str,
    pub started_at: &'a str,
    pub status: DeployStatus,
    pub stats: &'a DeployStats,
    pub backup_id: Option<i64>,
    pub note: &'a str,
    pub error: Option<&'a str>,
}

fn deployment_from_row(row: &Row<'_>) -> rusqlite::Result<Deployment> {
    let status: String = row.get("status")?;
    let files: String = row.get("files")?;
    let kind: String = row.get("kind")?;
    Ok(Deployment {
        id: row.get("id")?,
        kind: Kind::parse(&kind),
        profile_name: row.get("profile_name")?,
        server_name: row.get("server_name")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        status: DeployStatus::parse(&status),
        copied: row.get("copied")?,
        deleted: row.get("deleted")?,
        bytes_copied: row.get("bytes_copied")?,
        backup_id: row.get("backup_id")?,
        note: row.get("note")?,
        error: row.get("error")?,
        files: serde_json::from_str(&files).unwrap_or_default(),
    })
}

impl Database {
    /// Fecha y hora actuales en UTC, en el formato que usa la base de datos.
    pub fn now(&self) -> AppResult<String> {
        Ok(self
            .conn()?
            .query_row("SELECT datetime('now')", [], |row| row.get(0))?)
    }

    pub fn insert_deployment(&self, deployment: &NewDeployment<'_>) -> AppResult<Deployment> {
        let files = serde_json::to_string(&deployment.stats.files)
            .map_err(|error| AppError::Message(error.to_string()))?;
        let id = {
            let conn = self.conn()?;
            conn.execute(
                "INSERT INTO deployments (profile_id, server_id, profile_name, server_name,
                    started_at, status, copied, deleted, bytes_copied, backup_id, note, error, files,
                    kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    deployment.profile_id,
                    deployment.server_id,
                    deployment.profile_name,
                    deployment.server_name,
                    deployment.started_at,
                    deployment.status.as_str(),
                    deployment.stats.copied as i64,
                    deployment.stats.deleted as i64,
                    deployment.stats.bytes_copied as i64,
                    deployment.backup_id,
                    deployment.note.trim(),
                    deployment.error,
                    files,
                    deployment.kind.as_str(),
                ],
            )?;
            conn.last_insert_rowid()
        };
        let conn = self.conn()?;
        Ok(conn.query_row(
            "SELECT * FROM deployments WHERE id = ?1",
            [id],
            deployment_from_row,
        )?)
    }

    pub fn list_deployments(&self) -> AppResult<Vec<Deployment>> {
        let conn = self.conn()?;
        let mut statement =
            conn.prepare("SELECT * FROM deployments ORDER BY started_at DESC, id DESC")?;
        let deployments = statement
            .query_map([], deployment_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(deployments)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exclusions::list_files;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn write(root: &Path, relative: &str, content: &str) {
        let path = local_path(root, relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn read(root: &Path, relative: &str) -> String {
        std::fs::read_to_string(local_path(root, relative)).unwrap()
    }

    #[test]
    fn deploy_makes_the_server_match_the_publish_folder() {
        let root = temp_root("deploy");
        let (source, target) = (root.join("publicacion"), root.join("servidor"));
        write(&source, "index.aspx", "igual");
        write(&target, "index.aspx", "igual");
        write(&source, "bin/erp.dll", "nueva");
        write(&target, "bin/erp.dll", "vieja");
        write(&source, "Scripts/app.js", "js");
        write(&source, "web.config", "de desarrollo");
        write(&target, "web.config", "del servidor");
        write(&target, "viejo/sobra.aspx", "sobra");
        write(&target, "logs/app.log", "log");

        // Un archivo de solo lectura en el servidor no debe impedir sustituirlo.
        let readonly = local_path(&target, "bin/erp.dll");
        let mut permissions = readonly.metadata().unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&readonly, permissions).unwrap();

        let exclusions = ExclusionSet::new(&["web.config", "logs"]).unwrap();
        let phases = std::cell::RefCell::new(Vec::new());
        let stats = deploy(&source, &target, &exclusions, &|progress| {
            let mut phases = phases.borrow_mut();
            if phases.last() != Some(&progress.phase) {
                phases.push(progress.phase);
            }
        })
        .unwrap();

        assert_eq!(read(&target, "bin/erp.dll"), "nueva");
        assert_eq!(read(&target, "Scripts/app.js"), "js");
        assert!(!target.join("viejo").exists());
        assert_eq!(read(&target, "web.config"), "del servidor");
        assert_eq!(read(&target, "logs/app.log"), "log");
        assert_eq!((stats.copied, stats.deleted, stats.bytes_copied), (2, 1, 7));
        // `bin` se copia al final.
        assert_eq!(
            stats.files,
            [
                ChangedFile {
                    path: "Scripts/app.js".into(),
                    action: Action::Added
                },
                ChangedFile {
                    path: "bin/erp.dll".into(),
                    action: Action::Replaced
                },
                ChangedFile {
                    path: "viejo/sobra.aspx".into(),
                    action: Action::Removed
                },
            ]
        );
        assert_eq!(
            *phases.borrow(),
            [
                Phase::Comparing,
                Phase::Copying,
                Phase::Deleting,
                Phase::Verifying
            ]
        );

        // Repetirlo no cambia nada.
        let again = deploy(&source, &target, &exclusions, &|_| {}).unwrap();
        assert_eq!((again.copied, again.deleted), (0, 0));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_to_deploy_an_empty_publish_folder() {
        let root = temp_root("deploy-empty");
        let (source, target) = (root.join("publicacion"), root.join("servidor"));
        std::fs::create_dir_all(&source).unwrap();
        write(&target, "index.aspx", "en producción");

        let none: [&str; 0] = [];
        let result = deploy(
            &source,
            &target,
            &ExclusionSet::new(&none).unwrap(),
            &|_| {},
        );
        assert!(result.is_err());
        assert_eq!(read(&target, "index.aspx"), "en producción");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn offline_page_is_only_removed_if_we_put_it() {
        let root = temp_root("deploy-offline");
        std::fs::create_dir_all(&root).unwrap();

        assert!(put_offline_page(&root).unwrap());
        assert!(read(&root, OFFLINE_FILE).contains("mantenimiento"));
        // Ya existía: no es nuestra.
        assert!(!put_offline_page(&root).unwrap());
        remove_offline_page(&root).unwrap();
        remove_offline_page(&root).unwrap();
        assert!(list_files(&root).unwrap().is_empty());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deployments_are_recorded_with_their_files() {
        let root = temp_root("deploy-db");
        let db = Database::open(&root.join("test.db")).unwrap();
        db.conn()
            .unwrap()
            .execute_batch(
                "INSERT INTO profiles (id, name, source_path) VALUES (1, 'ERP', '/x');
                 INSERT INTO servers (id, profile_id, name, host, share, subpath)
                 VALUES (10, 1, 'Producción', 'h', 's', '');",
            )
            .unwrap();

        let stats = DeployStats {
            copied: 1,
            deleted: 0,
            bytes_copied: 5,
            files: vec![ChangedFile {
                path: "bin/erp.dll".into(),
                action: Action::Replaced,
            }],
        };
        let started = db.now().unwrap();
        let saved = db
            .insert_deployment(&NewDeployment {
                kind: Kind::Restore,
                profile_id: 1,
                server_id: 10,
                profile_name: "ERP",
                server_name: "Producción",
                started_at: &started,
                status: DeployStatus::Restored,
                stats: &stats,
                backup_id: None,
                note: " facturación ",
                error: Some("No se pudo copiar"),
            })
            .unwrap();

        assert_eq!(saved.status, DeployStatus::Restored);
        assert_eq!(saved.kind, Kind::Restore);
        assert_eq!(saved.note, "facturación");
        assert_eq!(saved.files, stats.files);
        assert_eq!(saved.error.as_deref(), Some("No se pudo copiar"));
        assert_eq!(db.list_deployments().unwrap().len(), 1);

        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }
}
