import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";

export const Route = createFileRoute("/backups")({
  component: Backups,
});

function Backups() {
  return (
    <Page
      title="Backups"
      description="Copias de las carpetas de los servidores y su restauración."
    >
      <EmptyState
        title="Sin backups"
        description="Antes de cada despliegue se guarda una copia de la carpeta del servidor. Aparecerán aquí para poder restaurarlas."
      />
    </Page>
  );
}
