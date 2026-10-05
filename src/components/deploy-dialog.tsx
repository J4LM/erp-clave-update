import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, ErrorAlert, ProgressBar } from "@/components/form";
import {
  backupsQuery,
  comparisonQuery,
  deployBackupSetting,
  deployMaintenanceSetting,
  deploymentsQuery,
  deployServer,
  setSetting,
  type Comparison,
  type Deployment,
  type DeployPhase,
  type DeployProgress,
  type Server,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";

const PHASE_LABEL: Record<DeployPhase, string> = {
  connecting: "Conectando con el servidor",
  backup: "Haciendo el backup",
  comparing: "Comparando archivos",
  copying: "Copiando archivos",
  deleting: "Borrando archivos sobrantes",
  verifying: "Verificando la copia",
  restoring: "El despliegue ha fallado: restaurando el backup",
};

interface DeployDialogProps {
  profileId: number;
  server: Server;
  counts: Comparison["counts"];
  /** Opciones usadas la última vez con este perfil. */
  defaults: { backup: boolean; maintenance: boolean };
  onClose: () => void;
}

export function DeployDialog({
  profileId,
  server,
  counts,
  defaults,
  onClose,
}: DeployDialogProps) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<DeployProgress | null>(null);
  const [result, setResult] = useState<Deployment | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const form = useForm({
    defaultValues: { note: "", confirmation: "", ...defaults },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      setProgress(null);
      const { backup, maintenance } = value;
      try {
        await Promise.all([
          setSetting(deployBackupSetting(profileId), String(backup)),
          setSetting(deployMaintenanceSetting(profileId), String(maintenance)),
        ]);
        setResult(
          await deployServer(
            profileId,
            server.id,
            { note: value.note, backup, maintenance },
            setProgress,
          ),
        );
      } catch (error) {
        setSubmitError(error);
      }
      // El servidor ha podido cambiar aunque el despliegue fallara.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: backupsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: ["setting"] }),
        // La comparación solo se hace a petición, así que se pide de nuevo aquí.
        queryClient
          .fetchQuery({
            ...comparisonQuery(profileId, server.id),
            staleTime: 0,
          })
          .catch(() => undefined),
      ]);
    },
  });

  if (result) {
    return (
      <Dialog title={`Despliegue en ${server.name}`} onClose={onClose}>
        <DeployResult deployment={result} />
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Dialog
          title={`Desplegar en ${server.name}`}
          onClose={onClose}
          locked={isSubmitting}
        >
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <p className="text-base-content/70">
              Se copiarán {counts.new + counts.modified} archivos (
              {formatBytes(counts.bytesToCopy)}) y se borrarán {counts.deleted}
              . Los {counts.excluded} excluidos no se tocan. La comparación se
              repite justo antes de copiar.
            </p>

            <form.Field name="note">
              {(field) => (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Nota (opcional)</legend>
                  <input
                    className="input w-full"
                    placeholder="Qué incluye esta actualización"
                    value={field.state.value}
                    disabled={isSubmitting}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </fieldset>
              )}
            </form.Field>

            <form.Field name="backup">
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
                    Hacer un backup antes. Si el despliegue falla, el servidor
                    se restaura solo.
                  </span>
                </label>
              )}
            </form.Field>

            <form.Field name="maintenance">
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
                    Mostrar una página de mantenimiento mientras dura. Los
                    usuarios verán un aviso en lugar de posibles errores.
                  </span>
                </label>
              )}
            </form.Field>

            <form.Field name="confirmation">
              {(field) => (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">
                    Escribe «{server.name}» para confirmar
                  </legend>
                  <input
                    className="input w-full"
                    autoComplete="off"
                    spellCheck={false}
                    value={field.state.value}
                    disabled={isSubmitting}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </fieldset>
              )}
            </form.Field>

            {isSubmitting && (
              <div className="mt-3 flex flex-col gap-1">
                <div className="text-sm font-medium">
                  {progress ? PHASE_LABEL[progress.phase] : "Preparando"}
                </div>
                <ProgressBar
                  progress={progress && progress.total > 0 ? progress : null}
                />
              </div>
            )}
            <ErrorAlert error={submitError} />

            <form.Subscribe selector={(state) => state.values.confirmation}>
              {(confirmation) => (
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
                    disabled={
                      isSubmitting ||
                      confirmation.trim().toLowerCase() !==
                        server.name.trim().toLowerCase()
                    }
                  >
                    Desplegar
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

function DeployResult({ deployment }: { deployment: Deployment }) {
  if (deployment.status === "ok") {
    return (
      <div role="status" className="alert alert-success alert-soft">
        Despliegue completado y verificado: {deployment.copied} archivos
        copiados ({formatBytes(deployment.bytesCopied)}) y {deployment.deleted}{" "}
        borrados.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div
        role="alert"
        className={`alert alert-soft ${deployment.status === "restored" ? "alert-warning" : "alert-error"}`}
      >
        {deployment.status === "restored"
          ? "El despliegue ha fallado y el servidor se ha restaurado con el backup previo. Está como antes de empezar."
          : "El despliegue ha fallado y el servidor puede haber quedado a medias. Revísalo o restaura un backup."}
      </div>
      {deployment.error && (
        <p className="text-sm break-words text-base-content/70">
          {deployment.error}
        </p>
      )}
    </div>
  );
}
