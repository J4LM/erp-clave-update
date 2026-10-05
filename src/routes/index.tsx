import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  DeploymentStatus,
  kindLabel,
} from "@/components/deployment-status";
import { EmptyState, Page } from "@/components/page";
import { deploymentsQuery, profilesQuery } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profilesQuery),
  component: Index,
});

function Index() {
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const { data: deployments = [] } = useQuery(deploymentsQuery);
  const recent = deployments.slice(0, 5);
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

      {profiles.length > 0 && (
        <section className="card card-border bg-base-100">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Última actividad</h2>
              {recent.length > 0 && (
                <Link to="/historial" className="btn btn-sm btn-ghost">
                  Ver historial
                </Link>
              )}
            </div>
            {recent.length === 0 ? (
              <p className="py-4 text-center text-base-content/60">
                Todavía no se ha desplegado nada.
              </p>
            ) : (
              <ul className="list">
                {recent.map((deployment) => (
                  <li key={deployment.id} className="list-row items-center">
                    <div className="list-col-grow min-w-0">
                      <div className="font-medium">
                        {kindLabel(deployment)} en {deployment.serverName}
                      </div>
                      <div className="truncate text-xs text-base-content/60">
                        {formatDate(deployment.startedAt)} ·{" "}
                        {deployment.profileName}
                        {deployment.note && ` · ${deployment.note}`}
                      </div>
                    </div>
                    <DeploymentStatus deployment={deployment} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </Page>
  );
}
