import { useMemo, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { RestoreBackupDialog } from "@/components/backup-dialogs";
import { DataTable, features, PAGE_SIZE } from "@/components/data-table";
import {
  DeploymentStatus,
  kindLabel,
} from "@/components/deployment-status";
import { Dialog } from "@/components/form";
import { EmptyState, Page } from "@/components/page";
import {
  backupsQuery,
  deploymentsQuery,
  type Backup,
  type ChangedFile,
  type Deployment,
} from "@/lib/api";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";

export const Route = createFileRoute("/historial")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(deploymentsQuery),
  component: Historial,
});

const helper = createColumnHelper<typeof features, Deployment>();

function Historial() {
  const { data: deployments } = useSuspenseQuery(deploymentsQuery);
  const { data: backups = [] } = useQuery(backupsQuery);
  const [detail, setDetail] = useState<Deployment | null>(null);
  const [toRestore, setToRestore] = useState<Backup | null>(null);

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
        helper.accessor((deployment) => kindLabel(deployment), {
          id: "kind",
          header: "Operación",
          sortFn: "text",
        }),
        helper.accessor("profileName", { header: "Perfil", sortFn: "text" }),
        helper.accessor("serverName", { header: "Servidor", sortFn: "text" }),
        helper.accessor("status", {
          header: "Resultado",
          sortFn: "text",
          cell: ({ row }) => <DeploymentStatus deployment={row.original} />,
        }),
        helper.accessor("copied", { header: "Copiados" }),
        helper.accessor("deleted", { header: "Borrados" }),
        helper.accessor("note", { header: "Nota", sortFn: "text" }),
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
    data: deployments,
    initialState: {
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
      sorting: [{ id: "startedAt", desc: true }],
    },
  });

  return (
    <Page
      title="Historial"
      description="Registro de los despliegues y restauraciones realizados."
    >
      {deployments.length === 0 ? (
        <EmptyState
          title="Sin despliegues"
          description="Cada despliegue quedará registrado con su fecha, servidor, archivos cambiados y resultado."
        />
      ) : (
        <DataTable table={table} itemsLabel="operaciones" />
      )}

      {detail && (
        <DeploymentDetail
          deployment={detail}
          backup={backups.find((backup) => backup.id === detail.backupId)}
          onRollback={(backup) => {
            setDetail(null);
            setToRestore(backup);
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {toRestore && (
        <RestoreBackupDialog
          backup={toRestore}
          onClose={() => setToRestore(null)}
        />
      )}
    </Page>
  );
}

const ACTION: Record<ChangedFile["action"], { label: string; badge: string }> =
  {
    added: { label: "Nuevo", badge: "badge-success" },
    replaced: { label: "Sustituido", badge: "badge-warning" },
    removed: { label: "Borrado", badge: "badge-error" },
  };

interface DeploymentDetailProps {
  deployment: Deployment;
  /** Backup hecho antes de este despliegue, si sigue existiendo. */
  backup: Backup | undefined;
  onRollback: (backup: Backup) => void;
  onClose: () => void;
}

function DeploymentDetail({
  deployment,
  backup,
  onRollback,
  onClose,
}: DeploymentDetailProps) {
  const isDeploy = deployment.kind === "deploy";
  const canRollback =
    backup !== undefined && backup.fileExists && backup.serverId !== null;

  return (
    <Dialog
      title={`${kindLabel(deployment)} en ${deployment.serverName}`}
      onClose={onClose}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-base-content/60">Fecha</dt>
        <dd>
          {formatDate(deployment.startedAt)} (
          {formatDuration(deployment.startedAt, deployment.finishedAt)})
        </dd>
        <dt className="text-base-content/60">Perfil</dt>
        <dd>{deployment.profileName}</dd>
        <dt className="text-base-content/60">Resultado</dt>
        <dd>
          <DeploymentStatus deployment={deployment} />
        </dd>
        <dt className="text-base-content/60">Archivos</dt>
        <dd>
          {deployment.copied} {isDeploy ? "copiados" : "restaurados"}
          {isDeploy && ` (${formatBytes(deployment.bytesCopied)})`} y{" "}
          {deployment.deleted} borrados
        </dd>
        {deployment.note && (
          <>
            <dt className="text-base-content/60">Nota</dt>
            <dd>{deployment.note}</dd>
          </>
        )}
      </dl>

      {deployment.error && (
        <div role="alert" className="alert alert-error alert-soft mt-4">
          <span className="break-words">{deployment.error}</span>
        </div>
      )}

      {deployment.files.length > 0 && (
        <ul className="mt-4 max-h-64 overflow-y-auto rounded-box bg-base-200 p-3 text-xs">
          {deployment.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 py-0.5">
              <span
                className={`badge badge-soft badge-xs shrink-0 ${ACTION[file.action].badge}`}
              >
                {ACTION[file.action].label}
              </span>
              <span className="font-mono break-all">{file.path}</span>
            </li>
          ))}
        </ul>
      )}

      {isDeploy && deployment.status === "ok" && (
        <p className="mt-4 text-sm text-base-content/60">
          {canRollback
            ? "Volver atrás restaura el backup hecho justo antes de este despliegue."
            : "No se puede volver atrás desde aquí: este despliegue no tiene backup previo disponible."}
        </p>
      )}

      <div className="modal-action">
        {isDeploy && deployment.status === "ok" && canRollback && (
          <button className="btn btn-warning" onClick={() => onRollback(backup)}>
            Volver atrás
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
