import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Page } from "@/components/page";
import { ProfileForm } from "@/components/profile-form";
import { createProfile, profilesQuery } from "@/lib/api";

export const Route = createFileRoute("/perfiles/nuevo")({
  component: NuevoPerfil,
});

function NuevoPerfil() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return (
    <Page
      title="Nuevo perfil"
      description="Después de crearlo podrás añadir sus servidores."
    >
      <section className="card card-border bg-base-100">
        <div className="card-body">
          <ProfileForm
            submitLabel="Crear perfil"
            secondaryAction={
              <Link to="/perfiles" className="btn">
                Cancelar
              </Link>
            }
            onSubmit={async (input) => {
              const id = await createProfile(input);
              await queryClient.invalidateQueries({
                queryKey: profilesQuery.queryKey,
              });
              await navigate({
                to: "/perfiles/$profileId",
                params: { profileId: String(id) },
              });
            }}
          />
        </div>
      </section>
    </Page>
  );
}
