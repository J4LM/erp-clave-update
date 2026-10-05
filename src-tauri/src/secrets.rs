//! Las contraseñas de los servidores se guardan en el almacén de credenciales
//! del sistema (Administrador de credenciales de Windows, Llavero de macOS),
//! nunca en la base de datos.

use keyring::Entry;

use crate::error::AppResult;

const SERVICE: &str = "erp-clave-update";

fn entry(server_id: i64) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, &format!("server-{server_id}"))?)
}

pub fn set_password(server_id: i64, password: &str) -> AppResult<()> {
    Ok(entry(server_id)?.set_password(password)?)
}

pub fn get_password(server_id: i64) -> AppResult<Option<String>> {
    match entry(server_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn delete_password(server_id: i64) -> AppResult<()> {
    match entry(server_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
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
