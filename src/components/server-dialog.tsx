import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  ErrorAlert,
  requiredText,
  TextField,
} from "@/components/form";
import {
  createServer,
  profilesQuery,
  updateServer,
  type Server,
} from "@/lib/api";

interface ServerDialogProps {
  profileId: number;
  /** Servidor que se edita; se omite para crear uno nuevo. */
  server?: Server;
  addressExample: string;
  onClose: () => void;
}

export function ServerDialog({
  profileId,
  server,
  addressExample,
  onClose,
}: ServerDialogProps) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const form = useForm({
    defaultValues: {
      name: server?.name ?? "",
      address: server?.address ?? "",
      username: server?.username ?? "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const username = value.username.trim();
      const input = {
        name: value.name.trim(),
        address: value.address.trim(),
        username: username || null,
      };
      // Sin usuario no hay nada que autenticar, así que se descarta la contraseña
      // guardada; con usuario, el campo vacío conserva la que ya había.
      const password = username ? value.password || null : "";
      try {
        if (server) {
          await updateServer(server.id, input, password);
        } else {
          await createServer(profileId, input, password);
        }
        await queryClient.invalidateQueries({
          queryKey: profilesQuery.queryKey,
        });
        onClose();
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  return (
    <Dialog
      title={server ? "Editar servidor" : "Nuevo servidor"}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-1"
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
            <TextField field={field} label="Nombre" placeholder="Producción" />
          )}
        </form.Field>

        <form.Field
          name="address"
          validators={{
            onChange: requiredText("La dirección es obligatoria"),
          }}
        >
          {(field) => (
            <TextField
              field={field}
              label="Carpeta de red"
              placeholder={addressExample}
              hint="Carpeta del servidor donde se copian los archivos."
            />
          )}
        </form.Field>

        <form.Field name="username">
          {(field) => (
            <TextField
              field={field}
              label="Usuario (opcional)"
              placeholder="DOMINIO\usuario"
              hint="Déjalo vacío si la carpeta no pide credenciales."
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <TextField
              field={field}
              label="Contraseña"
              type="password"
              hint={
                server?.hasPassword
                  ? "Hay una contraseña guardada. Déjalo vacío para conservarla."
                  : "Se guarda en el almacén de credenciales del sistema."
              }
            />
          )}
        </form.Field>

        <ErrorAlert error={submitError} />

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
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
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <span className="loading loading-spinner loading-sm" />
                )}
                Guardar
              </button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </Dialog>
  );
}
