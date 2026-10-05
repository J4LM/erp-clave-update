import { queryOptions } from "@tanstack/react-query";
import { check } from "@tauri-apps/plugin-updater";

/**
 * Versión nueva disponible, o null si la app está al día. En desarrollo no se
 * consulta: la app no está instalada y no podría actualizarse.
 */
export const updateQuery = queryOptions({
  queryKey: ["update"],
  queryFn: () => check(),
  enabled: !import.meta.env.DEV,
  staleTime: 60 * 60 * 1000,
  retry: false,
});
