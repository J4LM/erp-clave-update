import { useMemo, useState } from "react";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import {
  CreateBackupDialog,
  RestoreBackupDialog,
} from "@/components/backup-dialogs";
import { DataTable, features, PAGE_SIZE } from "@/components/data-table";
import { ConfirmDialog } from "@/components/form";
import { EmptyState, Page } from "@/components/page";
import { backupsQuery, deleteBackup, type Backup } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";

export const Route = createFileRoute("/backups")({
  loader: ({ context }) => context.queryClient.ensureQueryData(backupsQuery),
  component: Backups,
});

const helper = createColumnHelper<typeof features, Backup>();

function Backups() {
  const queryClient = useQueryClient();
  const { data: backups } = useSuspenseQuery(backupsQuery);
  const [creating, setCreating] = useState(false);
  const [toRestore, setToRestore] = useState<Backup | null>(null);
  const [toDelete, setToDelete] = useState<Backup | null>(null);

  const remove = useMutation({
    mutationFn: (backup: Backup) => deleteBackup(backup.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: backupsQuery.queryKey });
      setToDelete(null);
    },
  });

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("createdAt", {
          header: "Fecha",
          sortFn: "text",
          cell: ({ getValue }) => (
            <span className="whitespace-nowrap">{formatDate(getValue())}</span>
          ),
        }),
        helper.accessor("profileName", { header: "Perfil", sortFn: "text" }),
        helper.accessor("serverName", { header: "Servidor", sortFn: "text" }),
        helper.accessor("fileCount", { header: "Archivos" }),
        helper.accessor("archiveBytes", {
          header: "Tamaño",
          cell: ({ getValue }) => (
            <span className="whitespace-nowrap">{formatBytes(getValue())}</span>
          ),
        }),
        helper.accessor("note", {
          header: "Nota",
          sortFn: "text",
          cell: ({ row }) => (
            <div className="flex flex-wrap items-center gap-2">
              {row.original.note}
              {!row.original.complete && (
                <span className="badge badge-ghost badge-sm">
                  Sin excluidos
                </span>
              )}
              {!row.original.fileExists && (
                <span className="badge badge-error badge-soft badge-sm">
                  Archivo no encontrado
                </span>
              )}
            </div>
          ),
        }),
        helper.display({
          id: "actions",
          header: "",
          cell: ({ row }) => {
            const backup = row.original;
            const canRestore = backup.fileExists && backup.serverId !== null;
            return (
              <div className="flex justify-end gap-1">
                <button
                  className="btn btn-xs"
                  disabled={!canRestore}
                  title={
                    backup.serverId === null
                      ? "El servidor de este backup se eliminó"
                      : undefined
                  }
                  onClick={() => setToRestore(backup)}
                >
                  Restaurar
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => {
                    remove.reset();
                    setToDelete(backup);
                  }}
                >
                  Eliminar
                </button>
              </div>
            );
          },
        }),
      ]),
    // Las columnas deben ser estables; `remove.reset` y los setters lo son.
    [remove.reset],
  );

  const table = useTable({
    features,
    columns,
    data: backups,
    initialState: {
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
      sorting: [{ id: "createdAt", desc: true }],
    },
  });

  return (
    <Page
      title="Backups"
      description="Copias de las carpetas de los servidores y su restauración."
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Crear backup
        </button>
      }
    >
      {backups.length === 0 ? (
        <EmptyState
          title="Sin backups"
          description="Un backup guarda en este equipo una copia comprimida de la carpeta de un servidor, para poder dejarla como estaba si algo sale mal."
        />
      ) : (
        <DataTable table={table} itemsLabel="backups" />
      )}

      {creating && <CreateBackupDialog onClose={() => setCreating(false)} />}

      {toRestore && (
        <RestoreBackupDialog
          backup={toRestore}
          onClose={() => setToRestore(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Eliminar backup"
          message={`Se eliminará el backup de "${toDelete.serverName}" del ${formatDate(toDelete.createdAt)} y su archivo. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          isPending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(toDelete)}
          onClose={() => setToDelete(null)}
        />
      )}
    </Page>
  );
}
