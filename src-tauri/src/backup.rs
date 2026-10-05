//! Backups de la carpeta de un servidor en un archivo zip, y su restauración.

use std::collections::HashSet;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::compare::local_path;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::exclusions::{list_files, ExclusionSet};

pub const BACKUP_DIR_SETTING: &str = "backup_dir";
pub const BACKUP_KEEP_SETTING: &str = "backup_keep";
/// Backups que se conservan por servidor si no se ha configurado otra cosa.
pub const DEFAULT_KEEP: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    /// Archivo que se está procesando.
    pub path: String,
}

/// Avisa del progreso sin saturar la interfaz: como mucho unas diez veces por
/// segundo, y siempre al terminar.
struct Reporter<'a> {
    callback: &'a dyn Fn(Progress),
    total: usize,
    last: Option<Instant>,
}

impl<'a> Reporter<'a> {
    fn new(callback: &'a dyn Fn(Progress), total: usize) -> Self {
        Self {
            callback,
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
            (self.callback)(Progress {
                done,
                total: self.total,
                path: path.to_string(),
            });
        }
    }
}

fn zip_error(error: zip::result::ZipError) -> AppError {
    AppError::Message(format!("Error en el archivo zip: {error}"))
}

#[derive(Debug)]
pub struct ArchiveStats {
    pub file_count: u64,
    /// Suma de los tamaños originales.
    pub total_bytes: u64,
    /// Tamaño del zip resultante.
    pub archive_bytes: u64,
}

/// Comprime `source` en `archive`. Los archivos que coinciden con `skip` no se
/// incluyen. Si algo falla no queda ningún zip a medias.
pub fn create_archive(
    source: &Path,
    archive: &Path,
    skip: &ExclusionSet,
    progress: &dyn Fn(Progress),
) -> AppResult<ArchiveStats> {
    let files: Vec<String> = list_files(source)?
        .into_iter()
        .filter(|path| !skip.is_excluded(path))
        .collect();
    if let Some(dir) = archive.parent() {
        std::fs::create_dir_all(dir)?;
    }

    let partial = archive.with_extension("zip.partial");
    let result = write_archive(source, &partial, &files, progress);
    match result {
        Ok(total_bytes) => {
            std::fs::rename(&partial, archive)?;
            Ok(ArchiveStats {
                file_count: files.len() as u64,
                total_bytes,
                archive_bytes: archive.metadata()?.len(),
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&partial);
            Err(error)
        }
    }
}

fn write_archive(
    source: &Path,
    archive: &Path,
    files: &[String],
    progress: &dyn Fn(Progress),
) -> AppResult<u64> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let mut writer = ZipWriter::new(File::create(archive)?);
    let mut reporter = Reporter::new(progress, files.len());
    let mut total_bytes = 0;
    for (index, relative) in files.iter().enumerate() {
        writer
            .start_file(relative.as_str(), options)
            .map_err(zip_error)?;
        let mut file = File::open(local_path(source, relative))?;
        total_bytes += io::copy(&mut file, &mut writer)?;
        reporter.report(index + 1, relative);
    }
    writer.finish().map_err(zip_error)?;
    Ok(total_bytes)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStats {
    /// Archivos escritos desde el backup.
    pub restored: usize,
    /// Archivos borrados por no estar en el backup.
    pub deleted: usize,
    /// Archivos protegidos que se han dejado como estaban.
    pub protected: usize,
}

/// Deja `target` como estaba al hacer el backup: escribe los archivos del zip y
/// borra los que no están en él. Los que coinciden con `protect` no se tocan,
/// ni para escribirlos ni para borrarlos.
pub fn restore_archive(
    archive: &Path,
    target: &Path,
    protect: &ExclusionSet,
    progress: &dyn Fn(Progress),
) -> AppResult<RestoreStats> {
    if !target.is_dir() {
        return Err(AppError::Message(format!(
            "La carpeta {} no existe o no es accesible",
            target.display()
        )));
    }
    let mut zip = ZipArchive::new(File::open(archive)?).map_err(zip_error)?;
    let mut stats = RestoreStats {
        restored: 0,
        deleted: 0,
        protected: 0,
    };
    let mut in_backup = HashSet::new();
    let mut reporter = Reporter::new(progress, zip.len());

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(zip_error)?;
        if entry.is_dir() {
            continue;
        }
        // `enclosed_name` rechaza rutas que se saldrían de la carpeta de destino.
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            AppError::Message(format!("Ruta no válida en el backup: {}", entry.name()))
        })?;
        let relative = enclosed
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        in_backup.insert(relative.to_lowercase());

        if protect.is_excluded(&relative) {
            stats.protected += 1;
        } else {
            let destination = local_path(target, &relative);
            if let Some(dir) = destination.parent() {
                std::fs::create_dir_all(dir)?;
            }
            io::copy(&mut entry, &mut File::create(&destination)?)?;
            stats.restored += 1;
        }
        reporter.report(index + 1, &relative);
    }

    for relative in list_files(target)? {
        if in_backup.contains(&relative.to_lowercase()) {
            continue;
        }
        if protect.is_excluded(&relative) {
            stats.protected += 1;
            continue;
        }
        let path = local_path(target, &relative);
        std::fs::remove_file(&path)?;
        stats.deleted += 1;
        remove_empty_parents(&path, target);
    }
    Ok(stats)
}

/// Borra las carpetas que han quedado vacías, sin subir más allá de `root`.
pub fn remove_empty_parents(path: &Path, root: &Path) {
    let mut dir = path.parent();
    while let Some(current) = dir {
        // `remove_dir` falla si la carpeta no está vacía, y ahí se para.
        if current == root || std::fs::remove_dir(current).is_err() {
            break;
        }
        dir = current.parent();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: i64,
    /// `None` si el servidor se eliminó después; ya no se puede restaurar en él.
    pub server_id: Option<i64>,
    pub profile_name: String,
    pub server_name: String,
    /// Fecha UTC en formato `AAAA-MM-DD HH:MM:SS`.
    pub created_at: String,
    pub file_path: String,
    pub file_exists: bool,
    pub file_count: i64,
    pub total_bytes: i64,
    pub archive_bytes: i64,
    /// Si incluye también los archivos excluidos.
    pub complete: bool,
    pub note: String,
}

pub struct NewBackup<'a> {
    pub profile_id: i64,
    pub server_id: i64,
    pub profile_name: &'a str,
    pub server_name: &'a str,
    pub file_path: &'a Path,
    pub stats: &'a ArchiveStats,
    pub complete: bool,
    pub note: &'a str,
}

fn backup_from_row(row: &Row<'_>) -> rusqlite::Result<Backup> {
    let file_path: String = row.get("file_path")?;
    Ok(Backup {
        id: row.get("id")?,
        server_id: row.get("server_id")?,
        profile_name: row.get("profile_name")?,
        server_name: row.get("server_name")?,
        created_at: row.get("created_at")?,
        file_exists: Path::new(&file_path).is_file(),
        file_path,
        file_count: row.get("file_count")?,
        total_bytes: row.get("total_bytes")?,
        archive_bytes: row.get("archive_bytes")?,
        complete: row.get("complete")?,
        note: row.get("note")?,
    })
}

/// Deja solo letras, números, guiones y puntos, para usar un nombre en una ruta.
fn slug(name: &str) -> String {
    let slug: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if slug.is_empty() {
        "sin-nombre".into()
    } else {
        slug
    }
}

impl Database {
    /// Ruta para un backup nuevo: `<base>/<perfil>/<servidor>/<fecha>.zip`.
    pub fn new_backup_path(&self, base: &Path, profile: &str, server: &str) -> AppResult<PathBuf> {
        let stamp: String = self.conn()?.query_row(
            "SELECT strftime('%Y-%m-%d_%H-%M-%S', 'now', 'localtime')",
            [],
            |row| row.get(0),
        )?;
        let dir = base.join(slug(profile)).join(slug(server));
        let mut path = dir.join(format!("{stamp}.zip"));
        // Dos backups en el mismo segundo no deben pisarse.
        let mut attempt = 2;
        while path.exists() {
            path = dir.join(format!("{stamp}_{attempt}.zip"));
            attempt += 1;
        }
        Ok(path)
    }

    pub fn insert_backup(&self, backup: &NewBackup<'_>) -> AppResult<Backup> {
        let id = {
            let conn = self.conn()?;
            conn.execute(
                "INSERT INTO backups (profile_id, server_id, profile_name, server_name,
                    file_path, file_count, total_bytes, archive_bytes, complete, note)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    backup.profile_id,
                    backup.server_id,
                    backup.profile_name,
                    backup.server_name,
                    backup.file_path.display().to_string(),
                    backup.stats.file_count as i64,
                    backup.stats.total_bytes as i64,
                    backup.stats.archive_bytes as i64,
                    backup.complete,
                    backup.note.trim(),
                ],
            )?;
            conn.last_insert_rowid()
        };
        self.get_backup(id)
    }

    pub fn get_backup(&self, id: i64) -> AppResult<Backup> {
        self.conn()?
            .query_row("SELECT * FROM backups WHERE id = ?1", [id], backup_from_row)
            .optional()?
            .ok_or_else(|| AppError::Message("El backup ya no existe".into()))
    }

    pub fn list_backups(&self) -> AppResult<Vec<Backup>> {
        let conn = self.conn()?;
        let mut statement =
            conn.prepare("SELECT * FROM backups ORDER BY created_at DESC, id DESC")?;
        let backups = statement
            .query_map([], backup_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(backups)
    }

    /// Borra el registro y su archivo zip.
    pub fn delete_backup(&self, id: i64) -> AppResult<()> {
        let backup = self.get_backup(id)?;
        match std::fs::remove_file(&backup.file_path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        self.conn()?
            .execute("DELETE FROM backups WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Borra los backups más antiguos de un servidor hasta dejar `keep`.
    /// Con `keep` 0 se conservan todos. Devuelve cuántos ha borrado.
    pub fn apply_retention(&self, server_id: i64, keep: usize) -> AppResult<usize> {
        if keep == 0 {
            return Ok(0);
        }
        let old: Vec<i64> = {
            let conn = self.conn()?;
            let mut statement = conn.prepare(
                "SELECT id FROM backups WHERE server_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?2",
            )?;
            let ids = statement
                .query_map(params![server_id, keep as i64], |row| row.get(0))?
                .collect::<Result<_, _>>()?;
            ids
        };
        for id in &old {
            self.delete_backup(*id)?;
        }
        Ok(old.len())
    }

    pub fn backup_keep(&self) -> AppResult<usize> {
        Ok(self
            .get_setting(BACKUP_KEEP_SETTING)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_KEEP))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
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

    fn exclusions(patterns: &[&str]) -> ExclusionSet {
        ExclusionSet::new(patterns).unwrap()
    }

    #[test]
    fn restore_brings_the_folder_back_and_respects_protected_files() {
        let root = temp_root("backup-restore");
        let server = root.join("servidor");
        write(&server, "index.aspx", "original");
        write(&server, "bin/erp.dll", "dll original");
        write(&server, "web.config", "config original");
        write(&server, "logs/app.log", "log");

        let archive = root.join("backups/copia.zip");
        let stats = create_archive(&server, &archive, &exclusions(&[]), &|_| {}).unwrap();
        assert_eq!(stats.file_count, 4);
        assert_eq!(stats.total_bytes, 8 + 12 + 15 + 3);
        assert!(!archive.with_extension("zip.partial").exists());

        // Un despliegue cambia cosas, y alguien toca web.config en el servidor.
        write(&server, "index.aspx", "nuevo");
        write(&server, "nuevo/pagina.aspx", "sobra");
        std::fs::remove_file(server.join("bin/erp.dll")).unwrap();
        write(&server, "web.config", "config cambiada a mano");
        write(&server, "logs/hoy.log", "log posterior");

        let done = std::cell::Cell::new(0);
        let result = restore_archive(
            &archive,
            &server,
            &exclusions(&["web.config", "logs"]),
            &|progress| done.set(progress.done),
        )
        .unwrap();

        assert_eq!(read(&server, "index.aspx"), "original");
        assert_eq!(read(&server, "bin/erp.dll"), "dll original");
        assert!(!server.join("nuevo").exists(), "la carpeta vacía se borra");
        // Los archivos protegidos quedan como estaban en el servidor.
        assert_eq!(read(&server, "web.config"), "config cambiada a mano");
        assert_eq!(read(&server, "logs/hoy.log"), "log posterior");
        assert_eq!(
            (result.restored, result.deleted, result.protected),
            (2, 1, 3)
        );
        assert_eq!(done.get(), 4);

        // Sin protección, la restauración es exacta.
        restore_archive(&archive, &server, &exclusions(&[]), &|_| {}).unwrap();
        assert_eq!(read(&server, "web.config"), "config original");
        assert!(!server.join("logs/hoy.log").exists());
        assert_eq!(list_files(&server).unwrap().len(), 4);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_can_skip_excluded_files_and_fails_cleanly() {
        let root = temp_root("backup-skip");
        let server = root.join("servidor");
        write(&server, "index.aspx", "a");
        write(&server, "logs/app.log", "b");

        let archive = root.join("copia.zip");
        let stats = create_archive(&server, &archive, &exclusions(&["logs"]), &|_| {}).unwrap();
        assert_eq!(stats.file_count, 1);

        let missing = create_archive(
            &root.join("no-existe"),
            &root.join("x.zip"),
            &exclusions(&[]),
            &|_| {},
        );
        assert!(missing.is_err());
        assert!(!root.join("x.zip").exists());
        assert!(
            restore_archive(&archive, &root.join("no-existe"), &exclusions(&[]), &|_| {}).is_err()
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn records_and_retention() {
        let root = temp_root("backup-db");
        let db = Database::open(&root.join("test.db")).unwrap();
        db.conn()
            .unwrap()
            .execute_batch(
                "INSERT INTO profiles (id, name, source_path) VALUES (1, 'ERP', '/x');
                 INSERT INTO servers (id, profile_id, name, host, share, subpath)
                 VALUES (10, 1, 'Producción', 'h', 's', '');",
            )
            .unwrap();

        let stats = ArchiveStats {
            file_count: 3,
            total_bytes: 300,
            archive_bytes: 100,
        };
        let mut ids = Vec::new();
        for _ in 0..3 {
            let path = db
                .new_backup_path(&root.join("backups"), "ERP / Clave", "Producción")
                .unwrap();
            assert!(path.starts_with(root.join("backups/ERP___Clave/Producción")));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "zip").unwrap();
            let backup = db
                .insert_backup(&NewBackup {
                    profile_id: 1,
                    server_id: 10,
                    profile_name: "ERP",
                    server_name: "Producción",
                    file_path: &path,
                    stats: &stats,
                    complete: true,
                    note: "  antes de la 2.0 ",
                })
                .unwrap();
            assert_eq!(backup.note, "antes de la 2.0");
            assert!(backup.file_exists);
            ids.push((backup.id, path));
        }

        assert_eq!(db.apply_retention(10, 0).unwrap(), 0);
        assert_eq!(db.apply_retention(10, 2).unwrap(), 1);
        let left = db.list_backups().unwrap();
        assert_eq!(left.len(), 2);
        // Se borra el más antiguo, con su archivo.
        assert!(left.iter().all(|backup| backup.id != ids[0].0));
        assert!(!ids[0].1.exists());
        assert!(ids[2].1.exists());

        // Al eliminar el servidor el backup se conserva, pero sin destino.
        db.delete_server(10).unwrap();
        assert_eq!(db.list_backups().unwrap()[0].server_id, None);

        db.delete_backup(ids[2].0).unwrap();
        assert!(!ids[2].1.exists());
        assert!(db.get_backup(ids[2].0).is_err());

        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }
}
