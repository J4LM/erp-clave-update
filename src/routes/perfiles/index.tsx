import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";
import { profilesQuery } from "@/lib/api";

export const Route = createFileRoute("/perfiles/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profilesQuery),
  component: Perfiles,
});

function Perfiles() {
  const { data: profiles } = useSuspenseQuery(profilesQuery);

  const newProfileLink = (
    <Link to="/perfiles/nuevo" className="btn btn-primary">
      Nuevo perfil
    </Link>
  );

  return (
    <Page
      title="Perfiles"
      description="Cada perfil une una carpeta de publicación con sus servidores."
      actions={profiles.length > 0 && newProfileLink}
    >
      {profiles.length === 0 ? (
        <EmptyState
          title="Todavía no hay perfiles"
          description="Crea un perfil con la carpeta donde se publica el ERP y después añade los servidores donde se copia."
          action={newProfileLink}
        />
      ) : (
        <ul className="list rounded-box border border-base-300">
          {profiles.map((profile) => (
            <li key={profile.id} className="list-row items-center">
              <div className="list-col-grow min-w-0">
                <div className="font-medium">{profile.name}</div>
                <div className="truncate font-mono text-xs text-base-content/60">
                  {profile.sourcePath}
                </div>
              </div>
              {!profile.sourceExists && (
                <span className="badge badge-warning badge-soft">
                  Carpeta no encontrada
                </span>
              )}
              <span className="badge badge-ghost">
                {profile.serverCount === 1
                  ? "1 servidor"
                  : `${profile.serverCount} servidores`}
              </span>
              <Link
                to="/perfiles/$profileId"
                params={{ profileId: String(profile.id) }}
                className="btn btn-sm"
              >
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
