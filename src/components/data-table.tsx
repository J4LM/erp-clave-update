import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  type ReactTable,
  type RowData,
} from "@tanstack/react-table";

/** Funciones de tabla comunes a toda la app: ordenación y paginación. */
export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export type AppFeatures = typeof features;

export const PAGE_SIZE = 50;

interface DataTableProps<TData extends RowData> {
  table: ReactTable<AppFeatures, TData>;
  /** Nombre en plural de lo que se lista, para el pie de la tabla. */
  itemsLabel: string;
}

/** Pinta una tabla con cabeceras ordenables y paginación. */
export function DataTable<TData extends RowData>({
  table,
  itemsLabel,
}: DataTableProps<TData>) {
  const { pageIndex } = table.state.pagination;
  const pageCount = table.getPageCount();

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  if (!header.column.getCanSort()) {
                    return (
                      <th key={header.id}>
                        <table.FlexRender header={header} />
                      </th>
                    );
                  }
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id}>
                      <button
                        type="button"
                        className="cursor-pointer"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" && " ↑"}
                        {sorted === "desc" && " ↓"}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-base-content/60">
            {table.getRowCount()} {itemsLabel} · página {pageIndex + 1} de{" "}
            {pageCount}
          </span>
          <div className="join">
            <button
              className="btn btn-sm join-item"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Anterior
            </button>
            <button
              className="btn btn-sm join-item"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
