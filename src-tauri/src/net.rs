//! Direcciones de carpetas de red y conexión a ellas.
//!
//! Las direcciones se guardan sin depender del sistema (host, recurso, subruta).
//! Solo `connect` es específico de cada sistema; a partir de ahí todo trabaja
//! con una ruta normal.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareAddress {
    pub host: String,
    pub share: String,
    /// Carpeta dentro del recurso, separada por `/`, sin separadores al inicio ni al final.
    pub subpath: String,
}

pub struct Credentials {
    pub username: String,
    pub password: String,
}

impl ShareAddress {
    /// Acepta `\\host\recurso\dir`, `//host/recurso/dir` y `smb://host/recurso/dir`.
    pub fn parse(input: &str) -> AppResult<Self> {
        let trimmed = input.trim();
        let rest = trimmed
            .strip_prefix("smb://")
            .or_else(|| trimmed.strip_prefix("\\\\"))
            .or_else(|| trimmed.strip_prefix("//"))
            .ok_or_else(|| {
                AppError::Message(
                    "La dirección debe empezar por \\\\servidor\\recurso o smb://servidor/recurso"
                        .into(),
                )
            })?;

        let mut parts = rest
            .split(['\\', '/'])
            .map(str::trim)
            .filter(|part| !part.is_empty());
        let host = parts.next();
        let share = parts.next();
        let (Some(host), Some(share)) = (host, share) else {
            return Err(AppError::Message(
                "La dirección necesita servidor y recurso compartido".into(),
            ));
        };
        let subpath: Vec<&str> = parts.collect();
        if subpath.iter().any(|part| *part == "." || *part == "..") {
            return Err(AppError::Message(
                "La dirección no puede contener . ni ..".into(),
            ));
        }

        Ok(Self {
            host: host.to_string(),
            share: share.to_string(),
            subpath: subpath.join("/"),
        })
    }

    pub fn unc(&self) -> String {
        let mut unc = format!("\\\\{}\\{}", self.host, self.share);
        for part in self.subpath.split('/').filter(|part| !part.is_empty()) {
            unc.push('\\');
            unc.push_str(part);
        }
        unc
    }

    pub fn smb_url(&self) -> String {
        let mut url = format!("smb://{}/{}", self.host, self.share);
        if !self.subpath.is_empty() {
            url.push('/');
            url.push_str(&self.subpath);
        }
        url
    }

    /// La forma que los usuarios de este sistema esperan leer y escribir.
    pub fn display(&self) -> String {
        if cfg!(windows) {
            self.unc()
        } else {
            self.smb_url()
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub ok: bool,
    pub message: String,
    pub path: Option<String>,
}

/// Conecta al recurso si hace falta y comprueba que la carpeta existe y admite escritura.
pub fn test_connection(
    address: &ShareAddress,
    credentials: Option<&Credentials>,
) -> ConnectionTest {
    let path = match connect(address, credentials) {
        Ok(path) => path,
        Err(error) => {
            return ConnectionTest {
                ok: false,
                message: error.to_string(),
                path: None,
            }
        }
    };
    let shown = Some(path.display().to_string());
    match check_writable_dir(&path) {
        Ok(()) => ConnectionTest {
            ok: true,
            message: "Conexión correcta: la carpeta existe y se puede escribir en ella".into(),
            path: shown,
        },
        Err(error) => ConnectionTest {
            ok: false,
            message: error.to_string(),
            path: shown,
        },
    }
}

pub fn check_writable_dir(path: &Path) -> AppResult<()> {
    if !path.is_dir() {
        return Err(AppError::Message(format!(
            "La carpeta {} no existe o no es accesible",
            path.display()
        )));
    }
    let probe = path.join(format!(".erp-clave-update-{}.tmp", std::process::id()));
    std::fs::write(&probe, b"").map_err(|error| {
        AppError::Message(format!("No se puede escribir en la carpeta: {error}"))
    })?;
    std::fs::remove_file(&probe)?;
    Ok(())
}

/// Devuelve una ruta local por la que se puede leer y escribir en la carpeta del recurso.
#[cfg(windows)]
pub fn connect(address: &ShareAddress, credentials: Option<&Credentials>) -> AppResult<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Sin credenciales se usa tal cual la sesión actual de Windows.
    if let Some(credentials) = credentials {
        let share = format!("\\\\{}\\{}", address.host, address.share);
        let output = Command::new("net")
            .args(["use", share.as_str(), credentials.password.as_str()])
            .arg(format!("/user:{}", credentials.username))
            .arg("/persistent:no")
            .creation_flags(CREATE_NO_WINDOW)
            .output()?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::Message(format!(
                "No se pudo conectar a {share}: {detail}"
            )));
        }
    }
    Ok(PathBuf::from(address.unc()))
}

#[cfg(target_os = "macos")]
pub fn connect(address: &ShareAddress, credentials: Option<&Credentials>) -> AppResult<PathBuf> {
    let mount_point = match find_mount(address)? {
        Some(mount_point) => mount_point,
        None => {
            mount(address, credentials)?;
            find_mount(address)?.ok_or_else(|| {
                AppError::Message(format!(
                    "El recurso {} se montó pero no aparece entre los volúmenes",
                    address.smb_url()
                ))
            })?
        }
    };
    Ok(mount_point.join(&address.subpath))
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn connect(_address: &ShareAddress, _credentials: Option<&Credentials>) -> AppResult<PathBuf> {
    Err(AppError::Message(
        "Las carpetas de red solo están soportadas en Windows y macOS".into(),
    ))
}

#[cfg(target_os = "macos")]
fn mount(address: &ShareAddress, credentials: Option<&Credentials>) -> AppResult<()> {
    let url = format!("smb://{}/{}", address.host, address.share).replace(' ', "%20");
    let mut script = format!("mount volume {}", applescript_string(&url));
    if let Some(credentials) = credentials {
        script.push_str(&format!(
            " as user name {} with password {}",
            applescript_string(&credentials.username),
            applescript_string(&credentials.password)
        ));
    }
    let output = Command::new("osascript").args(["-e", &script]).output()?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(format!(
            "No se pudo conectar a {url}: {detail}"
        )));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "macos")]
fn find_mount(address: &ShareAddress) -> AppResult<Option<PathBuf>> {
    let output = Command::new("mount").output()?;
    Ok(parse_mount_output(
        &String::from_utf8_lossy(&output.stdout),
        address,
    ))
}

/// Busca el punto de montaje de un recurso en la salida de `mount`, cuyas líneas
/// smbfs tienen la forma `//usuario@host/recurso on /Volumes/recurso (smbfs, nodev, ...)`.
#[cfg(any(target_os = "macos", test))]
fn parse_mount_output(output: &str, address: &ShareAddress) -> Option<PathBuf> {
    output.lines().find_map(|line| {
        let (source, rest) = line.strip_prefix("//")?.split_once(" on ")?;
        let (mount_point, options) = rest.rsplit_once(" (")?;
        if !options.starts_with("smbfs") {
            return None;
        }
        let (server, share) = source.split_once('/')?;
        let host = server.rsplit_once('@').map_or(server, |(_, host)| host);
        let share = share.replace("%20", " ");
        (host.eq_ignore_ascii_case(&address.host) && share.eq_ignore_ascii_case(&address.share))
            .then(|| PathBuf::from(mount_point))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(host: &str, share: &str, subpath: &str) -> ShareAddress {
        ShareAddress {
            host: host.into(),
            share: share.into(),
            subpath: subpath.into(),
        }
    }

    #[test]
    fn parses_unc_smb_and_slash_forms() {
        let expected = address("srv01", "erp", "app/bin");
        assert_eq!(
            ShareAddress::parse(r"\\srv01\erp\app\bin").unwrap(),
            expected
        );
        assert_eq!(
            ShareAddress::parse("smb://srv01/erp/app/bin/").unwrap(),
            expected
        );
        assert_eq!(
            ShareAddress::parse("  //srv01/erp/app/bin ").unwrap(),
            expected
        );
        assert_eq!(
            ShareAddress::parse(r"\\srv01\erp").unwrap(),
            address("srv01", "erp", "")
        );
    }

    #[test]
    fn rejects_incomplete_or_unsafe_addresses() {
        assert!(ShareAddress::parse(r"C:\erp").is_err());
        assert!(ShareAddress::parse(r"\\srv01").is_err());
        assert!(ShareAddress::parse(r"\\srv01\erp\..\otro").is_err());
    }

    #[test]
    fn formats_unc_and_smb_url() {
        let full = address("srv01", "erp", "app/bin");
        assert_eq!(full.unc(), r"\\srv01\erp\app\bin");
        assert_eq!(full.smb_url(), "smb://srv01/erp/app/bin");
        assert_eq!(address("srv01", "erp", "").unc(), r"\\srv01\erp");
    }

    #[test]
    fn finds_mount_point_ignoring_user_and_case() {
        let output = "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n\
            //jalm@SRV01/Mi%20ERP on /Volumes/Mi ERP (smbfs, nodev, nosuid, mounted by jalm)\n\
            //guest:@otro/erp on /Volumes/erp (smbfs, nodev)\n";
        assert_eq!(
            parse_mount_output(output, &address("srv01", "mi erp", "")),
            Some(PathBuf::from("/Volumes/Mi ERP"))
        );
        assert_eq!(
            parse_mount_output(output, &address("srv01", "erp", "")),
            None
        );
    }

    #[test]
    fn writable_check_reports_missing_folder() {
        let dir = std::env::temp_dir().join(format!("erp-clave-update-net-{}", std::process::id()));
        assert!(check_writable_dir(&dir).is_err());
        std::fs::create_dir_all(&dir).unwrap();
        check_writable_dir(&dir).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
