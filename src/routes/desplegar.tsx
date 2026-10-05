import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";

export const Route = createFileRoute("/desplegar")({
  component: Desplegar,
});

function Desplegar() {
  return (
    <Page
      title="Desplegar"
      description="Compara la publicación con cada servidor y copia los cambios."
    >
      <EmptyState
        title="Nada que desplegar"
        description="Cuando exista un perfil, aquí verás qué archivos se copiarán, cuáles se borrarán y cuáles se respetan antes de tocar ningún servidor."
      />
    </Page>
  );
}
