import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, ErrorAlert, ProgressBar } from "@/components/form";
import {
  backupsQuery,
  createBackup,
  deploymentsQuery,
  profileQuery,
  profilesQuery,
  restoreBackup,
  type Backup,
  type Progress,
  type RestoreStats,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

export function CreateBackupDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: profiles = [] } = useQuery(profilesQuery);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Con un solo perfil no hace falta elegirlo.
  const selectedProfileId =
    profileId ?? (profiles.length === 1 ? profiles[0].id : null);
  const { data: profile } = useQuery({
    ...profileQuery(selectedProfileId ?? 0),
    enabled: selectedProfileId !== null,
  });
  const servers = profile?.servers ?? [];

  const form = useForm({
    defaultValues: { serverId: "", note: "", includeExcluded: true },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      setProgress(null);
      try {
        await createBackup(
          Number(value.serverId),
          value.note,
          value.includeExcluded,
          setProgress,
        );
        await queryClient.invalidateQueries({ queryKey: backupsQuery.queryKey });
        onClose();
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Dialog title="Crear backup" onClose={onClose} locked={isSubmitting}>
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Perfil</legend>
              <select
                className="select w-full"
                value={selectedProfileId ?? ""}
                disabled={isSubmitting}
                onChange={(event) => {
                  setProfileId(Number(event.target.value));
                  form.setFieldValue("serverId", "");
                }}
              >
                <option value="" disabled>
                  Elige un perfil
                </option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </fieldset>

            <form.Field name="serverId">
              {(field) => (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Servidor</legend>
                  <select
                    className="select w-full"
                    value={field.state.value}
                    disabled={isSubmitting || servers.length === 0}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="" disabled>
                      {selectedProfileId !== null && servers.length === 0
                        ? "Este perfil no tiene servidores"
                        : "Elige un servidor"}
                    </option>
                    {servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </fieldset>
              )}
            </form.Field>

            <form.Field name="note">
              {(field) => (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Nota (opcional)</legend>
                  <input
                    className="input w-full"
                    placeholder="Antes de subir los cambios de facturación"
                    value={field.state.value}
                    disabled={isSubmitting}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </fieldset>
              )}
            </form.Field>

            <form.Field name="includeExcluded">
              {(field) => (
                <label className="label mt-2 items-start whitespace-normal">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-0.5"
                    checked={field.state.value}
                    disabled={isSubmitting}
                    onChange={(event) =>
                      field.handleChange(event.target.checked)
                    }
                  />
                  <span>
                    Incluir también los archivos excluidos. Desmárcalo si hay
                    carpetas excluidas muy grandes, como registros o subidas.
                  </span>
                </label>
              )}
            </form.Field>

            {isSubmitting && (
              <div className="mt-3">
                <ProgressBar progress={progress} />
              </div>
            )}
            <ErrorAlert error={submitError} />

            <form.Subscribe selector={(state) => state.values.serverId}>
              {(serverId) => (
                <div className="modal-action">
                  <button
                    type="button"
                    className="btn"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isSubmitting || serverId === ""}
                  >
                    Crear backup
                  </button>
                </div>
              )}
            </form.Subscribe>
          </form>
        </Dialog>
      )}
    </form.Subscribe>
  );
}

interface RestoreBackupDialogProps {
  backup: Backup;
  onClose: () => void;
}

export function RestoreBackupDialog({
  backup,
  onClose,
}: RestoreBackupDialogProps) {
  const queryClient = useQueryClient();
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RestoreStats | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function restore() {
    setRunning(true);
    setError(null);
    setProgress(null);
    try {
      setResult(await restoreBackup(backup.id, includeExcluded, setProgress));
    } catch (cause) {
      setError(cause);
    } finally {
      setRunning(false);
      // El servidor ha cambiado: las comparaciones hechas ya no valen.
      queryClient.removeQueries({ queryKey: ["comparison"] });
      void queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey });
    }
  }

  return (
    <Dialog title="Restaurar backup" onClose={onClose} locked={running}>
      {result ? (
        <>
          <div role="status" className="alert alert-success alert-soft">
            Restauración completada: {result.restored} archivos restaurados,{" "}
            {result.deleted} borrados y {result.protected} excluidos que no se
            han tocado.
          </div>
          <div className="modal-action">
            <button className="btn" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base-content/70">
            La carpeta de <strong>{backup.serverName}</strong> volverá a estar
            como el {formatDate(backup.createdAt)}: se sobrescribirán los
            archivos del backup y se borrarán los que no estén en él.
          </p>

          {backup.complete ? (
            <label className="label mt-3 items-start whitespace-normal">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={includeExcluded}
                disabled={running}
                onChange={(event) => setIncludeExcluded(event.target.checked)}
              />
              <span>
                Restaurar también los archivos excluidos (por ejemplo
                web.config). Si no lo marcas, se quedan como están ahora en el
                servidor.
              </span>
            </label>
          ) : (
            <p className="mt-3 text-sm text-base-content/60">
              Este backup no incluye los archivos excluidos, así que se quedan
              como están ahora en el servidor.
            </p>
          )}

          {running && (
            <div className="mt-3">
              <ProgressBar progress={progress} />
            </div>
          )}
          <div className="mt-3">
            <ErrorAlert error={error} />
          </div>

          <div className="modal-action">
            <button className="btn" onClick={onClose} disabled={running}>
              Cancelar
            </button>
            <button
              className="btn btn-warning"
              onClick={() => void restore()}
              disabled={running}
            >
              Restaurar
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
