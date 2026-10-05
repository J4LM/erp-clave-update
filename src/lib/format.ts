const UNITS = ["B", "KB", "MB", "GB"];

export function formatBytes(bytes: number | null) {
  if (bytes === null) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Formatea una fecha UTC de la base de datos (`AAAA-MM-DD HH:MM:SS`) en hora local. */
export function formatDate(utc: string) {
  const date = new Date(`${utc.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? utc : DATE_FORMAT.format(date);
}

/** Duración entre dos fechas UTC de la base de datos, por ejemplo "1 min 12 s". */
export function formatDuration(startUtc: string, endUtc: string) {
  const parse = (utc: string) => new Date(`${utc.replace(" ", "T")}Z`).getTime();
  const seconds = Math.max(0, Math.round((parse(endUtc) - parse(startUtc)) / 1000));
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
