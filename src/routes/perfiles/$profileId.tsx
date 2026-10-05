import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ExclusionsCard } from "@/components/exclusions-card";
import { ConfirmDialog } from "@/components/form";
import { EmptyState, Page } from "@/components/page";
import { ProfileForm } from "@/components/profile-form";
import { ServerDialog } from "@/components/server-dialog";
import {
  appInfoQuery,
  deleteProfile,
  deleteServer,
  profileQuery,
  profilesQuery,
  testServer,
  updateProfile,
  type ConnectionTest,
  type Server,
} from "@/lib/api";

export const Route = createFileRoute("/perfiles/$profileId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      profileQuery(Number(params.profileId)),
    ),
  component: Perfil,
  errorComponent: ({ error }) => (
    <Page title="Perfil" description="No se pudo abrir el perfil.">
      <EmptyState
        title="Perfil no disponible"
        description={error instanceof Error ? error.message : String(error)}
        action={
          <Link to="/perfiles" className="btn">
            Volver a Perfiles
          </Link>
        }
      />
    </Page>
  ),
});

type ServerEditor = { mode: "new" } | { mode: "edit"; server: Server };

function Perfil() {
  const profileId = Number(Route.useParams().profileId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useSuspenseQuery(profileQuery(profileId));
  const { data: appInfo } = useQuery(appInfoQuery);

  const [editor, setEditor] = useState<ServerEditor | null>(null);
  const [serverToDelete, setServerToDelete] = useState<Server | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState(false);
  const [saved, setSaved] = useState(false);

  const invalidateProfiles = () =>
    queryClient.invalidateQueries({ queryKey: profilesQuery.queryKey });

  const removeProfile = useMutation({
    mutationFn: () => deleteProfile(profileId),
    onSuccess: async () => {
      await navigate({ to: "/perfiles" });
      queryClient.removeQueries({ queryKey: profileQuery(profileId).queryKey });
      await invalidateProfiles();
    },
  });

  const removeServer = useMutation({
    mutationFn: (server: Server) => deleteServer(server.id),
    onSuccess: async () => {
      await invalidateProfiles();
      setServerToDelete(null);
    },
  });

  const addressExample =
    appInfo?.os === "windows"
      ? "\\\\servidor\\recurso\\carpeta"
      : "smb://servidor/recurso/carpeta";

  return (
    <Page
      title={profile.name}
      description="Carpeta de publicación y servidores de destino."
      actions={
        <Link to="/perfiles" className="btn btn-ghost">
          Volver
        </Link>
      }
    >
      {!profile.sourceExists && (
        <div role="alert" className="alert alert-warning alert-soft">
          La carpeta de publicación no existe en este equipo. Publica el ERP o
          corrige la ruta antes de desplegar.
        </div>
      )}

      <section className="card card-border bg-base-100">
        <div className="card-body">
          <h2 className="card-title">Datos del perfil</h2>
          <ProfileForm
            // Se vuelve a montar con los valores nuevos después de guardar.
            key={`${profile.name}|${profile.sourcePath}`}
            initial={{ name: profile.name, sourcePath: profile.sourcePath }}
            submitLabel="Guardar cambios"
            secondaryAction={
              saved && (
                <span className="self-center text-sm text-success">
                  Cambios guardados
                </span>
              )
            }
            onSubmit={async (input) => {
              setSaved(false);
              await updateProfile(profileId, input);
              await invalidateProfiles();
              setSaved(true);
            }}
          />
        </div>
      </section>

      <section className="card card-border bg-base-100">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Servidores</h2>
            <button className="btn btn-sm" onClick={() => setEditor({ mode: "new" })}>
              Añadir servidor
            </button>
          </div>
          {profile.servers.length === 0 ? (
            <p className="py-6 text-center text-base-content/60">
              Este perfil aún no tiene servidores. Añade las carpetas de red
              donde se copia la publicación.
            </p>
          ) : (
            <ul className="list">
              {profile.servers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  onEdit={() => setEditor({ mode: "edit", server })}
                  onDelete={() => {
                    removeServer.reset();
                    setServerToDelete(server);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <ExclusionsCard profile={profile} />

      <section className="card card-border bg-base-100">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">Eliminar perfil</h2>
            <p className="text-sm text-base-content/60">
              Borra el perfil, sus servidores y sus contraseñas guardadas. No
              toca ningún archivo.
            </p>
          </div>
          <button
            className="btn btn-error btn-outline"
            onClick={() => {
              removeProfile.reset();
              setConfirmDeleteProfile(true);
            }}
          >
            Eliminar
          </button>
        </div>
      </section>

      {editor && (
        <ServerDialog
          profileId={profileId}
          server={editor.mode === "edit" ? editor.server : undefined}
          addressExample={addressExample}
          onClose={() => setEditor(null)}
        />
      )}

      {serverToDelete && (
        <ConfirmDialog
          title="Eliminar servidor"
          message={`Se quitará "${serverToDelete.name}" de este perfil y se borrará su contraseña guardada. Los archivos del servidor no se tocan.`}
          confirmLabel="Eliminar"
          isPending={removeServer.isPending}
          error={removeServer.error}
          onConfirm={() => removeServer.mutate(serverToDelete)}
          onClose={() => setServerToDelete(null)}
        />
      )}

      {confirmDeleteProfile && (
        <ConfirmDialog
          title="Eliminar perfil"
          message={`Se eliminará "${profile.name}" con todos sus servidores. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar perfil"
          isPending={removeProfile.isPending}
          error={removeProfile.error}
          onConfirm={() => removeProfile.mutate()}
          onClose={() => setConfirmDeleteProfile(false)}
        />
      )}
    </Page>
  );
}

interface ServerRowProps {
  server: Server;
  onEdit: () => void;
  onDelete: () => void;
}

function ServerRow({ server, onEdit, onDelete }: ServerRowProps) {
  const test = useMutation<ConnectionTest, unknown>({
    mutationFn: () => testServer(server.id),
  });
  const failure = test.isError
    ? String(test.error)
    : test.data && !test.data.ok
      ? test.data.message
      : null;

  return (
    <li className="list-row items-center">
      <div className="list-col-grow min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {server.name}
          {test.data?.ok && (
            <span className="badge badge-success badge-soft badge-sm">
              Conexión correcta
            </span>
          )}
          {failure && (
            <span className="badge badge-error badge-soft badge-sm">
              Sin conexión
            </span>
          )}
        </div>
        <div className="truncate font-mono text-xs text-base-content/60">
          {server.address}
        </div>
        <div className="text-xs text-base-content/60">
          {server.username
            ? `Usuario ${server.username}${server.hasPassword ? "" : " (sin contraseña)"}`
            : "Sin credenciales"}
        </div>
        {failure && <div className="mt-1 text-xs text-error">{failure}</div>}
      </div>
      <button
        className="btn btn-sm"
        onClick={() => test.mutate()}
        disabled={test.isPending}
      >
        {test.isPending && (
          <span className="loading loading-spinner loading-xs" />
        )}
        Probar conexión
      </button>
      <button className="btn btn-sm btn-ghost" onClick={onEdit}>
        Editar
      </button>
      <button className="btn btn-sm btn-ghost text-error" onClick={onDelete}>
        Eliminar
      </button>
    </li>
  );
}
