use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Error de base de datos: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Error de entrada/salida: {0}")]
    Io(#[from] std::io::Error),
    #[error("Error del almacén de credenciales: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Error de Tauri: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Message(String),
}

// Los comandos de Tauri necesitan un error serializable; el frontend recibe el mensaje.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
