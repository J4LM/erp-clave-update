import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorAlert, requiredText, TextField } from "@/components/form";
import {
  erpDatabasesQuery,
  saveSqlConfig,
  sqlConfigQuery,
  testSqlConnection,
  type SqlConfig,
} from "@/lib/api";

export function SqlSettings({ config }: { config: SqlConfig }) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const test = useMutation({ mutationFn: testSqlConnection });

  const form = useForm({
    defaultValues: {
      host: config.host,
      database: config.database,
      username: config.username,
      password: "",
      procedure: config.procedure,
      scriptsDir: config.scriptsDir,
    },
    onSubmit: async ({ value, formApi }) => {
      setSubmitError(null);
      setSaved(false);
      test.reset();
      const { password, ...input } = value;
      try {
        // El campo vacío conserva la contraseña guardada.
        await saveSqlConfig(input, password || null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: sqlConfigQuery.queryKey }),
          queryClient.invalidateQueries({
            queryKey: erpDatabasesQuery.queryKey,
          }),
        ]);
        formApi.setFieldValue("password", "");
        setSaved(true);
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-base-content/60">
        Servidor donde está el procedimiento que ejecuta los scripts en las
        bases de datos de los clientes.
      </p>

      <div className="grid grid-cols-2 gap-x-4">
        <form.Field
          name="host"
          validators={{ onChange: requiredText("El servidor es obligatorio") }}
        >
          {(field) => (
            <TextField
              field={field}
              label="Servidor"
              placeholder="servidor o servidor\instancia"
              hint="Con otro puerto: servidor,puerto"
            />
          )}
        </form.Field>
        <form.Field
          name="database"
          validators={{
            onChange: requiredText("La base de datos es obligatoria"),
          }}
        >
          {(field) => <TextField field={field} label="Base de datos" />}
        </form.Field>
        <form.Field
          name="username"
          validators={{ onChange: requiredText("El usuario es obligatorio") }}
        >
          {(field) => <TextField field={field} label="Usuario" />}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <TextField
              field={field}
              label="Contraseña"
              type="password"
              hint={
                config.hasPassword
                  ? "Hay una contraseña guardada. Déjalo vacío para conservarla."
                  : "Se guarda en el almacén de credenciales del sistema."
              }
            />
          )}
        </form.Field>
      </div>

      <form.Field
        name="procedure"
        validators={{
          onChange: requiredText("El procedimiento es obligatorio"),
        }}
      >
        {(field) => <TextField field={field} label="Procedimiento" />}
      </form.Field>

      <form.Field
        name="scriptsDir"
        validators={{
          onChange: requiredText("La carpeta de scripts es obligatoria"),
        }}
      >
        {(field) => (
          <TextField
            field={field}
            label="Carpeta de scripts"
            placeholder="\\servidor\recurso\Script"
            hint="Carpeta de red que también ve SQL Server. Cada ejecución copia sus scripts a una subcarpeta nueva con la fecha."
          />
        )}
      </form.Field>

      <ErrorAlert error={submitError} />
      {test.isSuccess && (
        <div role="status" className="alert alert-success alert-soft">
          Conexión correcta: {test.data}
        </div>
      )}
      {test.isError && <ErrorAlert error={test.error} />}

      <form.Subscribe
        selector={(state) => [state.isSubmitting, state.isDirty] as const}
      >
        {([isSubmitting, isDirty]) => (
          <div className="mt-2 flex items-center justify-end gap-3">
            {saved && !isDirty && (
              <span className="text-sm text-success">Cambios guardados</span>
            )}
            <button
              type="button"
              className="btn"
              disabled={test.isPending || isSubmitting || isDirty}
              title={
                isDirty ? "Guarda los cambios antes de probar" : undefined
              }
              onClick={() => test.mutate()}
            >
              {test.isPending && (
                <span className="loading loading-spinner loading-sm" />
              )}
              Probar conexión
            </button>
            <button type="submit" className="btn" disabled={isSubmitting}>
              Guardar
            </button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
