import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";

export const Route = createFileRoute("/historial")({
  component: Historial,
});

function Historial() {
  return (
    <Page
      title="Historial"
      description="Registro de todos los despliegues realizados."
    >
      <EmptyState
        title="Sin despliegues"
        description="Cada despliegue quedará registrado con su fecha, versión, servidores, archivos cambiados y resultado."
      />
    </Page>
  );
}
