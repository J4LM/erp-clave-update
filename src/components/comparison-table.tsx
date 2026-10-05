import { useMemo, useState } from "react";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { DataTable, features, PAGE_SIZE } from "@/components/data-table";
import type { Comparison, FileEntry, FileStatus } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export const STATUSES: {
  status: FileStatus;
  label: string;
  badge: string;
}[] = [
  { status: "new", label: "Nuevos", badge: "badge-success" },
  { status: "modified", label: "Modificados", badge: "badge-warning" },
  { status: "deleted", label: "A borrar", badge: "badge-error" },
  { status: "excluded", label: "Excluidos", badge: "badge-neutral" },
  { status: "unchanged", label: "Sin cambios", badge: "badge-ghost" },
];

const STATUS_LABEL: Record<FileStatus, string> = {
  new: "Nuevo",
  modified: "Modificado",
  deleted: "A borrar",
  excluded: "Excluido",
  unchanged: "Sin cambios",
};

const helper = createColumnHelper<typeof features, FileEntry>();

const columns = helper.columns([
  helper.accessor("status", {
    header: "Estado",
    sortFn: "text",
    cell: ({ getValue }) => {
      const status = getValue();
      const badge = STATUSES.find((item) => item.status === status)?.badge;
      return (
        <span className={`badge badge-soft badge-sm ${badge}`}>
          {STATUS_LABEL[status]}
        </span>
      );
    },
  }),
  helper.accessor("path", {
    header: "Archivo",
    sortFn: "text",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs break-all">{getValue()}</span>
    ),
  }),
  helper.accessor((entry) => entry.sourceSize ?? undefined, {
    id: "sourceSize",
    header: "Publicación",
    sortUndefined: "last",
    cell: ({ row }) => formatBytes(row.original.sourceSize),
  }),
  helper.accessor((entry) => entry.targetSize ?? undefined, {
    id: "targetSize",
    header: "Servidor",
    sortUndefined: "last",
    cell: ({ row }) => formatBytes(row.original.targetSize),
  }),
]);

// Por defecto solo se ve lo que el despliegue cambiaría.
const DEFAULT_VISIBLE: FileStatus[] = ["new", "modified", "deleted"];

export function ComparisonTable({ comparison }: { comparison: Comparison }) {
  const [visible, setVisible] = useState<FileStatus[]>(DEFAULT_VISIBLE);
  const [search, setSearch] = useState("");

  const data = useMemo(() => {
    const text = search.trim().toLowerCase();
    return comparison.entries.filter(
      (entry) =>
        visible.includes(entry.status) &&
        (text === "" || entry.path.toLowerCase().includes(text)),
    );
  }, [comparison.entries, visible, search]);

  const table = useTable({
    features,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  });

  const toggle = (status: FileStatus) =>
    setVisible((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status],
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            aria-pressed={visible.includes(status)}
            className={`btn btn-sm ${visible.includes(status) ? "btn-active" : "btn-ghost"}`}
            onClick={() => toggle(status)}
          >
            {label}
            <span className="badge badge-sm">{comparison.counts[status]}</span>
          </button>
        ))}
        <input
          type="search"
          className="input input-sm ml-auto w-64"
          placeholder="Buscar archivo"
          aria-label="Buscar archivo"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {data.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          Ningún archivo coincide con los filtros.
        </p>
      ) : (
        <DataTable table={table} itemsLabel="archivos" />
      )}
    </div>
  );
}
