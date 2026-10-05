import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ErrorAlert, TextField } from "@/components/form";
import {
  BACKUP_DIR_SETTING,
  BACKUP_KEEP_SETTING,
  setSetting,
  settingQuery,
} from "@/lib/api";

interface BackupSettingsProps {
  /** Valores guardados; la carpeta vacía significa usar la predeterminada. */
  initial: { dir: string; keep: string };
  defaultDir: string;
}

const validKeep = ({ value }: { value: string }) =>
  /^\d+$/.test(value.trim()) ? undefined : "Escribe un número, o 0 para no borrar ninguno";

export function BackupSettings({ initial, defaultDir }: BackupSettingsProps) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      setSaved(false);
      try {
        await setSetting(BACKUP_DIR_SETTING, value.dir.trim());
        await setSetting(BACKUP_KEEP_SETTING, String(Number(value.keep)));
        await Promise.all(
          [BACKUP_DIR_SETTING, BACKUP_KEEP_SETTING].map((key) =>
            queryClient.invalidateQueries({
              queryKey: settingQuery(key).queryKey,
            }),
          ),
        );
        setSaved(true);
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  async function browse() {
    const selected = await open({ directory: true, title: "Carpeta de backups" });
    if (selected) {
      form.setFieldValue("dir", selected);
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="dir">
        {(field) => (
          <TextField
            field={field}
            label="Carpeta de backups"
            placeholder={defaultDir}
            hint="Déjalo vacío para usar la carpeta predeterminada. Los backups ya hechos no se mueven."
            action={
              <button type="button" className="btn" onClick={browse}>
                Examinar
              </button>
            }
          />
        )}
      </form.Field>

      <form.Field name="keep" validators={{ onChange: validKeep }}>
        {(field) => (
          <TextField
            field={field}
            label="Backups que se conservan por servidor"
            hint="Al crear uno nuevo se borran los más antiguos que sobren. Con 0 no se borra ninguno."
          />
        )}
      </form.Field>

      <ErrorAlert error={submitError} />

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <div className="mt-2 flex items-center justify-end gap-3">
            {saved && (
              <span className="text-sm text-success">Cambios guardados</span>
            )}
            <button type="submit" className="btn" disabled={isSubmitting}>
              Guardar
            </button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
