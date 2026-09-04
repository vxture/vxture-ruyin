/**
 * SSE frame parsing for the daemon's `/events` stream (TD-029). No Electron
 * dependency - the shell reads the stream with plain fetch + ReadableStream,
 * and this half of it (turn raw bytes into daemon events) is ordinary text
 * parsing that main.ts's streamDaemonEvents() drives.
 */

export type DaemonEventKind = "task" | "pending" | "ui-theme" | "app-restart";

export interface DaemonEventFrame {
  kind: DaemonEventKind;
}

/**
 * Feeds one chunk of decoded SSE text into a running buffer, extracts every
 * complete frame (delimited by a blank line), and parses each `data:` line
 * in each frame as a daemon event.
 *
 * A frame with no `data:` line (the heartbeat comment `: beat`) yields no
 * events. A `data:` line that isn't valid JSON is dropped, not thrown - one
 * half-written or malformed frame must not take the rest of the stream down
 * with it, since the caller loops on this forever for the life of the app.
 */
export function extractDaemonEvents(
  buffer: string,
  chunk: string,
): { events: DaemonEventFrame[]; buffer: string } {
  let buf = buffer + chunk;
  const events: DaemonEventFrame[] = [];
  let cut = buf.indexOf("\n\n");
  while (cut >= 0) {
    const frame = buf.slice(0, cut);
    buf = buf.slice(cut + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as DaemonEventFrame);
      } catch {
        // half-written or malformed frame: drop it, not the rest of the stream.
      }
    }
    cut = buf.indexOf("\n\n");
  }
  return { events, buffer: buf };
}
