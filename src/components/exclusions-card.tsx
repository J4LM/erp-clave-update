import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ErrorAlert } from "@/components/form";
import {
  addExclusion,
  deleteExclusion,
  exclusionPreviewQuery,
  profilesQuery,
  type Profile,
} from "@/lib/api";

const SUGGESTIONS = ["web.config", "*.log", "App_Data"];

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ExclusionsCard({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: profilesQuery.queryKey });

  const add = async (pattern: string, serverId: number | null) => {
    setSubmitError(null);
    try {
      await addExclusion(profile.id, serverId, pattern);
      await invalidate();
      return true;
    } catch (error) {
      setSubmitError(error);
      return false;
    }
  };

  const form = useForm({
    defaultValues: { pattern: "", scope: "" },
    onSubmit: async ({ value, formApi }) => {
      const serverId = value.scope ? Number(value.scope) : null;
      if (await add(value.pattern, serverId)) {
        formApi.setFieldValue("pattern", "");
      }
    },
  });

  const remove = useMutation({
    mutationFn: deleteExclusion,
    onSuccess: invalidate,
  });

  const serverName = (serverId: number) =>
    profile.servers.find((server) => server.id === serverId)?.name ?? "";
  const shared = new Set(
    profile.exclusions
      .filter((exclusion) => exclusion.serverId === null)
      .map((exclusion) => exclusion.pattern.toLowerCase()),
  );
  const serversWithOwn = profile.servers.filter((server) =>
    profile.exclusions.some((exclusion) => exclusion.serverId === server.id),
  );

  return (
    <section className="card card-border bg-base-100">
      <div className="card-body">
        <h2 className="card-title">Exclusiones</h2>
        <p className="text-sm text-base-content/60">
          Los archivos excluidos no se copian, no se sobrescriben y no se
          borran de los servidores. Un nombre vale para cualquier carpeta (
          <code>web.config</code>, <code>*.log</code>); con barra, la ruta
          parte de la raíz (<code>App_Data/*.mdf</code>). Excluir una carpeta
          excluye todo su contenido.
        </p>

        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="pattern">
            {(field) => (
              <input
                className="input grow font-mono"
                placeholder="web.config"
                aria-label="Patrón"
                autoComplete="off"
                spellCheck={false}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <form.Field name="scope">
            {(field) => (
              <select
                className="select w-56"
                aria-label="Aplicar a"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Todos los servidores</option>
                {profile.servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    Solo {server.name}
                  </option>
                ))}
              </select>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) =>
              [state.values.pattern.trim() === "", state.isSubmitting] as const
            }
          >
            {([isEmpty, isSubmitting]) => (
              <button
                type="submit"
                className="btn"
                disabled={isEmpty || isSubmitting}
              >
                Añadir
              </button>
            )}
          </form.Subscribe>
        </form>

        <form.Subscribe selector={(state) => state.values.pattern}>
          {(pattern) => (
            <PatternTester
              profile={profile}
              pattern={pattern}
              suggestions={SUGGESTIONS.filter(
                (suggestion) => !shared.has(suggestion.toLowerCase()),
              )}
              onPick={(suggestion) => void add(suggestion, null)}
            />
          )}
        </form.Subscribe>

        <ErrorAlert error={submitError ?? remove.error} />

        {profile.exclusions.length === 0 ? (
          <p className="py-4 text-center text-base-content/60">
            Sin exclusiones: se copiará y sustituirá todo.
          </p>
        ) : (
          <ul className="list">
            {profile.exclusions.map((exclusion) => (
              <li key={exclusion.id} className="list-row items-center py-2">
                <code className="list-col-grow">{exclusion.pattern}</code>
                <span className="badge badge-ghost badge-sm">
                  {exclusion.serverId === null
                    ? "Todos los servidores"
                    : `Solo ${serverName(exclusion.serverId)}`}
                </span>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(exclusion.id)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        {profile.exclusions.length > 0 && profile.sourceExists && (
          <div className="flex flex-col gap-2">
            <ExcludedFiles
              profile={profile}
              serverId={null}
              label="En todos los servidores"
            />
            {serversWithOwn.map((server) => (
              <ExcludedFiles
                key={server.id}
                profile={profile}
                serverId={server.id}
                label={`En ${server.name}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface PatternTesterProps {
  profile: Profile;
  pattern: string;
  suggestions: string[];
  onPick: (suggestion: string) => void;
}

/** Muestra, mientras se escribe, qué archivos de la publicación captura un patrón. */
function PatternTester({
  profile,
  pattern,
  suggestions,
  onPick,
}: PatternTesterProps) {
  const typed = useDebounced(pattern.trim(), 250);
  const preview = useQuery({
    ...exclusionPreviewQuery(profile.id, null, typed),
    enabled: typed !== "" && profile.sourceExists,
    placeholderData: keepPreviousData,
  });

  if (typed === "") {
    if (suggestions.length === 0) return null;
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/60">
        Habituales:
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="btn btn-xs font-mono"
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    );
  }
  if (!profile.sourceExists) {
    return (
      <p className="text-sm text-base-content/60">
        No se puede probar el patrón: la carpeta de publicación no existe.
      </p>
    );
  }
  if (preview.isError) {
    return <p className="text-sm text-error">{String(preview.error)}</p>;
  }
  if (!preview.data) return null;

  const { matched, matchedCount, totalFiles } = preview.data;
  return (
    <div className="rounded-box bg-base-200 p-3 text-sm">
      <div className="text-base-content/70">
        {matchedCount === 0
          ? `No captura ninguno de los ${totalFiles} archivos de la publicación. Aun así protege los archivos del servidor que coincidan.`
          : `Captura ${matchedCount} de ${totalFiles} archivos de la publicación:`}
      </div>
      <FileList files={matched} total={matchedCount} />
    </div>
  );
}

interface ExcludedFilesProps {
  profile: Profile;
  serverId: number | null;
  label: string;
}

function ExcludedFiles({ profile, serverId, label }: ExcludedFilesProps) {
  const preview = useQuery(exclusionPreviewQuery(profile.id, serverId, null));

  if (preview.isError) {
    return <p className="text-sm text-error">{String(preview.error)}</p>;
  }
  if (!preview.data) return null;

  const { matched, matchedCount, totalFiles } = preview.data;
  return (
    <details className="collapse collapse-arrow bg-base-200">
      <summary className="collapse-title text-sm">
        {label}: no se copiarán {matchedCount} de {totalFiles} archivos de la
        publicación
      </summary>
      <div className="collapse-content text-sm">
        <FileList files={matched} total={matchedCount} />
      </div>
    </details>
  );
}

function FileList({ files, total }: { files: string[]; total: number }) {
  if (files.length === 0) return null;
  return (
    <>
      <ul className="mt-2 max-h-48 overflow-y-auto font-mono text-xs">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      {total > files.length && (
        <div className="mt-1 text-xs text-base-content/60">
          y {total - files.length} más
        </div>
      )}
    </>
  );
}
