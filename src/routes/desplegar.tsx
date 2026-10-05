import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ComparisonTable } from "@/components/comparison-table";
import { EmptyState, Page } from "@/components/page";
import {
  comparisonQuery,
  profileQuery,
  profilesQuery,
  type Server,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";

interface DesplegarSearch {
  perfil?: number;
}

export const Route = createFileRoute("/desplegar")({
  validateSearch: (search): DesplegarSearch => {
    const perfil = Number(search.perfil);
    return Number.isInteger(perfil) && perfil > 0 ? { perfil } : {};
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(profilesQuery),
  component: Desplegar,
});

function Desplegar() {
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Con un solo perfil no hace falta elegirlo.
  const profileId =
    search.perfil ?? (profiles.length === 1 ? profiles[0].id : undefined);

  if (profiles.length === 0) {
    return (
      <Page
        title="Desplegar"
        description="Compara la publicación con cada servidor y copia los cambios."
      >
        <EmptyState
          title="Nada que desplegar"
          description="Crea un perfil con su carpeta de publicación y sus servidores para poder comparar."
          action={
            <Link to="/perfiles/nuevo" className="btn btn-primary">
              Crear perfil
            </Link>
          }
        />
      </Page>
    );
  }

  return (
    <Page
      title="Desplegar"
      description="Compara la publicación con cada servidor antes de copiar nada."
      actions={
        <select
          className="select w-64"
          aria-label="Perfil"
          value={profileId ?? ""}
          onChange={(event) =>
            void navigate({
              search: { perfil: Number(event.target.value) || undefined },
            })
          }
        >
          <option value="" disabled>
            Elige un perfil
          </option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      }
    >
      {profileId === undefined ? (
        <EmptyState
          title="Elige un perfil"
          description="Selecciona arriba el perfil que quieres comparar con sus servidores."
        />
      ) : (
        <ProfileComparison key={profileId} profileId={profileId} />
      )}
    </Page>
  );
}

function ProfileComparison({ profileId }: { profileId: number }) {
  const { data: profile, error } = useQuery(profileQuery(profileId));

  if (error) {
    return (
      <div role="alert" className="alert alert-error alert-soft">
        {String(error)}
      </div>
    );
  }
  if (!profile) return null;

  if (!profile.sourceExists) {
    return (
      <div role="alert" className="alert alert-warning alert-soft">
        La carpeta de publicación no existe en este equipo:{" "}
        <span className="font-mono">{profile.sourcePath}</span>
      </div>
    );
  }
  if (profile.servers.length === 0) {
    return (
      <EmptyState
        title="Este perfil no tiene servidores"
        description="Añade al menos un servidor al perfil para poder comparar."
        action={
          <Link
            to="/perfiles/$profileId"
            params={{ profileId: String(profile.id) }}
            className="btn"
          >
            Abrir perfil
          </Link>
        }
      />
    );
  }

  return (
    <>
      <p className="text-sm text-base-content/60">
        Publicación: <span className="font-mono">{profile.sourcePath}</span>
      </p>
      {profile.servers.map((server) => (
        <ServerComparison
          key={server.id}
          profileId={profile.id}
          server={server}
        />
      ))}
    </>
  );
}

interface ServerComparisonProps {
  profileId: number;
  server: Server;
}

function ServerComparison({ profileId, server }: ServerComparisonProps) {
  // Solo se compara cuando se pide; el resultado se conserva al cambiar de página.
  const comparison = useQuery({
    ...comparisonQuery(profileId, server.id),
    enabled: false,
  });
  const counts = comparison.data?.counts;
  const changes = counts
    ? counts.new + counts.modified + counts.deleted
    : null;

  return (
    <section className="card card-border bg-base-100">
      <div className="card-body">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="card-title">{server.name}</h2>
            <div className="truncate font-mono text-xs text-base-content/60">
              {server.address}
            </div>
          </div>
          <button
            className="btn btn-sm"
            disabled={comparison.isFetching}
            onClick={() => void comparison.refetch()}
          >
            {comparison.isFetching && (
              <span className="loading loading-spinner loading-xs" />
            )}
            {comparison.data ? "Volver a comparar" : "Comparar"}
          </button>
        </div>

        {comparison.isFetching && !comparison.data && (
          <p className="py-6 text-center text-base-content/60">
            Comparando archivos con el servidor…
          </p>
        )}

        {comparison.isError && !comparison.isFetching && (
          <div role="alert" className="alert alert-error alert-soft">
            {String(comparison.error)}
          </div>
        )}

        {comparison.data && counts && (
          <>
            <div
              role="status"
              className={`alert alert-soft ${changes === 0 ? "alert-success" : "alert-info"}`}
            >
              {changes === 0
                ? "El servidor ya está al día: no hay nada que copiar ni borrar."
                : `Un despliegue copiaría ${counts.new + counts.modified} archivos (${formatBytes(counts.bytesToCopy)}) y borraría ${counts.deleted}.`}
            </div>
            <ComparisonTable comparison={comparison.data} />
          </>
        )}
      </div>
    </section>
  );
}
