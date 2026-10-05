//! Comparación entre la carpeta de publicación y la carpeta de un servidor.
//!
//! Decide, archivo a archivo, qué haría un despliegue: copiarlo, sustituirlo,
//! borrarlo o dejarlo como está. No modifica nada.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;
use crate::exclusions::{list_files, ExclusionSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    /// Está en la publicación y no en el servidor: se copiará.
    New,
    /// Está en ambos con distinto contenido: se sustituirá.
    Modified,
    /// Solo está en el servidor: se borrará.
    Deleted,
    /// Coincide con una exclusión: no se toca.
    Excluded,
    /// Está en ambos con el mismo contenido: no se toca.
    Unchanged,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Ruta relativa separada por `/`.
    pub path: String,
    pub status: FileStatus,
    /// Tamaño en la publicación, si el archivo existe allí.
    pub source_size: Option<u64>,
    /// Tamaño en el servidor, si el archivo existe allí.
    pub target_size: Option<u64>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub new: usize,
    pub modified: usize,
    pub deleted: usize,
    pub excluded: usize,
    pub unchanged: usize,
    /// Bytes que habría que copiar (archivos nuevos y modificados).
    pub bytes_to_copy: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub entries: Vec<FileEntry>,
    pub counts: Counts,
}

/// Los nombres se emparejan sin distinguir mayúsculas, como en Windows.
fn index(root: &Path) -> AppResult<BTreeMap<String, String>> {
    Ok(list_files(root)?
        .into_iter()
        .map(|path| (path.to_lowercase(), path))
        .collect())
}

/// Convierte una ruta relativa separada por `/` en una ruta del sistema bajo `root`.
pub fn local_path(root: &Path, relative: &str) -> std::path::PathBuf {
    relative
        .split('/')
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

/// Compara el contenido byte a byte y se detiene en la primera diferencia.
pub fn same_content(first: &Path, second: &Path) -> AppResult<bool> {
    const BLOCK: usize = 64 * 1024;
    let mut first = File::open(first)?;
    let mut second = File::open(second)?;
    let mut first_block = vec![0u8; BLOCK];
    let mut second_block = vec![0u8; BLOCK];
    loop {
        let read = read_block(&mut first, &mut first_block)?;
        if read != read_block(&mut second, &mut second_block)? {
            return Ok(false);
        }
        if first_block[..read] != second_block[..read] {
            return Ok(false);
        }
        if read < BLOCK {
            return Ok(true);
        }
    }
}

/// Llena el bloque salvo que se acabe el archivo; devuelve los bytes leídos.
fn read_block(file: &mut File, block: &mut [u8]) -> AppResult<usize> {
    let mut filled = 0;
    while filled < block.len() {
        match file.read(&mut block[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(filled)
}

pub fn compare(source: &Path, target: &Path, exclusions: &ExclusionSet) -> AppResult<Comparison> {
    let source_files = index(source)?;
    let target_files = index(target)?;

    let mut keys: Vec<&String> = source_files.keys().chain(target_files.keys()).collect();
    keys.sort();
    keys.dedup();

    let mut entries = Vec::with_capacity(keys.len());
    let mut counts = Counts::default();
    for key in keys {
        let in_source = source_files.get(key);
        let in_target = target_files.get(key);
        let source_path = in_source.map(|path| local_path(source, path));
        let target_path = in_target.map(|path| local_path(target, path));
        let source_size = match &source_path {
            Some(path) => Some(path.metadata()?.len()),
            None => None,
        };
        let target_size = match &target_path {
            Some(path) => Some(path.metadata()?.len()),
            None => None,
        };
        // Se muestra el nombre de la publicación, que es el que se copiará.
        let path = in_source.or(in_target).cloned().unwrap_or_default();

        let status = if exclusions.is_excluded(&path) {
            FileStatus::Excluded
        } else {
            match (&source_path, &target_path) {
                (Some(_), None) => FileStatus::New,
                (None, _) => FileStatus::Deleted,
                (Some(source_path), Some(target_path)) => {
                    if source_size == target_size && same_content(source_path, target_path)? {
                        FileStatus::Unchanged
                    } else {
                        FileStatus::Modified
                    }
                }
            }
        };

        match status {
            FileStatus::New => counts.new += 1,
            FileStatus::Modified => counts.modified += 1,
            FileStatus::Deleted => counts.deleted += 1,
            FileStatus::Excluded => counts.excluded += 1,
            FileStatus::Unchanged => counts.unchanged += 1,
        }
        if matches!(status, FileStatus::New | FileStatus::Modified) {
            counts.bytes_to_copy += source_size.unwrap_or(0);
        }
        entries.push(FileEntry {
            path,
            status,
            source_size,
            target_size,
        });
    }

    Ok(Comparison { entries, counts })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = local_path(root, relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn status_of(comparison: &Comparison, path: &str) -> FileStatus {
        comparison
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .unwrap_or_else(|| panic!("falta {path}"))
            .status
    }

    #[test]
    fn classifies_every_kind_of_file() {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-compare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (source, target) = (root.join("publicacion"), root.join("servidor"));

        write(&source, "index.aspx", b"igual");
        write(&target, "index.aspx", b"igual");
        write(&source, "bin/erp.dll", b"version nueva");
        write(&target, "bin/erp.dll", b"version vieja");
        // Mismo tamaño y distinto contenido: solo se detecta leyendo el archivo.
        write(&source, "bin/util.dll", b"aaaa");
        write(&target, "bin/util.dll", b"aaab");
        write(&source, "bin/nuevo.dll", b"12345");
        write(&target, "bin/antiguo.dll", b"x");
        write(&source, "web.config", b"de desarrollo");
        write(&target, "web.config", b"del servidor");
        write(&target, "logs/app.log", b"solo en el servidor");
        // En el servidor el nombre tiene otras mayúsculas: es el mismo archivo.
        write(&source, "Scripts/App.js", b"js");
        write(&target, "scripts/app.js", b"js");

        let exclusions = ExclusionSet::new(&["web.config", "logs"]).unwrap();
        let comparison = compare(&source, &target, &exclusions).unwrap();

        assert_eq!(status_of(&comparison, "index.aspx"), FileStatus::Unchanged);
        assert_eq!(status_of(&comparison, "bin/erp.dll"), FileStatus::Modified);
        assert_eq!(status_of(&comparison, "bin/util.dll"), FileStatus::Modified);
        assert_eq!(status_of(&comparison, "bin/nuevo.dll"), FileStatus::New);
        assert_eq!(
            status_of(&comparison, "bin/antiguo.dll"),
            FileStatus::Deleted
        );
        assert_eq!(status_of(&comparison, "web.config"), FileStatus::Excluded);
        assert_eq!(status_of(&comparison, "logs/app.log"), FileStatus::Excluded);
        assert_eq!(
            status_of(&comparison, "Scripts/App.js"),
            FileStatus::Unchanged
        );

        let counts = &comparison.counts;
        assert_eq!(
            (
                counts.new,
                counts.modified,
                counts.deleted,
                counts.excluded,
                counts.unchanged
            ),
            (1, 2, 1, 2, 2)
        );
        assert_eq!(comparison.entries.len(), 8);
        // erp.dll (13) + util.dll (4) + nuevo.dll (5)
        assert_eq!(counts.bytes_to_copy, 22);

        // Sin exclusiones, web.config se sustituiría y el log se borraría.
        let none: [&str; 0] = [];
        let unprotected = compare(&source, &target, &ExclusionSet::new(&none).unwrap()).unwrap();
        assert_eq!(status_of(&unprotected, "web.config"), FileStatus::Modified);
        assert_eq!(status_of(&unprotected, "logs/app.log"), FileStatus::Deleted);

        assert!(compare(&source, &root.join("no-existe"), &exclusions).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compares_large_files_across_block_boundaries() {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-blocks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut content = vec![7u8; 200_000];
        write(&root, "a.bin", &content);
        write(&root, "b.bin", &content);
        content[199_999] = 8;
        write(&root, "c.bin", &content);

        assert!(same_content(&root.join("a.bin"), &root.join("b.bin")).unwrap());
        assert!(!same_content(&root.join("a.bin"), &root.join("c.bin")).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
