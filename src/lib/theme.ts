export const THEME_SETTING = "theme";

export const THEMES = [
  { value: "system", label: "Según el sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

// Sin data-theme, daisyUI sigue la preferencia del sistema.
export function applyTheme(theme: string | null | undefined) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}
