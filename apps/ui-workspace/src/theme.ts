/**
 * Theme preference: light (default) / dark / follow-system. Persisted in
 * localStorage; applied via the data-theme attribute the design tokens in
 * app.css key off. Note: the Electron caption-button overlay color is fixed
 * at window creation (no preload/IPC by design), so the native controls
 * stay light-tinted until a shell-side sync lands.
 */

export type ThemePref = "light" | "dark" | "system";

const KEY = "ruyin-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  const raw = localStorage.getItem(KEY);
  return raw === "dark" || raw === "system" ? raw : "light";
}

function apply(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  if (dark) {
    document.documentElement.dataset["theme"] = "dark";
  } else {
    delete document.documentElement.dataset["theme"];
  }
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref);
  apply(pref);
}

export function initTheme(): void {
  apply(getThemePref());
  media.addEventListener("change", () => apply(getThemePref()));
}
