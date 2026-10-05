import { useState, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import { open } from "@tauri-apps/plugin-dialog";
import { ErrorAlert, requiredText, TextField } from "@/components/form";
import type { ProfileInput } from "@/lib/api";

interface ProfileFormProps {
  initial?: ProfileInput;
  submitLabel: string;
  onSubmit: (input: ProfileInput) => Promise<unknown>;
  /** Botones adicionales que se muestran antes del de enviar. */
  secondaryAction?: ReactNode;
}

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
  secondaryAction,
}: ProfileFormProps) {
  const [submitError, setSubmitError] = useState<unknown>(null);

  const form = useForm({
    defaultValues: initial ?? { name: "", sourcePath: "" },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onSubmit({
          name: value.name.trim(),
          sourcePath: value.sourcePath.trim(),
        });
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  async function browse() {
    const selected = await open({
      directory: true,
      title: "Carpeta de publicación",
    });
    if (selected) {
      form.setFieldValue("sourcePath", selected);
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
      <form.Field
        name="name"
        validators={{ onChange: requiredText("El nombre es obligatorio") }}
      >
        {(field) => (
          <TextField
            field={field}
            label="Nombre"
            placeholder="ERP Clave"
            hint="Para distinguirlo si publicas más de una aplicación."
          />
        )}
      </form.Field>

      <form.Field
        name="sourcePath"
        validators={{
          onChange: requiredText("La carpeta de publicación es obligatoria"),
        }}
      >
        {(field) => (
          <TextField
            field={field}
            label="Carpeta de publicación"
            hint="Carpeta de este equipo donde se generan los archivos al publicar."
            action={
              <button type="button" className="btn" onClick={browse}>
                Examinar
              </button>
            }
          />
        )}
      </form.Field>

      <ErrorAlert error={submitError} />

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <div className="mt-2 flex justify-end gap-2">
            {secondaryAction}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <span className="loading loading-spinner loading-sm" />
              )}
              {submitLabel}
            </button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
