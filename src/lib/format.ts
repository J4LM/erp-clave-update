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
