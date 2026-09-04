/**
 * Windows caption-button overlay colours (`titleBarOverlay`).
 *
 * The frameless window draws the three window controls itself, tinted with a
 * colour fixed at creation. Until this landed, that colour was the dark one
 * unconditionally: switch the app to the light theme and the top-right corner
 * stayed a dark block over a white page (owner, 2026-09-04). The comment at
 * the window's creation site had admitted it and pointed at "a shell-side
 * sync" - this is that sync's colour half, kept out of main.ts so it can be
 * tested without Electron (the same split as pdf-protocol / pending-notify).
 *
 * Values match the DS's `--background` / `--muted-foreground` per mode rather
 * than being invented here: the caption strip has to read as part of the same
 * title bar the page draws underneath it.
 */

export type CaptionTheme = "dark" | "light";

export interface CaptionOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

/** Height of the app's own title bar; the overlay must match it exactly. */
export const CAPTION_HEIGHT = 40;

const DARK: CaptionOverlay = {
  color: "#0a0a0a",
  symbolColor: "#a3a3a3",
  height: CAPTION_HEIGHT,
};
const LIGHT: CaptionOverlay = {
  color: "#ffffff",
  symbolColor: "#525252",
  height: CAPTION_HEIGHT,
};

export function captionOverlay(theme: CaptionTheme): CaptionOverlay {
  return theme === "light" ? LIGHT : DARK;
}

/**
 * Reads the theme out of the daemon's reply. Anything other than the literal
 * `"light"` is dark - **an unreadable answer must not flip the chrome**: the
 * app opens dark, and a half-parsed reply is not a reason to repaint.
 */
export function themeFromReply(body: unknown): CaptionTheme {
  if (body && typeof body === "object" && (body as { theme?: unknown }).theme === "light") {
    return "light";
  }
  return "dark";
}
