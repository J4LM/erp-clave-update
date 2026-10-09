//! Las contraseñas de los servidores y del servidor SQL se guardan en el almacén de credenciales
//! del sistema (Administrador de credenciales de Windows, Llavero de macOS),
//! nunca en la base de datos.

use keyring::Entry;

use crate::error::AppResult;

const SERVICE: &str = "erp-clave-update";

/// Cuenta bajo la que se guarda la contraseña del servidor SQL del panel.
const SQL_ACCOUNT: &str = "sql-panel";

fn entry(account: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, account)?)
}

fn set(account: &str, password: &str) -> AppResult<()> {
    Ok(entry(account)?.set_password(password)?)
}

fn get(account: &str) -> AppResult<Option<String>> {
    match entry(account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn delete(account: &str) -> AppResult<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn server_account(server_id: i64) -> String {
    format!("server-{server_id}")
}

pub fn set_password(server_id: i64, password: &str) -> AppResult<()> {
    set(&server_account(server_id), password)
}

pub fn get_password(server_id: i64) -> AppResult<Option<String>> {
    get(&server_account(server_id))
}

pub fn delete_password(server_id: i64) -> AppResult<()> {
    delete(&server_account(server_id))
}

pub fn set_sql_password(password: &str) -> AppResult<()> {
    set(SQL_ACCOUNT, password)
}

pub fn get_sql_password() -> AppResult<Option<String>> {
    get(SQL_ACCOUNT)
}

pub fn delete_sql_password() -> AppResult<()> {
    delete(SQL_ACCOUNT)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Usa el almacén de credenciales real del equipo, así que solo se ejecuta a petición.
    #[test]
    #[ignore]
    fn password_roundtrip() {
        let id = -424242;
        delete_password(id).unwrap();
        assert_eq!(get_password(id).unwrap(), None);
        set_password(id, "s3creto").unwrap();
        assert_eq!(get_password(id).unwrap().as_deref(), Some("s3creto"));
        delete_password(id).unwrap();
        assert_eq!(get_password(id).unwrap(), None);
    }
}
