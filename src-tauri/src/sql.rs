//! Actualización de las bases de datos de los clientes.
//!
//! La app no ejecuta los scripts directamente: copia los `.sql` a una carpeta
//! de red y llama al procedimiento del panel de administración, que los lanza
//! con `sqlcmd` en cada base de datos y devuelve un resultado por cada una.

use std::path::{Path, PathBuf};

use futures_util::TryStreamExt;
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tiberius::{AuthMethod, Client, Config, QueryItem, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::secrets;

const HOST_SETTING: &str = "sql_host";
const DATABASE_SETTING: &str = "sql_database";
const USERNAME_SETTING: &str = "sql_username";
const PROCEDURE_SETTING: &str = "sql_procedure";
const SCRIPTS_DIR_SETTING: &str = "sql_scripts_dir";

const DEFAULT_DATABASE: &str = "PanelAdministracion";
const DEFAULT_PROCEDURE: &str = "dbo.pEjecutarScriptDirectorio";

/// El procedimiento monta con el directorio un comando `DIR` en una variable
/// de 255 caracteres; una ruta más larga se truncaría sin avisar.
const MAX_DIRECTORY_LENGTH: usize = 230;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlConfig {
    /// `servidor`, `servidor,puerto` o `servidor\instancia`.
    pub host: String,
    /// Base de datos donde está el procedimiento.
    pub database: String,
    pub username: String,
    pub procedure: String,
    /// Carpeta de red donde se copian los scripts, accesible desde SQL Server.
    pub scripts_dir: String,
    #[serde(default, skip_deserializing)]
    pub has_password: bool,
}

impl SqlConfig {
    pub fn is_complete(&self) -> bool {
        !self.host.is_empty() && !self.username.is_empty() && !self.scripts_dir.is_empty()
    }
}

impl Database {
    pub fn sql_config(&self) -> AppResult<SqlConfig> {
        let get = |key: &str| self.get_setting(key).map(Option::unwrap_or_default);
        let or_default = |value: String, default: &str| {
            if value.is_empty() {
                default.to_string()
            } else {
                value
            }
        };
        Ok(SqlConfig {
            host: get(HOST_SETTING)?,
            database: or_default(get(DATABASE_SETTING)?, DEFAULT_DATABASE),
            username: get(USERNAME_SETTING)?,
            procedure: or_default(get(PROCEDURE_SETTING)?, DEFAULT_PROCEDURE),
            scripts_dir: get(SCRIPTS_DIR_SETTING)?,
            has_password: secrets::get_sql_password()?.is_some(),
        })
    }

    /// Fecha y hora locales para nombrar la carpeta de una ejecución.
    pub fn local_stamp(&self) -> AppResult<String> {
        Ok(self.conn()?.query_row(
            "SELECT strftime('%Y-%m-%d_%H-%M-%S', 'now', 'localtime')",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn save_sql_config(&self, config: &SqlConfig) -> AppResult<()> {
        validate_procedure(config.procedure.trim())?;
        self.set_setting(HOST_SETTING, config.host.trim())?;
        self.set_setting(DATABASE_SETTING, config.database.trim())?;
        self.set_setting(USERNAME_SETTING, config.username.trim())?;
        self.set_setting(PROCEDURE_SETTING, config.procedure.trim())?;
        self.set_setting(SCRIPTS_DIR_SETTING, config.scripts_dir.trim())?;
        Ok(())
    }
}

/// El nombre del procedimiento se inserta en la sentencia, así que solo se
/// admite lo que puede formar parte de un nombre: `esquema.nombre`, con o sin
/// corchetes.
fn validate_procedure(name: &str) -> AppResult<()> {
    let valid = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '[' | ']'));
    if valid {
        Ok(())
    } else {
        Err(AppError::Message(
            "El nombre del procedimiento solo puede tener letras, números, puntos, guiones bajos y corchetes".into(),
        ))
    }
}

fn sql_error(error: tiberius::error::Error) -> AppError {
    AppError::Message(format!("Error de SQL Server: {error}"))
}

/// Separa `servidor`, `servidor,puerto` y `servidor\instancia`.
fn parse_host(host: &str) -> AppResult<(String, Option<u16>, Option<String>)> {
    let host = host.trim();
    if let Some((server, instance)) = host.split_once('\\') {
        return Ok((server.trim().into(), None, Some(instance.trim().into())));
    }
    if let Some((server, port)) = host.split_once(',') {
        let port = port
            .trim()
            .parse()
            .map_err(|_| AppError::Message(format!("El puerto «{}» no es válido", port.trim())))?;
        return Ok((server.trim().into(), Some(port), None));
    }
    Ok((host.into(), None, None))
}

type SqlClient = Client<Compat<TcpStream>>;

pub async fn connect(config: &SqlConfig, password: &str) -> AppResult<SqlClient> {
    let (server, port, instance) = parse_host(&config.host)?;
    if server.is_empty() {
        return Err(AppError::Message("Falta el servidor de SQL".into()));
    }
    let mut options = Config::new();
    options.host(&server);
    if let Some(port) = port {
        options.port(port);
    }
    if let Some(instance) = instance {
        options.instance_name(instance);
    }
    options.database(&config.database);
    options.authentication(AuthMethod::sql_server(&config.username, password));
    // Los servidores internos suelen usar un certificado propio.
    options.trust_cert();

    let tcp = TcpStream::connect_named(&options)
        .await
        .map_err(sql_error)?;
    tcp.set_nodelay(true)?;
    Client::connect(options, tcp.compat_write())
        .await
        .map_err(sql_error)
}

/// Comprueba la conexión y que el procedimiento existe. Devuelve la versión
/// del servidor.
pub async fn test_connection(config: &SqlConfig, password: &str) -> AppResult<String> {
    let mut client = connect(config, password).await?;
    let row = client
        .query(
            "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)), OBJECT_ID(@P1)",
            &[&config.procedure.as_str()],
        )
        .await
        .map_err(sql_error)?
        .into_row()
        .await
        .map_err(sql_error)?
        .ok_or_else(|| AppError::Message("El servidor no devolvió ninguna respuesta".into()))?;
    let version: &str = row.get(0).unwrap_or("desconocida");
    let procedure: Option<i32> = row.get(1);
    if procedure.is_none() {
        return Err(AppError::Message(format!(
            "La conexión funciona, pero no existe el procedimiento {} en la base de datos {}",
            config.procedure, config.database
        )));
    }
    Ok(format!("SQL Server {version}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpDatabase {
    pub name: String,
    /// Servidor de SQL donde está la base de datos.
    pub server: String,
}

/// Bases de datos del ERP registradas en el panel, las mismas que recorre el
/// procedimiento.
pub async fn list_databases(config: &SqlConfig, password: &str) -> AppResult<Vec<ErpDatabase>> {
    let mut client = connect(config, password).await?;
    let rows = client
        .query(
            "SELECT DISTINCT bd.Nombre, CAST(s.DireccionIP AS nvarchar(255))
             FROM BasesDatos bd
                 INNER JOIN ServidoresSQL s ON bd.IdServidor = s.Id
                 INNER JOIN EmpresasERP e ON bd.Id = e.IdBaseDatos
             ORDER BY bd.Nombre",
            &[],
        )
        .await
        .map_err(sql_error)?
        .into_first_result()
        .await
        .map_err(sql_error)?;
    Ok(rows
        .iter()
        .map(|row| ErpDatabase {
            name: row.get::<&str, _>(0).unwrap_or_default().to_string(),
            server: row.get::<&str, _>(1).unwrap_or_default().to_string(),
        })
        .collect())
}

/// Copia los scripts a `folder`, que debe ser una carpeta nueva: el
/// procedimiento ejecuta todos los `.sql` que encuentre en ella.
pub fn copy_scripts(files: &[PathBuf], folder: &Path) -> AppResult<Vec<String>> {
    if files.is_empty() {
        return Err(AppError::Message("No se ha elegido ningún script".into()));
    }
    let mut names = Vec::new();
    for file in files {
        let name = file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !name.to_lowercase().ends_with(".sql") {
            return Err(AppError::Message(format!("{name} no es un archivo .sql")));
        }
        // El procedimiento pone el nombre entre comillas en una línea de comandos.
        if name.contains('"') || name.contains('%') {
            return Err(AppError::Message(format!(
                "El nombre {name} contiene caracteres no admitidos (\" o %)"
            )));
        }
        if names
            .iter()
            .any(|other: &String| other.eq_ignore_ascii_case(&name))
        {
            return Err(AppError::Message(format!(
                "Hay dos scripts con el mismo nombre: {name}"
            )));
        }
        if !file.is_file() {
            return Err(AppError::Message(format!(
                "No se encuentra el script {}",
                file.display()
            )));
        }
        names.push(name);
    }

    std::fs::create_dir_all(folder)?;
    for (file, name) in files.iter().zip(&names) {
        std::fs::copy(file, folder.join(name)).map_err(|error| {
            AppError::Message(format!(
                "No se pudo copiar {name} a la carpeta de scripts: {error}"
            ))
        })?;
    }
    Ok(names)
}

pub fn check_directory_length(directory: &str) -> AppResult<()> {
    if directory.chars().count() > MAX_DIRECTORY_LENGTH {
        return Err(AppError::Message(format!(
            "La ruta de la carpeta de scripts es demasiado larga para el procedimiento ({} caracteres, máximo {MAX_DIRECTORY_LENGTH})",
            directory.chars().count()
        )));
    }
    Ok(())
}

/// Resultado de un script en una base de datos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub database: String,
    /// Nombre del archivo, sin la carpeta.
    pub script: String,
    pub ok: bool,
    /// Primera línea de error encontrada en la salida.
    pub error: Option<String>,
    /// Salida completa de `sqlcmd`.
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum RunEvent {
    /// El procedimiento ha listado lo que va a ejecutar.
    Started {
        total: usize,
    },
    Result {
        result: ScriptResult,
    },
}

/// Busca en la salida de `sqlcmd` la primera línea que indica un fallo.
///
/// El procedimiento no devuelve si el script terminó bien, solo el texto que
/// escribió `sqlcmd`, que incluye los `PRINT` del propio script. Un error de
/// SQL Server aparece como `Msg 208, Level 16, State 1...` (o su traducción),
/// y es error a partir del nivel 11.
pub fn find_error(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| is_error_line(line))
        .map(str::to_string)
}

fn is_error_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    if let Some(severity) = message_severity(&lower) {
        return severity >= 11;
    }
    const MARKERS: &[&str] = &[
        "sqlcmd: error",
        "hresult 0x",
        "login failed",
        "error de inicio de sesión",
        "is not recognized as an internal or external command",
        "no se reconoce como un comando interno o externo",
        "the system cannot find",
        "el sistema no puede encontrar",
        "access is denied",
        "acceso denegado",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker))
}

/// Nivel de una cabecera de mensaje de SQL Server, en inglés o en español:
/// `msg 208, level 16, ...`, `mens. 208, nivel 16, ...`, `mensaje 208, nivel 16, ...`.
fn message_severity(lower_line: &str) -> Option<u32> {
    let rest = ["msg ", "mens. ", "mens ", "mensaje "]
        .iter()
        .find_map(|prefix| lower_line.strip_prefix(prefix))?;
    let (number, rest) = rest.split_once(',')?;
    number.trim().parse::<u32>().ok()?;
    let rest = rest.trim_start();
    let rest = ["level ", "nivel "]
        .iter()
        .find_map(|prefix| rest.strip_prefix(prefix))?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// El procedimiento devuelve la ruta completa del script; se muestra solo el nombre.
fn script_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

pub fn script_result(database: &str, script_path: &str, output: &str) -> ScriptResult {
    let error = find_error(output);
    ScriptResult {
        database: database.to_string(),
        script: script_name(script_path),
        ok: error.is_none(),
        error,
        output: output.to_string(),
    }
}

/// Llama al procedimiento y va avisando de cada resultado según llega.
/// `database` limita la ejecución a una base de datos; sin él son todas.
pub async fn run_procedure(
    config: &SqlConfig,
    password: &str,
    directory: &str,
    database: Option<&str>,
    on_event: &(dyn Fn(RunEvent) + Send + Sync),
) -> AppResult<Vec<ScriptResult>> {
    validate_procedure(&config.procedure)?;
    check_directory_length(directory)?;
    let mut client = connect(config, password).await?;
    let statement = format!(
        "EXEC {} @Directorio = @P1, @BaseDatos = @P2",
        config.procedure
    );
    let mut stream = client
        .query(statement, &[&directory, &database])
        .await
        .map_err(sql_error)?;

    // El procedimiento devuelve tres tipos de resultado, que se distinguen por
    // sus columnas: los archivos encontrados, la lista de lo que va a ejecutar
    // (una fila por base de datos y archivo) y un resultado por cada ejecución.
    #[derive(PartialEq)]
    enum Section {
        Other,
        Plan,
        Result,
    }
    let mut section = Section::Other;
    let mut planned = 0;
    let mut started = false;
    let mut results = Vec::new();

    while let Some(item) = stream.try_next().await.map_err(sql_error)? {
        match item {
            QueryItem::Metadata(metadata) => {
                let has = |name: &str| {
                    metadata
                        .columns()
                        .iter()
                        .any(|column| column.name().eq_ignore_ascii_case(name))
                };
                section = if has("BaseDatos") && has("Resultado") {
                    Section::Result
                } else if has("Nombre") && has("Archivo") {
                    Section::Plan
                } else {
                    Section::Other
                };
                if section == Section::Result && !started {
                    started = true;
                    on_event(RunEvent::Started { total: planned });
                }
            }
            // De la lista solo se cuentan las filas: lleva las contraseñas de
            // los servidores y no debe salir de aquí.
            QueryItem::Row(_) if section == Section::Plan => planned += 1,
            QueryItem::Row(row) if section == Section::Result => {
                let database: &str = row.get("BaseDatos").unwrap_or_default();
                let script: &str = row.get("Script").unwrap_or_default();
                let output: &str = row.get("Resultado").unwrap_or_default();
                let result = script_result(database, script, output);
                on_event(RunEvent::Result {
                    result: result.clone(),
                });
                results.push(result);
            }
            QueryItem::Row(_) => {}
        }
    }

    if results.is_empty() {
        return Err(AppError::Message(if planned == 0 {
            "El procedimiento no ha ejecutado nada: no encontró scripts en la carpeta o ninguna base de datos coincide".into()
        } else {
            "El procedimiento terminó sin devolver resultados".into()
        }));
    }
    Ok(results)
}

/// Ejecución de scripts guardada en el historial.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRunRecord {
    pub id: i64,
    /// Fechas UTC en formato `AAAA-MM-DD HH:MM:SS`.
    pub started_at: String,
    pub finished_at: String,
    /// Carpeta de red a la que se copiaron los scripts.
    pub directory: String,
    pub files: Vec<String>,
    /// Base de datos elegida; `None` si fueron todas o es un reintento.
    pub target: Option<String>,
    /// Ejecución cuyas bases de datos fallidas se reintentaron en esta.
    pub retry_of: Option<i64>,
    /// `false` si se interrumpió antes de terminar (por ejemplo, se cortó la
    /// conexión); los fallos de cada base de datos van en `results`.
    pub completed: bool,
    pub error: Option<String>,
    /// La salida de `sqlcmd` solo se conserva en los resultados con error.
    pub results: Vec<ScriptResult>,
}

pub struct NewScriptRun<'a> {
    pub started_at: &'a str,
    pub directory: &'a str,
    pub files: &'a [String],
    pub target: Option<&'a str>,
    pub retry_of: Option<i64>,
    pub error: Option<&'a str>,
    pub results: &'a [ScriptResult],
}

fn script_run_from_row(row: &Row<'_>) -> rusqlite::Result<ScriptRunRecord> {
    let files: String = row.get("files")?;
    let results: String = row.get("results")?;
    let status: String = row.get("status")?;
    Ok(ScriptRunRecord {
        id: row.get("id")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        directory: row.get("directory")?,
        files: serde_json::from_str(&files).unwrap_or_default(),
        target: row.get("target")?,
        retry_of: row.get("retry_of")?,
        completed: status == "done",
        error: row.get("error")?,
        results: serde_json::from_str(&results).unwrap_or_default(),
    })
}

impl Database {
    pub fn insert_script_run(&self, run: &NewScriptRun<'_>) -> AppResult<ScriptRunRecord> {
        // La salida de las ejecuciones correctas son los PRINT del script,
        // repetidos en cada base de datos; guardarla llenaría la base de datos
        // local sin aportar nada.
        let stored: Vec<ScriptResult> = run
            .results
            .iter()
            .map(|result| ScriptResult {
                output: if result.ok {
                    String::new()
                } else {
                    result.output.clone()
                },
                ..result.clone()
            })
            .collect();
        let files = to_json(run.files)?;
        let results = to_json(&stored)?;
        let id = {
            let conn = self.conn()?;
            conn.execute(
                "INSERT INTO script_runs (started_at, directory, files, target, retry_of,
                    status, error, results)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    run.started_at,
                    run.directory,
                    files,
                    run.target,
                    run.retry_of,
                    if run.error.is_none() {
                        "done"
                    } else {
                        "failed"
                    },
                    run.error,
                    results,
                ],
            )?;
            conn.last_insert_rowid()
        };
        self.get_script_run(id)
    }

    pub fn get_script_run(&self, id: i64) -> AppResult<ScriptRunRecord> {
        self.conn()?
            .query_row(
                "SELECT * FROM script_runs WHERE id = ?1",
                [id],
                script_run_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::Message("La ejecución ya no existe".into()))
    }

    pub fn list_script_runs(&self) -> AppResult<Vec<ScriptRunRecord>> {
        let conn = self.conn()?;
        let mut statement =
            conn.prepare("SELECT * FROM script_runs ORDER BY started_at DESC, id DESC")?;
        let runs = statement
            .query_map([], script_run_from_row)?
            .collect::<Result<_, _>>()?;
        Ok(runs)
    }
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| AppError::Message(error.to_string()))
}

/// Bases de datos distintas con algún resultado fallido, en orden.
pub fn failed_databases(results: &[ScriptResult]) -> Vec<String> {
    let mut databases: Vec<String> = Vec::new();
    for result in results.iter().filter(|result| !result.ok) {
        if !databases.contains(&result.database) {
            databases.push(result.database.clone());
        }
    }
    databases
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_sql_errors_but_not_prints_or_warnings() {
        let clean = "Quitando Restricción DEFAULT [dbo].[DF_Articulos_CapacidadEnvase]...\n\
            Actualización completada.\n\
            Msg 5701, Level 0, State 1, Server SRV, Line 1\n\
            Se cambió el contexto de la base de datos";
        assert_eq!(find_error(clean), None);
        assert_eq!(find_error("Completado"), None);

        let english = "Quitando Clave externa...\n\
            Msg 3728, Level 16, State 1, Server SRV01, Line 2\n\
            'DF_X' is not a constraint.";
        assert_eq!(
            find_error(english).as_deref(),
            Some("Msg 3728, Level 16, State 1, Server SRV01, Line 2")
        );
        assert!(find_error("Mens. 208, Nivel 16, Estado 1, Servidor SRV, Línea 4\nEl nombre de objeto no es válido").is_some());
        assert!(find_error("Mensaje 2714, nivel 16, estado 6, servidor SRV, línea 3").is_some());
        // Nivel 10 o menor es informativo.
        assert_eq!(
            find_error("Mens. 15477, Nivel 10, Estado 1, Servidor SRV"),
            None
        );
    }

    #[test]
    fn detects_sqlcmd_and_shell_failures() {
        for output in [
            "Sqlcmd: Error: Microsoft ODBC Driver 17 for SQL Server : Login timeout expired.",
            "Sqlcmd: Error: Controlador ODBC: Error de inicio de sesión del usuario 'erp'.",
            "'sqlcmd' is not recognized as an internal or external command,",
            "\"sqlcmd\" no se reconoce como un comando interno o externo,",
            "El sistema no puede encontrar la ruta especificada.",
            "HResult 0x2, Level 16, State 1",
        ] {
            assert!(find_error(output).is_some(), "{output}");
        }
    }

    #[test]
    fn builds_results_with_the_script_name_only() {
        let ok = script_result(
            "Cliente01",
            r"\\Produccion\C\Script\2026-10-09\cambios.sql",
            "Completado",
        );
        assert_eq!(
            (ok.script.as_str(), ok.ok, &ok.error),
            ("cambios.sql", true, &None)
        );

        let failed = script_result(
            "Cliente02",
            "cambios.sql",
            "PRINT\nMsg 208, Level 16, State 1",
        );
        assert!(!failed.ok);
        assert_eq!(failed.error.as_deref(), Some("Msg 208, Level 16, State 1"));
        assert_eq!(failed.output, "PRINT\nMsg 208, Level 16, State 1");
    }

    #[test]
    fn parses_host_forms_and_validates_names() {
        assert_eq!(parse_host(" srv01 ").unwrap(), ("srv01".into(), None, None));
        assert_eq!(
            parse_host("10.0.0.5,1444").unwrap(),
            ("10.0.0.5".into(), Some(1444), None)
        );
        assert_eq!(
            parse_host(r"srv01\SQLEXPRESS").unwrap(),
            ("srv01".into(), None, Some("SQLEXPRESS".into()))
        );
        assert!(parse_host("srv01,abc").is_err());

        assert!(validate_procedure("dbo.pEjecutarScriptDirectorio").is_ok());
        assert!(validate_procedure("[dbo].[pEjecutarScriptDirectorio]").is_ok());
        assert!(validate_procedure("dbo.p; DROP TABLE x").is_err());
        assert!(validate_procedure("").is_err());

        assert!(
            check_directory_length(r"\\Produccion\C\ERPClave\Script\2026-10-09_12-30-00").is_ok()
        );
        assert!(check_directory_length(&"x".repeat(231)).is_err());
    }

    #[test]
    fn runs_are_recorded_keeping_output_only_for_failures() {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-sql-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let db = Database::open(&root.join("test.db")).unwrap();

        let results = vec![
            script_result("Cliente01", "cambios.sql", "PRINT 1\nPRINT 2"),
            script_result(
                "Cliente02",
                "cambios.sql",
                "Msg 208, Level 16, State 1\nNo existe",
            ),
            script_result("Cliente02", "datos.sql", "Msg 547, Level 16, State 0"),
            script_result("Cliente03", "cambios.sql", "Completado"),
        ];
        assert_eq!(failed_databases(&results), ["Cliente02"]);

        let files = vec!["cambios.sql".to_string(), "datos.sql".to_string()];
        let started = db.now().unwrap();
        let first = db
            .insert_script_run(&NewScriptRun {
                started_at: &started,
                directory: r"\\srv\Script\2026-10-09",
                files: &files,
                target: None,
                retry_of: None,
                error: None,
                results: &results,
            })
            .unwrap();
        assert!(first.completed);
        assert_eq!(first.files, files);
        assert_eq!(
            first.results[0].output, "",
            "la salida correcta no se guarda"
        );
        assert!(first.results[1].output.contains("No existe"));
        assert_eq!(
            first.results[1].error.as_deref(),
            Some("Msg 208, Level 16, State 1")
        );

        let retry = db
            .insert_script_run(&NewScriptRun {
                started_at: &started,
                directory: &first.directory,
                files: &files,
                target: None,
                retry_of: Some(first.id),
                error: Some("Se cortó la conexión"),
                results: &[],
            })
            .unwrap();
        assert!(!retry.completed);
        assert_eq!(retry.retry_of, Some(first.id));
        assert_eq!(db.list_script_runs().unwrap().len(), 2);
        assert!(db.get_script_run(999).is_err());

        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_only_valid_sql_files_into_a_new_folder() {
        let root =
            std::env::temp_dir().join(format!("erp-clave-update-sql-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("cambios.sql");
        let other = root.join("notas.txt");
        std::fs::write(&script, "PRINT 'hola'").unwrap();
        std::fs::write(&other, "x").unwrap();
        let folder = root.join("destino").join("2026-10-09");

        assert!(copy_scripts(&[], &folder).is_err());
        assert!(copy_scripts(&[other], &folder).is_err());
        assert!(copy_scripts(&[root.join("falta.sql")], &folder).is_err());
        assert!(copy_scripts(&[script.clone(), script.clone()], &folder).is_err());
        assert!(
            !folder.exists(),
            "no se crea la carpeta si algo no es válido"
        );

        assert_eq!(copy_scripts(&[script], &folder).unwrap(), ["cambios.sql"]);
        assert_eq!(
            std::fs::read_to_string(folder.join("cambios.sql")).unwrap(),
            "PRINT 'hola'"
        );

        std::fs::remove_dir_all(root).unwrap();
    }
}
