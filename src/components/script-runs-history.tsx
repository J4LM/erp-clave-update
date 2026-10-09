import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { DataTable, features, PAGE_SIZE } from "@/components/data-table";
import { Dialog } from "@/components/form";
import { EmptyState } from "@/components/page";
import { scriptRunsQuery, type ScriptRunRecord } from "@/lib/api";
import { formatDate, formatDuration } from "@/lib/format";
import {
  failedDatabases,
  scriptRunQuery,
  startScriptRetry,
} from "@/lib/script-run";

const helper = createColumnHelper<typeof features, ScriptRunRecord>();

const failedCount = (run: ScriptRunRecord) =>
  run.results.filter((result) => !result.ok).length;

function targetLabel(run: ScriptRunRecord) {
  if (run.retryOf !== null) return "Reintento de las fallidas";
  return run.target ?? "Todas las bases de datos";
}

function RunStatus({ run }: { run: ScriptRunRecord }) {
  const failed = failedCount(run);
  const [label, badge] = !run.completed
    ? ["Interrumpida", "badge-error"]
    : failed > 0
      ? ["Con errores", "badge-warning"]
      : ["Correcta", "badge-success"];
  return (
    <span className={`badge badge-soft badge-sm whitespace-nowrap ${badge}`}>
      {label}
    </span>
  );
}

/** Historial de las ejecuciones de scripts en las bases de datos. */
export function ScriptRunsHistory() {
  const { data: runs = [] } = useQuery(scriptRunsQuery);
  const [detail, setDetail] = useState<ScriptRunRecord | null>(null);

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("startedAt", {
          header: "Fecha",
          sortFn: "text",
          cell: ({ getValue }) => (
            <span className="whitespace-nowrap">{formatDate(getValue())}</span>
          ),
        }),
        helper.accessor((run) => run.files.join(", "), {
          id: "files",
          header: "Scripts",
          sortFn: "text",
          cell: ({ getValue }) => (
            <span className="font-mono text-xs break-all">{getValue()}</span>
          ),
        }),
        helper.accessor((run) => targetLabel(run), {
          id: "target",
          header: "Destino",
          sortFn: "text",
        }),
        helper.accessor((run) => run.results.length, {
          id: "total",
          header: "Ejecuciones",
        }),
        helper.accessor((run) => failedCount(run), {
          id: "failed",
          header: "Con error",
        }),
        helper.display({
          id: "status",
          header: "Resultado",
          cell: ({ row }) => <RunStatus run={row.original} />,
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
                Detalle
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
    data: runs,
    initialState: {
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
      sorting: [{ id: "startedAt", desc: true }],
    },
  });

  if (runs.length === 0) {
    return (
      <EmptyState
        title="Sin ejecuciones"
        description="Cada vez que se lancen scripts en las bases de datos quedará registrado aquí con el resultado de cada una."
      />
    );
  }

  return (
    <>
      <DataTable table={table} itemsLabel="ejecuciones" />
      {detail && (
        <ScriptRunDetail run={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

interface ScriptRunDetailProps {
  run: ScriptRunRecord;
  onClose: () => void;
}

function ScriptRunDetail({ run, onClose }: ScriptRunDetailProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: current } = useQuery(scriptRunQuery);
  const failed = run.results.filter((result) => !result.ok);
  const failedDbs = failedDatabases(run.results).length;

  async function retry() {
    void startScriptRetry(queryClient, {
      id: run.id,
      files: run.files,
      failed: failedDbs,
    });
    // El progreso se sigue en la pantalla de Bases de datos.
    await navigate({ to: "/bases-datos" });
  }

  return (
    <Dialog title="Ejecución de scripts" onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-base-content/60">Fecha</dt>
        <dd>
          {formatDate(run.startedAt)} (
          {formatDuration(run.startedAt, run.finishedAt)})
        </dd>
        <dt className="text-base-content/60">Scripts</dt>
        <dd className="font-mono break-all">{run.files.join(", ")}</dd>
        <dt className="text-base-content/60">Destino</dt>
        <dd>{targetLabel(run)}</dd>
        <dt className="text-base-content/60">Resultado</dt>
        <dd>
          {run.results.length - failed.length} correctas y {failed.length} con
          error
        </dd>
        <dt className="text-base-content/60">Carpeta</dt>
        <dd className="font-mono break-all">{run.directory}</dd>
      </dl>

      {run.error && (
        <div role="alert" className="alert alert-error alert-soft mt-4">
          <span className="break-words">
            La ejecución se interrumpió: {run.error}
          </span>
        </div>
      )}

      {failed.length > 0 && (
        <ul className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
          {failed.map((result) => (
            <li key={`${result.database}|${result.script}`}>
              <details className="collapse collapse-arrow bg-base-200">
                <summary className="collapse-title text-sm">
                  <span className="font-medium">{result.database}</span>
                  <span className="text-base-content/60">
                    {" "}
                    · {result.script}
                  </span>
                  <span className="block text-xs break-words text-error">
                    {result.error}
                  </span>
                </summary>
                <pre className="collapse-content overflow-x-auto text-xs whitespace-pre-wrap">
                  {result.output}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      <div className="modal-action">
        {failedDbs > 0 && (
          <button
            className="btn btn-warning"
            disabled={current?.status === "running"}
            onClick={() => void retry()}
          >
            Reintentar en las fallidas
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
