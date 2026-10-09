import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  retryScripts,
  runScripts,
  scriptRunsQuery,
  type RunEvent,
  type ScriptResult,
  type ScriptRunRecord,
} from "@/lib/api";

/** Estado de la última ejecución de scripts lanzada desde esta sesión. */
export interface ScriptRunState {
  status: "running" | "done" | "failed";
  /** Identificador en el historial, cuando ya se ha guardado. */
  runId: number | null;
  /** Nombres de los scripts lanzados. */
  files: string[];
  /** Dónde se lanza, en texto: una base de datos, todas o un reintento. */
  target: string;
  /** Ejecuciones previstas (bases de datos por scripts); null hasta saberlo. */
  total: number | null;
  results: ScriptResult[];
  /** Carpeta de red donde quedaron los scripts. */
  directory: string | null;
  /** Error que impidió terminar, distinto de los errores de cada base. */
  error: string | null;
}

// El estado vive en la caché de consultas para que la ejecución, que puede
// durar minutos, siga visible aunque se cambie de pantalla.
export const scriptRunQuery = queryOptions<ScriptRunState | null>({
  queryKey: ["script-run"],
  queryFn: () => null,
  staleTime: Infinity,
  gcTime: Infinity,
});

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Bases de datos distintas con algún resultado fallido. */
export const failedDatabases = (results: ScriptResult[]) => [
  ...new Set(
    results.filter((result) => !result.ok).map((result) => result.database),
  ),
];

async function track(
  queryClient: QueryClient,
  initial: Pick<ScriptRunState, "files" | "target">,
  launch: (onEvent: (event: RunEvent) => void) => Promise<ScriptRunRecord>,
) {
  const update = (change: (state: ScriptRunState) => ScriptRunState) =>
    queryClient.setQueryData(scriptRunQuery.queryKey, (state) =>
      state ? change(state) : state,
    );

  const state: ScriptRunState = {
    ...initial,
    status: "running",
    runId: null,
    total: null,
    results: [],
    directory: null,
    error: null,
  };
  queryClient.setQueryData(scriptRunQuery.queryKey, state);

  try {
    const record = await launch((event) => {
      if (event.type === "started") {
        update((current) => ({ ...current, total: event.total }));
      } else {
        update((current) => ({
          ...current,
          results: [...current.results, event.result],
        }));
      }
    });
    // Se conservan los resultados recibidos en vivo, que traen la salida
    // completa; el registro solo guarda la de los que fallaron.
    update((current) => ({
      ...current,
      status: record.completed ? "done" : "failed",
      runId: record.id,
      total: record.completed ? current.results.length : current.total,
      directory: record.directory,
      error: record.error,
    }));
  } catch (error) {
    update((current) => ({
      ...current,
      status: "failed",
      error: String(error),
    }));
  }
  await queryClient.invalidateQueries({ queryKey: scriptRunsQuery.queryKey });
}

export const startScriptRun = (
  queryClient: QueryClient,
  files: string[],
  database: string | null,
) =>
  track(
    queryClient,
    {
      files: files.map(fileName),
      target: database ?? "todas las bases de datos",
    },
    (onEvent) => runScripts(files, database, onEvent),
  );

/** Reintenta una ejecución del historial en las bases de datos que fallaron. */
export const startScriptRetry = (
  queryClient: QueryClient,
  run: { id: number; files: string[]; failed: number },
) =>
  track(
    queryClient,
    {
      files: run.files,
      target:
        run.failed === 1
          ? "la base de datos que falló"
          : `las ${run.failed} bases de datos que fallaron`,
    },
    (onEvent) => retryScripts(run.id, onEvent),
  );
