import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";
import { profilesQuery } from "@/lib/api";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profilesQuery),
  component: Index,
});

function Index() {
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const serverCount = profiles.reduce(
    (total, profile) => total + profile.serverCount,
    0,
  );
  const missingSources = profiles.filter(
    (profile) => !profile.sourceExists,
  ).length;

  return (
    <Page
      title="Inicio"
      description="Estado de los perfiles y de los últimos despliegues."
    >
      {profiles.length === 0 ? (
        <EmptyState
          title="Todavía no hay perfiles"
          description="Un perfil une la carpeta de publicación del ERP con los servidores donde se copia. Crea el primero para poder desplegar."
          action={
            <Link to="/perfiles/nuevo" className="btn btn-primary">
              Crear perfil
            </Link>
          }
        />
      ) : (
        <div className="stats border border-base-300">
          <div className="stat">
            <div className="stat-title">Perfiles</div>
            <div className="stat-value">{profiles.length}</div>
            <div className="stat-actions">
              <Link to="/perfiles" className="btn btn-sm">
                Ver perfiles
              </Link>
            </div>
          </div>
          <div className="stat">
            <div className="stat-title">Servidores</div>
            <div className="stat-value">{serverCount}</div>
            <div className="stat-desc">Entre todos los perfiles</div>
          </div>
          <div className="stat">
            <div className="stat-title">Carpetas de publicación</div>
            <div className="stat-value">
              {profiles.length - missingSources}/{profiles.length}
            </div>
            <div className="stat-desc">
              {missingSources === 0
                ? "Todas accesibles"
                : `${missingSources} no encontrada(s)`}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
