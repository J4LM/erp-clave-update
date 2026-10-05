import { queryOptions } from "@tanstack/react-query";
import { Channel, invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  os: string;
  databasePath: string;
  /** Carpeta de backups que se usa si no se ha configurado otra. */
  defaultBackupDir: string;
}

export const appInfoQuery = queryOptions({
  queryKey: ["app-info"],
  queryFn: () => invoke<AppInfo>("get_app_info"),
  staleTime: Infinity,
});

export const settingQuery = (key: string) =>
  queryOptions({
    queryKey: ["setting", key],
    queryFn: () => invoke<string | null>("get_setting", { key }),
    staleTime: Infinity,
  });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

export interface ProfileSummary {
  id: number;
  name: string;
  sourcePath: string;
  sourceExists: boolean;
  serverCount: number;
}

export interface Server {
  id: number;
  profileId: number;
  name: string;
  address: string;
  username: string | null;
  hasPassword: boolean;
}

export interface Profile {
  id: number;
  name: string;
  sourcePath: string;
  sourceExists: boolean;
  servers: Server[];
  exclusions: Exclusion[];
}

export interface Exclusion {
  id: number;
  /** null se aplica a todos los servidores del perfil. */
  serverId: number | null;
  pattern: string;
}

export interface ExclusionPreview {
  totalFiles: number;
  matchedCount: number;
  /** Solo las primeras coincidencias; matchedCount tiene el total real. */
  matched: string[];
}

export interface ProfileInput {
  name: string;
  sourcePath: string;
}

export interface ServerInput {
  name: string;
  address: string;
  username: string | null;
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  path: string | null;
}

export const profilesQuery = queryOptions({
  queryKey: ["profiles"],
  queryFn: () => invoke<ProfileSummary[]>("list_profiles"),
});

export const profileQuery = (id: number) =>
  queryOptions({
    queryKey: ["profiles", id],
    queryFn: () => invoke<Profile>("get_profile", { id }),
  });

export const createProfile = (input: ProfileInput) =>
  invoke<number>("create_profile", { input });

export const updateProfile = (id: number, input: ProfileInput) =>
  invoke<void>("update_profile", { id, input });

export const deleteProfile = (id: number) =>
  invoke<void>("delete_profile", { id });

// `password`: null conserva la guardada; una cadena vacía la elimina.
export const createServer = (
  profileId: number,
  input: ServerInput,
  password: string | null,
) => invoke<number>("create_server", { profileId, input, password });

export const updateServer = (
  id: number,
  input: ServerInput,
  password: string | null,
) => invoke<void>("update_server", { id, input, password });

export const deleteServer = (id: number) =>
  invoke<void>("delete_server", { id });

export const testServer = (id: number) =>
  invoke<ConnectionTest>("test_server", { id });

export const addExclusion = (
  profileId: number,
  serverId: number | null,
  pattern: string,
) => invoke<number>("add_exclusion", { profileId, serverId, pattern });

export const deleteExclusion = (id: number) =>
  invoke<void>("delete_exclusion", { id });

/**
 * Archivos de la publicación que captura `pattern` o, si es null, las
 * exclusiones guardadas que afectan a `serverId` (las comunes si es null).
 */
export const exclusionPreviewQuery = (
  profileId: number,
  serverId: number | null,
  pattern: string | null,
) =>
  queryOptions({
    queryKey: ["profiles", profileId, "exclusion-preview", serverId, pattern],
    queryFn: () =>
      invoke<ExclusionPreview>("preview_exclusions", {
        profileId,
        serverId,
        pattern,
      }),
    retry: false,
  });

export type FileStatus =
  | "new"
  | "modified"
  | "deleted"
  | "excluded"
  | "unchanged";

export interface FileEntry {
  /** Ruta relativa separada por `/`. */
  path: string;
  status: FileStatus;
  /** Tamaño en la publicación; null si el archivo no existe allí. */
  sourceSize: number | null;
  /** Tamaño en el servidor; null si el archivo no existe allí. */
  targetSize: number | null;
}

export interface Comparison {
  entries: FileEntry[];
  counts: Record<FileStatus, number> & { bytesToCopy: number };
}

// Comparar lee los archivos del servidor, así que solo se hace a petición.
export const comparisonQuery = (profileId: number, serverId: number) =>
  queryOptions({
    queryKey: ["comparison", profileId, serverId],
    queryFn: () =>
      invoke<Comparison>("compare_server", { profileId, serverId }),
    staleTime: Infinity,
    retry: false,
  });

export const BACKUP_DIR_SETTING = "backup_dir";
export const BACKUP_KEEP_SETTING = "backup_keep";
export const DEFAULT_BACKUP_KEEP = 10;

export interface Backup {
  id: number;
  /** null si el servidor se eliminó después; ya no se puede restaurar en él. */
  serverId: number | null;
  profileName: string;
  serverName: string;
  /** Fecha UTC en formato `AAAA-MM-DD HH:MM:SS`. */
  createdAt: string;
  filePath: string;
  fileExists: boolean;
  fileCount: number;
  totalBytes: number;
  archiveBytes: number;
  /** Si incluye también los archivos excluidos. */
  complete: boolean;
  note: string;
}

export interface Progress {
  done: number;
  total: number;
  /** Archivo que se está procesando. */
  path: string;
}

export interface RestoreStats {
  restored: number;
  deleted: number;
  protected: number;
}

export const backupsQuery = queryOptions({
  queryKey: ["backups"],
  queryFn: () => invoke<Backup[]>("list_backups"),
});

function progressChannel(onProgress: (progress: Progress) => void) {
  const channel = new Channel<Progress>();
  channel.onmessage = onProgress;
  return channel;
}

export const createBackup = (
  serverId: number,
  note: string,
  includeExcluded: boolean,
  onProgress: (progress: Progress) => void,
) =>
  invoke<Backup>("create_backup", {
    serverId,
    note,
    includeExcluded,
    onProgress: progressChannel(onProgress),
  });

export const restoreBackup = (
  id: number,
  includeExcluded: boolean,
  onProgress: (progress: Progress) => void,
) =>
  invoke<RestoreStats>("restore_backup", {
    id,
    includeExcluded,
    onProgress: progressChannel(onProgress),
  });

export const deleteBackup = (id: number) =>
  invoke<void>("delete_backup", { id });

export type DeployPhase =
  | "connecting"
  | "backup"
  | "comparing"
  | "copying"
  | "deleting"
  | "verifying"
  | "restoring";

export interface DeployProgress extends Progress {
  phase: DeployPhase;
}

/** ok: copiado y verificado. restored: falló y se restauró el backup. failed: pudo quedar a medias. */
export type DeployStatus = "ok" | "restored" | "failed";

export interface ChangedFile {
  path: string;
  action: "added" | "replaced" | "removed";
}

export interface Deployment {
  id: number;
  /** restore: restauración manual de un backup; `copied` son los archivos restaurados. */
  kind: "deploy" | "restore";
  profileName: string;
  serverName: string;
  /** Fechas UTC en formato `AAAA-MM-DD HH:MM:SS`. */
  startedAt: string;
  finishedAt: string;
  status: DeployStatus;
  copied: number;
  deleted: number;
  bytesCopied: number;
  /** Backup hecho justo antes, si se pidió y sigue existiendo. */
  backupId: number | null;
  note: string;
  error: string | null;
  files: ChangedFile[];
}

export interface DeployOptions {
  note: string;
  /** Hacer un backup antes y restaurarlo si el despliegue falla. */
  backup: boolean;
  /** Mostrar la página de mantenimiento de IIS mientras dura. */
  maintenance: boolean;
}

export const deploymentsQuery = queryOptions({
  queryKey: ["deployments"],
  queryFn: () => invoke<Deployment[]>("list_deployments"),
});

export const deployServer = (
  profileId: number,
  serverId: number,
  options: DeployOptions,
  onProgress: (progress: DeployProgress) => void,
) => {
  const channel = new Channel<DeployProgress>();
  channel.onmessage = onProgress;
  return invoke<Deployment>("deploy_server", {
    profileId,
    serverId,
    options,
    onProgress: channel,
  });
};

// Opciones de despliegue que se recuerdan por perfil.
export const deployBackupSetting = (profileId: number) =>
  `deploy_backup_${profileId}`;
export const deployMaintenanceSetting = (profileId: number) =>
  `deploy_maintenance_${profileId}`;
