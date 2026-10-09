import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BackupSettings } from "@/components/backup-settings";
import { Page } from "@/components/page";
import { SqlSettings } from "@/components/sql-settings";
import { UpdatesCard } from "@/components/updates-card";
import {
  appInfoQuery,
  BACKUP_DIR_SETTING,
  BACKUP_KEEP_SETTING,
  DEFAULT_BACKUP_KEEP,
  setSetting,
  settingQuery,
  sqlConfigQuery,
} from "@/lib/api";
import { THEME_SETTING, THEMES } from "@/lib/theme";

export const Route = createFileRoute("/configuracion")({
  component: Configuracion,
});

function Configuracion() {
  const queryClient = useQueryClient();
  const { data: theme } = useQuery(settingQuery(THEME_SETTING));
  const { data: appInfo } = useQuery(appInfoQuery);
  const backupDir = useQuery(settingQuery(BACKUP_DIR_SETTING));
  const backupKeep = useQuery(settingQuery(BACKUP_KEEP_SETTING));
  const { data: sqlConfig } = useQuery(sqlConfigQuery);

  const saveTheme = useMutation({
    mutationFn: (value: string) => setSetting(THEME_SETTING, value),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: settingQuery(THEME_SETTING).queryKey,
      }),
  });

  return (
    <Page
      title="Configuración"
      description="Preferencias de la aplicación en este equipo."
    >
      {saveTheme.isError && (
        <div role="alert" className="alert alert-error">
          No se pudo guardar el tema: {String(saveTheme.error)}
        </div>
      )}

      <section className="card card-border bg-base-100">
        <div className="card-body">
          <h2 className="card-title">Apariencia</h2>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Tema</legend>
            <select
              className="select"
              value={theme ?? "system"}
              disabled={saveTheme.isPending}
              onChange={(event) => saveTheme.mutate(event.target.value)}
            >
              {THEMES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </fieldset>
        </div>
      </section>

      {appInfo && backupDir.isSuccess && backupKeep.isSuccess && (
        <section className="card card-border bg-base-100">
          <div className="card-body">
            <h2 className="card-title">Backups</h2>
            <BackupSettings
              initial={{
                dir: backupDir.data ?? "",
                keep: backupKeep.data ?? String(DEFAULT_BACKUP_KEEP),
              }}
              defaultDir={appInfo.defaultBackupDir}
            />
          </div>
        </section>
      )}

      {sqlConfig && (
        <section className="card card-border bg-base-100">
          <div className="card-body">
            <h2 className="card-title">Bases de datos</h2>
            <SqlSettings config={sqlConfig} />
          </div>
        </section>
      )}

      {appInfo && <UpdatesCard currentVersion={appInfo.version} />}

      {appInfo && (
        <section className="card card-border bg-base-100">
          <div className="card-body">
            <h2 className="card-title">Acerca de</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-base-content/60">Versión</dt>
              <dd>{appInfo.version}</dd>
              <dt className="text-base-content/60">Sistema</dt>
              <dd>{appInfo.os}</dd>
              <dt className="text-base-content/60">Base de datos</dt>
              <dd className="break-all font-mono">{appInfo.databasePath}</dd>
            </dl>
          </div>
        </section>
      )}
    </Page>
  );
}
