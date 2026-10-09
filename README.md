# ERP Clave Update

Aplicación de escritorio para desplegar las actualizaciones del ERP en los servidores. Sustituye el proceso manual de borrar el contenido de la carpeta de cada servidor y copiar los archivos publicados.

Compara la carpeta de publicación con la de cada servidor, copia solo lo que ha cambiado, borra lo que sobra, respeta los archivos que no deben tocarse (como `web.config`) y guarda un backup para poder volver atrás.

Funciona en Windows y macOS. Los servidores se alcanzan como carpetas de red.

## Instalación

Descarga el instalador de la última versión en la página de [releases](https://github.com/J4LM/erp-clave-update/releases):

- **Windows**: el archivo `.exe`. Windows mostrará el aviso de SmartScreen; pulsa "Más información" y "Ejecutar de todas formas".
- **macOS**: el archivo `.dmg`.

A partir de la versión 0.4.0 la aplicación se actualiza sola: al arrancar comprueba si hay una versión nueva y la ofrece en **Configuración → Actualizaciones**.

## Cómo se usa

### 1. Crear un perfil

Un perfil une una carpeta de publicación con los servidores donde se copia. En **Perfiles → Nuevo perfil** se indica:

- **Nombre**: para distinguirlo si se publica más de una aplicación.
- **Carpeta de publicación**: la carpeta de este equipo donde se generan los archivos al publicar el ERP.

### 2. Añadir los servidores

Dentro del perfil, **Añadir servidor**:

- **Carpeta de red**: se admite `\\servidor\recurso\carpeta` y `smb://servidor/recurso/carpeta`, en cualquiera de los dos sistemas.
- **Usuario y contraseña**: opcionales, solo si la carpeta los pide. La contraseña se guarda en el almacén de credenciales del sistema (Administrador de credenciales en Windows, Llavero en macOS), nunca en la base de datos de la aplicación.

**Probar conexión** comprueba que la carpeta existe y que se puede escribir en ella.

### 3. Definir las exclusiones

Los archivos excluidos no se copian, no se sobrescriben y no se borran de los servidores. Cada patrón se aplica a todos los servidores del perfil o solo a uno.

| Patrón | Qué excluye |
|---|---|
| `web.config` | Cualquier archivo con ese nombre, en cualquier carpeta |
| `*.log` | Todos los archivos con esa extensión |
| `App_Data` | La carpeta `App_Data` y todo su contenido |
| `App_Data/*.mdf` | Los `.mdf` que están directamente en `App_Data`, partiendo de la raíz |
| `logs/**` | Todo el contenido de la carpeta `logs` de la raíz |

Reglas:

- Un patrón sin barra vale para cualquier profundidad; con barra, la ruta parte de la raíz.
- Excluir una carpeta excluye todo lo que contiene.
- No se distinguen mayúsculas.

Mientras se escribe un patrón, la aplicación muestra qué archivos de la publicación captura.

### 4. Comparar y desplegar

En **Desplegar** se elige el perfil y se pulsa **Comparar** en cada servidor. La comparación no modifica nada; muestra qué haría un despliegue:

| Estado | Significado |
|---|---|
| Nuevo | Está en la publicación y no en el servidor: se copiará |
| Modificado | Está en ambos con distinto contenido: se sustituirá |
| A borrar | Solo está en el servidor: se borrará |
| Excluido | Coincide con una exclusión: no se toca |
| Sin cambios | Está en ambos con el mismo contenido: no se toca |

El contenido se compara de verdad, byte a byte, así que no depende de fechas ni de números de versión.

Si hay cambios aparece el botón **Desplegar**, con estas opciones:

- **Nota**: texto libre que queda en el historial.
- **Backup previo** (activado por defecto): si el despliegue falla, el servidor se restaura automáticamente.
- **Página de mantenimiento**: coloca un archivo `app_offline.htm` mientras dura el despliegue, para que IIS muestre un aviso a los usuarios en lugar de posibles errores, y lo quita al terminar.
- **Confirmación**: hay que escribir el nombre del servidor.

El despliegue vuelve a comparar, copia los archivos nuevos y modificados (dejando la carpeta `bin` para el final), borra los sobrantes y verifica que lo copiado coincide con la publicación.

Como protección, la aplicación se niega a desplegar si la carpeta de publicación está vacía, para no vaciar el servidor.

### 5. Backups

Un backup es una copia comprimida (`.zip`) de la carpeta de un servidor, guardada en este equipo.

- Se crean automáticamente antes de cada despliegue, o a mano en **Backups → Crear backup**.
- Los manuales incluyen por defecto toda la carpeta, también los archivos excluidos. Los automáticos no incluyen los excluidos, porque el despliegue no los toca.
- **Restaurar** deja la carpeta del servidor como estaba al hacer el backup: sobrescribe los archivos del zip y borra los que no están en él. Los archivos excluidos se respetan salvo que se marque lo contrario.

En **Configuración → Backups** se cambia la carpeta donde se guardan y cuántos se conservan por servidor (10 por defecto; con 0 no se borra ninguno).

### 6. Historial

**Historial** registra cada despliegue y cada restauración con su fecha, servidor, resultado y nota. El detalle muestra la lista de archivos nuevos, sustituidos y borrados.

Desde el detalle de un despliegue correcto, **Volver atrás** restaura el backup que se hizo justo antes. Volver atrás desde un despliegue antiguo deshace también los posteriores.

### 7. Actualizar las bases de datos

Después de copiar los archivos suele hacer falta aplicar los cambios de esquema en las bases de datos de los clientes. La aplicación no ejecuta los scripts directamente: los copia a una carpeta de red y llama al procedimiento del panel de administración (`pEjecutarScriptDirectorio`), que los lanza con `sqlcmd` en cada base de datos.

Primero se configura en **Configuración → Bases de datos**: el servidor de SQL, la base de datos del panel, el usuario y la contraseña, el nombre del procedimiento y la carpeta de scripts. La carpeta debe ser una ruta de red que también vea SQL Server.

En **Bases de datos**:

1. Se añaden los archivos `.sql`.
2. Se elige el destino: todas las bases de datos registradas en el panel, o una sola para probar el script antes.
3. Al ejecutar, la aplicación copia los scripts a una subcarpeta nueva con la fecha, de modo que nunca se cuela un script de una actualización anterior, y muestra el resultado de cada base de datos según termina.

Cuando hay bases de datos con error, **Reintentar en las fallidas** vuelve a lanzar los scripts solo en ellas. Cada ejecución queda en **Historial → Bases de datos**, con la salida completa de las que fallaron.

A tener en cuenta:

- El procedimiento no indica si un script terminó bien, así que la aplicación detecta los fallos buscando los mensajes de error de SQL Server en la salida de `sqlcmd`.
- Un error no detiene el script en esa base de datos: `sqlcmd` sigue con los lotes siguientes. Conviene generar los scripts con la opción de incluir scripts transaccionales.
- Los cambios en las bases de datos no se pueden deshacer desde la aplicación.

#### Despliegue y bases de datos bajo la misma página de mantenimiento

Para que ningún usuario entre con la aplicación nueva y la base de datos antigua, al desplegar se puede marcar **Dejarla puesta al terminar** junto a la página de mantenimiento. El servidor queda en mantenimiento después de copiar los archivos, y un aviso en la parte superior de la aplicación lo recuerda hasta que se pulsa **Quitar mantenimiento**, normalmente después de actualizar las bases de datos.

## Dónde se guardan los datos

| Dato | Ubicación |
|---|---|
| Configuración, perfiles e historial | Base de datos SQLite en la carpeta de datos de la aplicación |
| Scripts de base de datos ejecutados | Subcarpetas con fecha dentro de la carpeta de scripts de la red |
| Backups | Subcarpeta `backups` de esa misma carpeta, salvo que se configure otra |
| Contraseñas de los servidores y de SQL | Almacén de credenciales del sistema |

La carpeta de datos es `%APPDATA%\com.jalm.erp-clave-update` en Windows y `~/Library/Application Support/com.jalm.erp-clave-update` en macOS. La ruta exacta se muestra en **Configuración → Acerca de**.

Todo es local a cada equipo: los perfiles, el historial y los backups no se comparten entre usuarios.

## Desarrollo

### Requisitos

- [Bun](https://bun.sh)
- [Rust](https://rustup.rs) (estable)
- Las [dependencias de Tauri](https://tauri.app/start/prerequisites/) para el sistema operativo

### Comandos

```bash
bun install          # instalar dependencias
bun tauri dev        # arrancar la aplicación en modo desarrollo
bun run build        # comprobar tipos y compilar el frontend
```

Tests y comprobaciones del lado Rust, desde `src-tauri`:

```bash
cargo test
cargo clippy --all-targets
```

### Tecnología

- **Aplicación**: [Tauri 2](https://tauri.app), con el trabajo de archivos en Rust.
- **Interfaz**: React 19 y TypeScript, con TanStack Router, Query, Form y Table.
- **Estilos**: Tailwind CSS 4 y daisyUI 5.
- **Datos**: SQLite.

### Estructura

```
src/                  Interfaz (React)
  routes/             Una pantalla por archivo (rutas de TanStack Router)
  components/         Componentes compartidos y diálogos
  lib/api.ts          Llamadas a los comandos de Rust y sus tipos
src-tauri/src/        Lógica de la aplicación (Rust)
  commands.rs         Comandos que llama la interfaz
  db.rs               Base de datos y migraciones
  profiles.rs         Perfiles y servidores
  net.rs              Conexión a carpetas de red
  secrets.rs          Contraseñas en el almacén del sistema
  exclusions.rs       Patrones de exclusión
  compare.rs          Comparación entre publicación y servidor
  deploy.rs           Despliegue e historial
  backup.rs           Backups y restauración
  sql.rs              Scripts en las bases de datos de los clientes
```

Los cambios en la base de datos se hacen añadiendo una entrada nueva al final de la lista de migraciones de `db.rs`. Las entradas ya publicadas no se editan.

Los comentarios del código y los mensajes de commit se escriben en español.

## Publicar una versión

Las versiones las compila GitHub Actions al subir una etiqueta.

1. Cambia el número de versión en `package.json` y en `src-tauri/Cargo.toml`.
2. Haz commit y súbelo.
3. Crea y sube la etiqueta con el mismo número:

   ```bash
   git tag v0.5.0
   git push origin v0.5.0
   ```

El flujo de trabajo comprueba que la etiqueta coincide con la versión de `package.json`, pasa los tests y publica los instaladores de Windows y macOS.

### Versiones de prueba

El nombre de la etiqueta decide si la versión llega a los usuarios:

| Etiqueta | Resultado |
|---|---|
| `v0.5.0` | Se publica. Las aplicaciones instaladas se actualizan a ella. |
| `v0.5.0-beta.1` (cualquiera con guion) | Queda como borrador: solo la ve quien puede escribir en el repositorio y las aplicaciones la ignoran. |

Un borrador se puede descargar desde GitHub para probarlo. Si después se publica a mano con "Publish release", pasa a ser la última versión y las aplicaciones se actualizan a ella.

La versión de `package.json` debe llevar el mismo sufijo que la etiqueta (`0.5.0-beta.1`).

### Firma de las actualizaciones

Cada instalador se firma con una clave privada, y la aplicación solo instala actualizaciones firmadas con ella. La clave está en el secreto `TAURI_SIGNING_PRIVATE_KEY` del repositorio.

Si se pierde esa clave, las aplicaciones ya instaladas no podrán actualizarse y habrá que reinstalarlas a mano con una clave nueva. Conviene guardar una copia en un lugar seguro.

Para compilar un instalador en local hace falta la misma clave:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ruta/a/la/clave.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
bun tauri build
```

### Firma de Apple

La aplicación de macOS se firma y se notariza si existen estos secretos en el repositorio; si no, se compila sin firmar:

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` y `APPLE_TEAM_ID`.
