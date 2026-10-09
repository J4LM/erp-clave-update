import { useEffect } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import {
  BackupIcon,
  DatabaseIcon,
  DeployIcon,
  HistoryIcon,
  HomeIcon,
  ProfilesIcon,
  SettingsIcon,
} from "@/components/icons";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { appInfoQuery, settingQuery } from "@/lib/api";
import { applyTheme, THEME_SETTING } from "@/lib/theme";
import { updateQuery } from "@/lib/updater";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const NAV_ITEMS = [
  { to: "/", label: "Inicio", icon: HomeIcon, exact: true },
  { to: "/perfiles", label: "Perfiles", icon: ProfilesIcon, exact: false },
  { to: "/desplegar", label: "Desplegar", icon: DeployIcon, exact: false },
  {
    to: "/bases-datos",
    label: "Bases de datos",
    icon: DatabaseIcon,
    exact: false,
  },
  { to: "/backups", label: "Backups", icon: BackupIcon, exact: false },
  { to: "/historial", label: "Historial", icon: HistoryIcon, exact: false },
  {
    to: "/configuracion",
    label: "Configuración",
    icon: SettingsIcon,
    exact: false,
  },
] as const;

function RootLayout() {
  const { data: theme } = useQuery(settingQuery(THEME_SETTING));
  const { data: appInfo } = useQuery(appInfoQuery);
  // Se comprueba al arrancar; si hay versión nueva se avisa en el menú.
  const { data: update } = useQuery(updateQuery);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-base-200">
        <div className="px-6 py-5 text-lg font-semibold">ERP Clave Update</div>
        <ul className="menu w-full grow gap-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: ItemIcon, exact }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact }}
                activeProps={{ className: "menu-active" }}
              >
                <ItemIcon />
                {label}
                {to === "/configuracion" && update && (
                  <span className="badge badge-info badge-sm">
                    Actualización
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {appInfo && (
          <div className="px-6 py-4 text-xs text-base-content/50">
            Versión {appInfo.version}
          </div>
        )}
      </aside>
      <main className="grow overflow-y-auto bg-base-100">
        <MaintenanceBanner />
        <Outlet />
      </main>
      {import.meta.env.DEV && (
        <TanStackDevtools
          plugins={[
            { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
            { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
            formDevtoolsPlugin(),
          ]}
        />
      )}
    </div>
  );
}
