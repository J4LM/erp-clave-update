import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  maintenanceServersQuery,
  profilesQuery,
  setMaintenance,
  type MaintenanceServer,
} from "@/lib/api";

/**
 * Aviso, visible en todas las pantallas, de los servidores que siguen
 * mostrando la página de mantenimiento a los usuarios.
 */
export function MaintenanceBanner() {
  const { data: servers = [] } = useQuery(maintenanceServersQuery);
  if (servers.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-base-300 bg-base-200 p-4">
      {servers.map((server) => (
        <MaintenanceRow key={server.serverId} server={server} />
      ))}
    </div>
  );
}

function MaintenanceRow({ server }: { server: MaintenanceServer }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => setMaintenance(server.serverId, false),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: maintenanceServersQuery.queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: profilesQuery.queryKey }),
      ]),
  });

  return (
    <div role="alert" className="alert alert-warning alert-soft">
      <span>
        <strong>{server.serverName}</strong> ({server.profileName}) sigue en
        mantenimiento: los usuarios no pueden entrar.
        {remove.isError && (
          <span className="block text-error">
            No se pudo quitar: {String(remove.error)}
          </span>
        )}
      </span>
      <button
        className="btn btn-sm"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending && (
          <span className="loading loading-spinner loading-xs" />
        )}
        Quitar mantenimiento
      </button>
    </div>
  );
}
