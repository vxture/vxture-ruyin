/**
 * SSE frame parsing for Api.subscribe()'s `/events` stream (TD-027). Pulled
 * out of the class so the parsing itself - buffering, blank-line framing,
 * dropping a malformed frame without losing the stream - can be driven
 * directly, the same reasoning apps/shell/src/daemon-events.ts already
 * applied to its own copy of this exact logic (three copies of one event
 * vocabulary exist by design - daemon sends, UI receives, shell receives -
 * each compared by scripts/guardrails/check-shared-shapes.mjs).
 */

/**
 * Feeds one chunk of decoded SSE text into a running buffer, extracts every
 * complete frame (delimited by a blank line), and parses each `data:` line
 * as one event of type T.
 *
 * A frame with no `data:` line (the heartbeat comment `: beat`) yields no
 * events. A `data:` line that isn't valid JSON is dropped, not thrown - one
 * half-written or malformed frame must not take the rest of the stream down
 * with it, since the caller loops on this for the life of the subscription.
 */
export function extractSseEvents<T>(
  buffer: string,
  chunk: string,
): { events: T[]; buffer: string } {
  let buf = buffer + chunk;
  const events: T[] = [];
  let cut = buf.indexOf("\n\n");
  while (cut >= 0) {
    const frame = buf.slice(0, cut);
    buf = buf.slice(cut + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as T);
      } catch {
        // half-written or malformed frame: drop it, not the rest of the stream.
      }
    }
    cut = buf.indexOf("\n\n");
  }
  return { events, buffer: buf };
}
