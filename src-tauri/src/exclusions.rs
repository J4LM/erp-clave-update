//! Patrones de exclusión: archivos que nunca se copian, se sobrescriben ni se
//! borran en un servidor.
//!
//! Los patrones siguen un subconjunto reducido de .gitignore:
//! - sin `/` coinciden con un nombre a cualquier profundidad (`web.config`, `*.log`);
//! - con `/` son relativos a la carpeta raíz (`App_Data/*.mdf`);
//! - si coinciden con una carpeta, excluyen todo su contenido (`logs`, `logs/**`).
//!
//! No se distinguen mayúsculas, igual que en los sistemas de archivos de Windows.

use std::path::Path;

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use rusqlite::{params, ErrorCode};
use serde::Serialize;
use walkdir::WalkDir;

use crate::db::Database;
use crate::error::{AppError, AppResult};

/// Limpia un patrón escrito por el usuario y comprueba que es válido.
pub fn normalize_pattern(input: &str) -> AppResult<String> {
    let mut pattern = input.trim().replace('\\', "/");
    while let Some(rest) = pattern.strip_prefix("./") {
        pattern = rest.to_string();
    }
    let pattern = pattern.trim_matches('/').to_string();
    if pattern.is_empty() {
        return Err(AppError::Message("El patrón es obligatorio".into()));
    }
    if pattern.split('/').any(|part| part == "..") {
        return Err(AppError::Message("El patrón no puede contener ..".into()));
    }
    build_glob(&pattern)?;
    Ok(pattern)
}

fn build_glob(pattern: &str) -> AppResult<globset::Glob> {
    let anchored = if pattern.contains('/') {
        pattern.to_string()
    } else {
        format!("**/{pattern}")
    };
    GlobBuilder::new(&anchored)
        .case_insensitive(true)
        .literal_separator(true)
        .build()
        .map_err(|error| AppError::Message(format!("Patrón no válido: {}", error.kind())))
}

pub struct ExclusionSet {
    globs: GlobSet,
}

impl ExclusionSet {
    pub fn new<S: AsRef<str>>(patterns: &[S]) -> AppResult<Self> {
        let mut builder = GlobSetBuilder::new();
        for pattern in patterns {
            builder.add(build_glob(&normalize_pattern(pattern.as_ref())?)?);
        }
        let globs = builder
            .build()
            .map_err(|error| AppError::Message(format!("Patrones no válidos: {error}")))?;
        Ok(Self { globs })
    }

    /// `relative_path` usa `/` como separador. Una ruta queda excluida si ella
    /// o alguna de sus carpetas superiores coincide con un patrón.
    pub fn is_excluded(&self, relative_path: &str) -> bool {
        if self.globs.is_empty() {
            return false;
        }
        relative_path
            .match_indices('/')
            .map(|(index, _)| &relative_path[..index])
            .chain(std::iter::once(relative_path))
            .any(|prefix| self.globs.is_match(prefix))
    }
}

/// Rutas relativas (separadas por `/`) de todos los archivos de `root`, ordenadas.
pub fn list_files(root: &Path) -> AppResult<Vec<String>> {
    if !root.is_dir() {
        return Err(AppError::Message(format!(
            "La carpeta {} no existe o no es accesible",
            root.display()
        )));
    }
    let mut files = Vec::new();
    for entry in WalkDir::new(root) {
        let entry = entry.map_err(|error| AppError::Message(error.to_string()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| AppError::Message(error.to_string()))?;
        let parts: Vec<_> = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect();
        files.push(parts.join("/"));
    }
    files.sort_by_key(|path| path.to_lowercase());
    Ok(files)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExclusionPreview {
    total_files: usize,
    matched_count: usize,
    /// Solo las primeras coincidencias; `matched_count` tiene el total real.
    matched: Vec<String>,
}

const PREVIEW_LIMIT: usize = 200;

pub fn preview<S: AsRef<str>>(root: &Path, patterns: &[S]) -> AppResult<ExclusionPreview> {
    let exclusions = ExclusionSet::new(patterns)?;
    let files = list_files(root)?;
    let total_files = files.len();
    let mut matched: Vec<String> = files
        .into_iter()
        .filter(|path| exclusions.is_excluded(path))
        .collect();
    let matched_count = matched.len();
    matched.truncate(PREVIEW_LIMIT);
    Ok(ExclusionPreview {
        total_files,
        matched_count,
        matched,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exclusion {
    id: i64,
    /// `None` se aplica a todos los servidores del perfil.
    server_id: Option<i64>,
    pattern: String,
}

impl Database {
    pub fn list_exclusions(&self, profile_id: i64) -> AppResult<Vec<Exclusion>> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "SELECT id, server_id, pattern FROM exclusions WHERE profile_id = ?1
             ORDER BY server_id IS NOT NULL, server_id, pattern COLLATE NOCASE",
        )?;
        let exclusions = statement
            .query_map([profile_id], |row| {
                Ok(Exclusion {
                    id: row.get(0)?,
                    server_id: row.get(1)?,
                    pattern: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(exclusions)
    }

    /// Patrones que afectan a un servidor: los del perfil más los suyos.
    /// Con `server_id` `None`, solo los comunes a todos los servidores.
    pub fn exclusion_patterns(
        &self,
        profile_id: i64,
        server_id: Option<i64>,
    ) -> AppResult<Vec<String>> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "SELECT pattern FROM exclusions
             WHERE profile_id = ?1 AND (server_id IS NULL OR server_id = ?2)",
        )?;
        let patterns = statement
            .query_map(params![profile_id, server_id], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(patterns)
    }

    pub fn add_exclusion(
        &self,
        profile_id: i64,
        server_id: Option<i64>,
        pattern: &str,
    ) -> AppResult<i64> {
        let pattern = normalize_pattern(pattern)?;
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO exclusions (profile_id, server_id, pattern) VALUES (?1, ?2, ?3)",
            params![profile_id, server_id, pattern],
        )
        .map_err(|error| match &error {
            rusqlite::Error::SqliteFailure(failure, _)
                if failure.code == ErrorCode::ConstraintViolation =>
            {
                AppError::Message("Ese patrón ya está en la lista".into())
            }
            _ => error.into(),
        })?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_exclusion(&self, id: i64) -> AppResult<()> {
        self.conn()?
            .execute("DELETE FROM exclusions WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn excluded(patterns: &[&str], path: &str) -> bool {
        ExclusionSet::new(patterns).unwrap().is_excluded(path)
    }

    #[test]
    fn name_patterns_match_at_any_depth_ignoring_case() {
        assert!(excluded(&["web.config"], "web.config"));
        assert!(excluded(&["web.config"], "Areas/Admin/Web.config"));
        assert!(!excluded(&["web.config"], "web.config.bak"));
        assert!(excluded(&["*.log"], "logs/2026/app.LOG"));
        assert!(!excluded(&["*.log"], "logs/app.log.txt"));
    }

    #[test]
    fn path_patterns_are_anchored_at_the_root() {
        assert!(excluded(&["App_Data/*.mdf"], "App_Data/erp.mdf"));
        assert!(!excluded(&["App_Data/*.mdf"], "sub/App_Data/erp.mdf"));
        assert!(!excluded(&["App_Data/*.mdf"], "App_Data/sub/erp.mdf"));
        assert!(excluded(&["App_Data/**/*.mdf"], "App_Data/sub/erp.mdf"));
    }

    #[test]
    fn folder_patterns_exclude_their_contents() {
        for pattern in ["logs", "logs/", "logs/**", r".\logs\"] {
            assert!(excluded(&[pattern], "logs/a/b.txt"), "{pattern}");
        }
        assert!(excluded(&["logs"], "bin/logs/b.txt"));
        assert!(!excluded(&["logs/**"], "bin/logs/b.txt"));
        assert!(!excluded(&["logs"], "logs.txt"));
    }

    #[test]
    fn empty_set_excludes_nothing_and_bad_patterns_are_rejected() {
        assert!(!excluded(&[], "web.config"));
        assert!(normalize_pattern("  ").is_err());
        assert!(normalize_pattern("../web.config").is_err());
        assert!(normalize_pattern("[abc").is_err());
        assert_eq!(
            normalize_pattern(r" \App_Data\*.mdf ").unwrap(),
            "App_Data/*.mdf"
        );
    }

    #[test]
    fn preview_counts_matches_in_a_real_folder() {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-excl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::fs::create_dir_all(root.join("Areas/Admin")).unwrap();
        for file in [
            "web.config",
            "index.aspx",
            "bin/erp.dll",
            "Areas/Admin/Web.config",
        ] {
            std::fs::write(root.join(file), b"x").unwrap();
        }

        assert_eq!(
            list_files(&root).unwrap(),
            [
                "Areas/Admin/Web.config",
                "bin/erp.dll",
                "index.aspx",
                "web.config"
            ]
        );
        let result = preview(&root, &["web.config"]).unwrap();
        assert_eq!(result.total_files, 4);
        assert_eq!(result.matched, ["Areas/Admin/Web.config", "web.config"]);
        assert!(preview(&root.join("nope"), &["x"]).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exclusions_are_stored_per_profile_and_server() {
        let dir =
            std::env::temp_dir().join(format!("erp-clave-update-excl-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = Database::open(&dir.join("test.db")).unwrap();
        let conn = db.conn().unwrap();
        conn.execute_batch(
            "INSERT INTO profiles (id, name, source_path) VALUES (1, 'ERP', '/x');
             INSERT INTO servers (id, profile_id, name, host, share, subpath)
             VALUES (10, 1, 'A', 'h', 's', ''), (11, 1, 'B', 'h', 's', '');",
        )
        .unwrap();
        drop(conn);

        db.add_exclusion(1, None, " Web.config ").unwrap();
        let own = db.add_exclusion(1, Some(10), "logs/").unwrap();
        // El mismo patrón con otras mayúsculas es un duplicado dentro de un ámbito...
        assert!(db.add_exclusion(1, None, "web.CONFIG").is_err());
        // ...pero se permite para un servidor concreto.
        db.add_exclusion(1, Some(11), "web.config").unwrap();

        assert_eq!(db.exclusion_patterns(1, None).unwrap(), ["Web.config"]);
        let mut for_a = db.exclusion_patterns(1, Some(10)).unwrap();
        for_a.sort();
        assert_eq!(for_a, ["Web.config", "logs"]);
        assert_eq!(db.list_exclusions(1).unwrap().len(), 3);

        db.delete_exclusion(own).unwrap();
        assert_eq!(db.exclusion_patterns(1, Some(10)).unwrap(), ["Web.config"]);

        // Al eliminar un servidor se eliminan sus exclusiones propias.
        db.delete_server(11).unwrap();
        assert_eq!(db.list_exclusions(1).unwrap().len(), 1);

        std::fs::remove_dir_all(dir).unwrap();
    }
}
