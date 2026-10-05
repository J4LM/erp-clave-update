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
