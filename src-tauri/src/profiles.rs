use std::path::Path;

use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::exclusions::Exclusion;
use crate::net::ShareAddress;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    id: i64,
    name: String,
    source_path: String,
    source_exists: bool,
    server_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    id: i64,
    name: String,
    pub source_path: String,
    source_exists: bool,
    servers: Vec<Server>,
    exclusions: Vec<Exclusion>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: i64,
    pub profile_id: i64,
    pub name: String,
    /// Dirección en la forma del sistema actual (UNC o smb://).
    pub address: String,
    pub username: Option<String>,
    pub has_password: bool,
    #[serde(skip)]
    pub share: ShareAddress,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    name: String,
    source_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub name: String,
    pub address: String,
    pub username: Option<String>,
}

fn required(value: &str, field: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::Message(format!("{field} es obligatorio")));
    }
    Ok(value.to_string())
}

fn duplicate_name(error: rusqlite::Error, message: &str) -> AppError {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == ErrorCode::ConstraintViolation =>
        {
            AppError::Message(message.into())
        }
        _ => error.into(),
    }
}

fn not_found(what: &str) -> AppError {
    AppError::Message(format!("{what} ya no existe"))
}

fn server_from_row(row: &Row<'_>) -> rusqlite::Result<Server> {
    let share = ShareAddress {
        host: row.get("host")?,
        share: row.get("share")?,
        subpath: row.get("subpath")?,
    };
    Ok(Server {
        id: row.get("id")?,
        profile_id: row.get("profile_id")?,
        name: row.get("name")?,
        address: share.display(),
        username: row.get("username")?,
        has_password: row.get("has_password")?,
        share,
    })
}

fn servers_of(conn: &Connection, profile_id: i64) -> AppResult<Vec<Server>> {
    let mut statement =
        conn.prepare("SELECT * FROM servers WHERE profile_id = ?1 ORDER BY name COLLATE NOCASE")?;
    let servers = statement
        .query_map([profile_id], server_from_row)?
        .collect::<Result<_, _>>()?;
    Ok(servers)
}

impl Database {
    pub fn list_profiles(&self) -> AppResult<Vec<ProfileSummary>> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "SELECT p.id, p.name, p.source_path, COUNT(s.id)
             FROM profiles p LEFT JOIN servers s ON s.profile_id = p.id
             GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
        )?;
        let profiles = statement
            .query_map([], |row| {
                let source_path: String = row.get(2)?;
                Ok(ProfileSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    source_exists: Path::new(&source_path).is_dir(),
                    source_path,
                    server_count: row.get(3)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(profiles)
    }

    pub fn get_profile(&self, id: i64) -> AppResult<Profile> {
        let exclusions = self.list_exclusions(id)?;
        let conn = self.conn()?;
        let (name, source_path): (String, String) = conn
            .query_row(
                "SELECT name, source_path FROM profiles WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| not_found("El perfil"))?;
        Ok(Profile {
            id,
            name,
            source_exists: Path::new(&source_path).is_dir(),
            source_path,
            servers: servers_of(&conn, id)?,
            exclusions,
        })
    }

    pub fn create_profile(&self, input: &ProfileInput) -> AppResult<i64> {
        let name = required(&input.name, "El nombre")?;
        let source_path = required(&input.source_path, "La carpeta de publicación")?;
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO profiles (name, source_path) VALUES (?1, ?2)",
            [&name, &source_path],
        )
        .map_err(|error| duplicate_name(error, "Ya existe un perfil con ese nombre"))?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_profile(&self, id: i64, input: &ProfileInput) -> AppResult<()> {
        let name = required(&input.name, "El nombre")?;
        let source_path = required(&input.source_path, "La carpeta de publicación")?;
        let changed = self
            .conn()?
            .execute(
                "UPDATE profiles SET name = ?1, source_path = ?2 WHERE id = ?3",
                params![name, source_path, id],
            )
            .map_err(|error| duplicate_name(error, "Ya existe un perfil con ese nombre"))?;
        if changed == 0 {
            return Err(not_found("El perfil"));
        }
        Ok(())
    }

    /// Elimina el perfil y sus servidores, y devuelve los ids de los servidores eliminados.
    pub fn delete_profile(&self, id: i64) -> AppResult<Vec<i64>> {
        let conn = self.conn()?;
        let server_ids = servers_of(&conn, id)?.iter().map(|s| s.id).collect();
        conn.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
        Ok(server_ids)
    }

    pub fn get_server(&self, id: i64) -> AppResult<Server> {
        self.conn()?
            .query_row("SELECT * FROM servers WHERE id = ?1", [id], server_from_row)
            .optional()?
            .ok_or_else(|| not_found("El servidor"))
    }

    pub fn create_server(&self, profile_id: i64, input: &ServerInput) -> AppResult<i64> {
        let name = required(&input.name, "El nombre")?;
        let share = ShareAddress::parse(&input.address)?;
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO servers (profile_id, name, host, share, subpath, username)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                profile_id,
                name,
                share.host,
                share.share,
                share.subpath,
                clean_username(input)
            ],
        )
        .map_err(|error| {
            duplicate_name(error, "Este perfil ya tiene un servidor con ese nombre")
        })?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_server(&self, id: i64, input: &ServerInput) -> AppResult<()> {
        let name = required(&input.name, "El nombre")?;
        let share = ShareAddress::parse(&input.address)?;
        let changed = self
            .conn()?
            .execute(
                "UPDATE servers SET name = ?1, host = ?2, share = ?3, subpath = ?4, username = ?5
                 WHERE id = ?6",
                params![
                    name,
                    share.host,
                    share.share,
                    share.subpath,
                    clean_username(input),
                    id
                ],
            )
            .map_err(|error| {
                duplicate_name(error, "Este perfil ya tiene un servidor con ese nombre")
            })?;
        if changed == 0 {
            return Err(not_found("El servidor"));
        }
        Ok(())
    }

    pub fn set_server_has_password(&self, id: i64, has_password: bool) -> AppResult<()> {
        self.conn()?.execute(
            "UPDATE servers SET has_password = ?1 WHERE id = ?2",
            params![has_password, id],
        )?;
        Ok(())
    }

    pub fn delete_server(&self, id: i64) -> AppResult<()> {
        self.conn()?
            .execute("DELETE FROM servers WHERE id = ?1", [id])?;
        Ok(())
    }
}

fn clean_username(input: &ServerInput) -> Option<String> {
    input
        .username
        .as_deref()
        .map(str::trim)
        .filter(|username| !username.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(name: &str) -> (Database, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "erp-clave-update-profiles-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        (Database::open(&dir.join("test.db")).unwrap(), dir)
    }

    fn profile(name: &str, source_path: &str) -> ProfileInput {
        ProfileInput {
            name: name.into(),
            source_path: source_path.into(),
        }
    }

    fn server(name: &str, address: &str, username: Option<&str>) -> ServerInput {
        ServerInput {
            name: name.into(),
            address: address.into(),
            username: username.map(Into::into),
        }
    }

    #[test]
    fn profile_and_server_lifecycle() {
        let (db, dir) = open("lifecycle");
        let source = dir.display().to_string();

        let id = db.create_profile(&profile("  ERP  ", &source)).unwrap();
        assert!(db.create_profile(&profile("ERP", &source)).is_err());
        assert!(db.create_profile(&profile(" ", &source)).is_err());

        let first = db
            .create_server(
                id,
                &server("Producción", r"\\srv01\erp\app", Some(" DOM\\ana ")),
            )
            .unwrap();
        db.create_server(id, &server("Pruebas", "smb://srv02/erp", Some("  ")))
            .unwrap();
        assert!(db
            .create_server(id, &server("Pruebas", "smb://srv03/erp", None))
            .is_err());
        assert!(db
            .create_server(id, &server("Otro", r"C:\erp", None))
            .is_err());

        let loaded = db.get_profile(id).unwrap();
        assert_eq!(loaded.name, "ERP");
        assert!(loaded.source_exists);
        assert_eq!(loaded.servers.len(), 2);
        assert_eq!(loaded.servers[0].username.as_deref(), Some("DOM\\ana"));
        assert_eq!(loaded.servers[0].share.subpath, "app");
        assert_eq!(loaded.servers[1].username, None);

        db.update_server(first, &server("Producción", r"\\srv09\erp", None))
            .unwrap();
        db.set_server_has_password(first, true).unwrap();
        let updated = db.get_server(first).unwrap();
        assert_eq!(updated.share.host, "srv09");
        assert!(updated.has_password);

        db.update_profile(id, &profile("ERP 2", "/no/existe"))
            .unwrap();
        let summary = &db.list_profiles().unwrap()[0];
        assert_eq!(summary.name, "ERP 2");
        assert_eq!(summary.server_count, 2);
        assert!(!summary.source_exists);

        // Al eliminar el perfil se eliminan sus servidores por la clave foránea.
        assert_eq!(db.delete_profile(id).unwrap().len(), 2);
        assert!(db.get_server(first).is_err());
        assert!(db.list_profiles().unwrap().is_empty());

        // Windows no deja borrar la carpeta mientras la base de datos siga abierta.
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
