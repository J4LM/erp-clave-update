import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { ErrorAlert } from "@/components/form";
import { formatBytes } from "@/lib/format";
import { updateQuery } from "@/lib/updater";

export function UpdatesCard({ currentVersion }: { currentVersion: string }) {
  const update = useQuery(updateQuery);
  const [installing, setInstalling] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [installError, setInstallError] = useState<unknown>(null);

  async function install() {
    if (!update.data) return;
    setInstalling(true);
    setInstallError(null);
    setDownloaded(0);
    try {
      await update.data.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
        } else if (event.event === "Progress") {
          setDownloaded((current) => current + event.data.chunkLength);
        }
      });
      // En Windows el instalador cierra la app; en macOS hay que reiniciarla.
      await relaunch();
    } catch (error) {
      setInstallError(error);
      setInstalling(false);
    }
  }

  return (
    <section className="card card-border bg-base-100">
      <div className="card-body">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="card-title">Actualizaciones</h2>
            <p className="text-sm text-base-content/60">
              Versión instalada: {currentVersion}
            </p>
          </div>
          {!installing && (
            <button
              className="btn btn-sm"
              disabled={update.isFetching || import.meta.env.DEV}
              onClick={() => void update.refetch()}
            >
              {update.isFetching && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Buscar actualizaciones
            </button>
          )}
        </div>

        {import.meta.env.DEV && (
          <p className="text-sm text-base-content/60">
            En desarrollo no se buscan actualizaciones.
          </p>
        )}

        {update.isError && !update.isFetching && (
          <div role="alert" className="alert alert-warning alert-soft">
            No se pudo comprobar si hay actualizaciones: {String(update.error)}
          </div>
        )}

        {update.isSuccess && update.data === null && !update.isFetching && (
          <div role="status" className="alert alert-success alert-soft">
            La aplicación está al día.
          </div>
        )}

        {update.data && (
          <div className="flex flex-col gap-3">
            <div role="status" className="alert alert-info alert-soft">
              Hay una versión nueva: {update.data.version}
            </div>
            {update.data.body && (
              <p className="text-sm whitespace-pre-wrap text-base-content/70">
                {update.data.body}
              </p>
            )}
            {installing ? (
              <div className="flex flex-col gap-1">
                <progress
                  className="progress w-full"
                  value={total ? downloaded : undefined}
                  max={total ?? undefined}
                />
                <span className="text-xs text-base-content/60">
                  Descargando {formatBytes(downloaded)}
                  {total ? ` de ${formatBytes(total)}` : ""}. La aplicación se
                  reiniciará al terminar.
                </span>
              </div>
            ) : (
              <div className="flex justify-end">
                <button
                  className="btn btn-primary"
                  onClick={() => void install()}
                >
                  Instalar y reiniciar
                </button>
              </div>
            )}
            <ErrorAlert error={installError} />
          </div>
        )}
      </div>
    </section>
  );
}
