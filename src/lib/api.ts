import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  os: string;
  databasePath: string;
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
