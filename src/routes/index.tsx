import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, Page } from "@/components/page";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <Page
      title="Inicio"
      description="Estado de los perfiles y de los últimos despliegues."
    >
      <EmptyState
        title="Todavía no hay perfiles"
        description="Un perfil une la carpeta de publicación del ERP con los servidores donde se copia. Crea el primero para poder desplegar."
        action={
          <Link to="/configuracion" className="btn btn-primary">
            Ir a Configuración
          </Link>
        }
      />
    </Page>
  );
}
