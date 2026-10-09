import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { open } from "@tauri-apps/plugin-dialog";
import { DataTable, features, PAGE_SIZE } from "@/components/data-table";
import { Dialog } from "@/components/form";
import { EmptyState, Page } from "@/components/page";
import {
  erpDatabasesQuery,
  sqlConfigQuery,
  type ScriptResult,
} from "@/lib/api";
import {
  failedDatabases,
  scriptRunQuery,
  startScriptRetry,
  startScriptRun,
  type ScriptRunState,
} from "@/lib/script-run";

export const Route = createFileRoute("/bases-datos")({
  loader: ({ context }) => context.queryClient.ensureQueryData(sqlConfigQuery),
  component: BasesDatos,
});

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function BasesDatos() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery(sqlConfigQuery);
  const configured =
    !!config &&
    config.hasPassword &&
    config.host !== "" &&
    config.username !== "" &&
    config.scriptsDir !== "";
  const databases = useQuery({ ...erpDatabasesQuery, enabled: configured });
  const { data: run } = useQuery(scriptRunQuery);

  const [files, setFiles] = useState<string[]>([]);
  // Cadena vacía: todas las bases de datos.
  const [database, setDatabase] = useState("");
  const [confirming, setConfirming] = useState(false);

  const running = run?.status === "running";

  async function addFiles() {
    const selected = await open({
      multiple: true,
      title: "Scripts de actualización",
      filters: [{ name: "Scripts SQL", extensions: ["sql"] }],
    });
    if (selected) {
      setFiles((current) => [
        ...current,
        ...selected.filter((path) => !current.includes(path)),
      ]);
    }
  }

  if (!configured) {
    return (
      <Page
        title="Bases de datos"
        description="Ejecuta los scripts de actualización en las bases de datos de los clientes."
      >
        <EmptyState
          title="Falta configurar el servidor de SQL"
          description="Indica el servidor, el usuario y la carpeta de scripts para poder lanzar actualizaciones."
          action={
            <Link to="/configuracion" className="btn btn-primary">
              Ir a Configuración
            </Link>
          }
        />
      </Page>
    );
  }

  const total = databases.data?.length ?? 0;

  return (
    <Page
      title="Bases de datos"
      description="Ejecuta los scripts de actualización en las bases de datos de los clientes."
    >
      <section className="card card-border bg-base-100">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Scripts</h2>
            <button
              className="btn btn-sm"
              disabled={running}
              onClick={() => void addFiles()}
            >
              Añadir scripts
            </button>
          </div>
          {files.length === 0 ? (
            <p className="py-4 text-center text-base-content/60">
              Añade los archivos .sql que quieres ejecutar.
            </p>
          ) : (
            <ul className="list">
              {files.map((path) => (
                <li key={path} className="list-row items-center py-2">
                  <div className="list-col-grow min-w-0">
                    <div className="font-mono text-sm">{fileName(path)}</div>
                    <div className="truncate text-xs text-base-content/60">
                      {path}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    disabled={running}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((item) => item !== path),
                      )
                    }
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card card-border bg-base-100">
        <div className="card-body">
          <h2 className="card-title">Destino</h2>
          {databases.isError ? (
            <div role="alert" className="alert alert-error alert-soft">
              <span className="break-words">
                No se pudo leer la lista de bases de datos:{" "}
                {String(databases.error)}
              </span>
              <button
                className="btn btn-sm"
                onClick={() => void databases.refetch()}
              >
                Reintentar
              </button>
            </div>
          ) : (
            <div className="flex items-end justify-between gap-4">
              <fieldset className="fieldset grow">
                <legend className="fieldset-legend">Base de datos</legend>
                <select
                  className="select w-full"
                  value={database}
                  disabled={running || databases.isPending}
                  onChange={(event) => setDatabase(event.target.value)}
                >
                  <option value="">
                    {databases.isPending
                      ? "Cargando bases de datos…"
                      : `Todas las bases de datos (${total})`}
                  </option>
                  {databases.data?.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} · {item.server}
                    </option>
                  ))}
                </select>
                <p className="label whitespace-normal">
                  Elige una sola para probar el script antes de lanzarlo en
                  todas.
                </p>
              </fieldset>
              <button
                className="btn btn-primary mb-7"
                disabled={
                  running || files.length === 0 || !databases.isSuccess
                }
                onClick={() => setConfirming(true)}
              >
                Ejecutar
              </button>
            </div>
          )}
        </div>
      </section>

      {run && <RunCard run={run} />}

      {confirming && (
        <ConfirmRunDialog
          files={files.map(fileName)}
          database={database || null}
          total={total}
          onConfirm={() => {
            setConfirming(false);
            void startScriptRun(queryClient, files, database || null);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </Page>
  );
}

interface ConfirmRunDialogProps {
  files: string[];
  database: string | null;
  total: number;
  onConfirm: () => void;
  onClose: () => void;
}

function ConfirmRunDialog({
  files,
  database,
  total,
  onConfirm,
  onClose,
}: ConfirmRunDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  // Lanzar en todas pide escribir la palabra; en una sola basta con confirmar.
  const confirmed =
    database !== null || confirmation.trim().toLowerCase() === "todas";

  return (
    <Dialog title="Ejecutar scripts" onClose={onClose}>
      <p className="text-base-content/70">
        {database === null
          ? `Se ejecutarán en las ${total} bases de datos registradas en el panel:`
          : `Se ejecutarán solo en la base de datos ${database}:`}
      </p>
      <ul className="my-3 font-mono text-sm">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      <p className="text-sm text-base-content/60">
        Los cambios en las bases de datos no se pueden deshacer desde esta
        aplicación.
      </p>

      {database === null && (
        <fieldset className="fieldset">
          <legend className="fieldset-legend">
            Escribe «todas» para confirmar
          </legend>
          <input
            className="input w-full"
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </fieldset>
      )}

      <div className="modal-action">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          disabled={!confirmed}
          onClick={onConfirm}
        >
          Ejecutar
        </button>
      </div>
    </Dialog>
  );
}

const helper = createColumnHelper<typeof features, ScriptResult>();

function RunCard({ run }: { run: ScriptRunState }) {
  const queryClient = useQueryClient();
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [detail, setDetail] = useState<ScriptResult | null>(null);

  const failed = run.results.filter((result) => !result.ok).length;
  const done = run.results.length;
  const data = useMemo(
    () =>
      onlyErrors ? run.results.filter((result) => !result.ok) : run.results,
    [run.results, onlyErrors],
  );

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((result) => (result.ok ? "Correcto" : "Error"), {
          id: "status",
          header: "Resultado",
          sortFn: "text",
          cell: ({ row }) => (
            <span
              className={`badge badge-soft badge-sm ${row.original.ok ? "badge-success" : "badge-error"}`}
            >
              {row.original.ok ? "Correcto" : "Error"}
            </span>
          ),
        }),
        helper.accessor("database", {
          header: "Base de datos",
          sortFn: "text",
        }),
        helper.accessor("script", { header: "Script", sortFn: "text" }),
        helper.accessor((result) => result.error ?? "", {
          id: "error",
          header: "Error",
          sortFn: "text",
          cell: ({ getValue }) => (
            <span className="text-xs break-words text-error">
              {getValue()}
            </span>
          ),
        }),
        helper.display({
          id: "actions",
          header: "",
          cell: ({ row }) => (
            <div className="flex justify-end">
              <button
                className="btn btn-xs"
                onClick={() => setDetail(row.original)}
              >
                Ver salida
              </button>
            </div>
          ),
        }),
      ]),
    [],
  );

  const table = useTable({
    features,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  });

  return (
    <section className="card card-border bg-base-100">
      <div className="card-body">
        <h2 className="card-title">
          {run.status === "running" ? "Ejecutando" : "Última ejecución"}
        </h2>
        <p className="text-sm text-base-content/60">
          {run.files.join(", ")} en {run.target}
        </p>

        {run.status === "running" && (
          <div className="flex flex-col gap-1">
            <progress
              className="progress w-full"
              value={run.total ? done : undefined}
              max={run.total ?? undefined}
            />
            <span className="text-xs text-base-content/60">
              {run.total === null
                ? "Copiando los scripts y conectando con el servidor…"
                : `${done} de ${run.total} ejecuciones`}
            </span>
          </div>
        )}

        {run.status === "failed" && (
          <div role="alert" className="alert alert-error alert-soft">
            <span className="break-words">
              La ejecución se interrumpió: {run.error}
              {done > 0 &&
                ` Antes de fallar se completaron ${done} ejecuciones.`}
            </span>
          </div>
        )}

        {run.status === "done" && (
          <div
            role="status"
            className={`alert alert-soft ${failed === 0 ? "alert-success" : "alert-warning"}`}
          >
            <span>
              {failed === 0
                ? `Terminado: ${done} ejecuciones sin errores detectados.`
                : `Terminado: ${done - failed} correctas y ${failed} con error.`}
            </span>
            {failed > 0 && run.runId !== null && (
              <RetryButton
                files={run.files}
                failed={failedDatabases(run.results).length}
                onRetry={() =>
                  void startScriptRetry(queryClient, {
                    id: run.runId!,
                    files: run.files,
                    failed: failedDatabases(run.results).length,
                  })
                }
              />
            )}
          </div>
        )}

        {done > 0 && (
          <>
            <label className="label self-start">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={onlyErrors}
                onChange={(event) => setOnlyErrors(event.target.checked)}
              />
              Mostrar solo las que tienen error ({failed})
            </label>
            {data.length === 0 ? (
              <p className="py-4 text-center text-base-content/60">
                Ninguna ejecución con error.
              </p>
            ) : (
              <DataTable table={table} itemsLabel="ejecuciones" />
            )}
          </>
        )}

        {run.directory && (
          <p className="text-xs text-base-content/60">
            Scripts copiados en{" "}
            <span className="font-mono">{run.directory}</span>
          </p>
        )}
      </div>

      {detail && (
        <Dialog
          title={`${detail.script} en ${detail.database}`}
          onClose={() => setDetail(null)}
        >
          <pre className="max-h-96 overflow-auto rounded-box bg-base-200 p-3 text-xs whitespace-pre-wrap">
            {detail.output}
          </pre>
          <div className="modal-action">
            <button className="btn" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface RetryButtonProps {
  files: string[];
  /** Número de bases de datos con error. */
  failed: number;
  onRetry: () => void;
}

function RetryButton({ files, failed, onRetry }: RetryButtonProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setConfirming(true)}>
        Reintentar en las fallidas
      </button>
      {confirming && (
        <Dialog
          title="Reintentar en las bases de datos fallidas"
          onClose={() => setConfirming(false)}
        >
          <p className="text-base-content/70">
            {failed === 1
              ? "Se volverá a lanzar en la base de datos que falló:"
              : `Se volverá a lanzar en las ${failed} bases de datos que fallaron:`}
          </p>
          <ul className="my-3 font-mono text-sm">
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          {files.length > 1 && (
            <p className="text-sm text-base-content/60">
              En cada una se ejecutan todos los scripts de nuevo, también los
              que allí terminaron bien.
            </p>
          )}
          <div className="modal-action">
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setConfirming(false);
                onRetry();
              }}
            >
              Reintentar
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
