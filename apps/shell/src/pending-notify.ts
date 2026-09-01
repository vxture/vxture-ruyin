/**
 * Which pending checkpoints are new since the last poll of GET /pending, and
 * deserve a system notification. No Electron dependency - main.ts's
 * watchPending() drives this and owns the actual Notification call.
 */

/** The one field this diff cares about; watchPending's rows have more. */
export interface PendingRow {
  checkpointId: string;
}

export interface PendingDiff<T extends PendingRow> {
  /** Rows that were not in the previous poll - these should notify. */
  toNotify: T[];
  /** Carry this into the next call as `announced`. */
  announced: Set<string>;
}

/**
 * First call (`announced` undefined) seeds silently and notifies nothing:
 * everything already waiting when the app starts is a backlog the user is
 * about to see on screen, not news - announcing it would make every launch
 * a burst of alerts. Every call after that notifies only what is genuinely
 * new, and forgets ids that are no longer pending so a later checkpoint that
 * reuses an id (unlikely, but the set must not grow forever either way)
 * announces again.
 */
export function diffPending<T extends PendingRow>(
  announced: Set<string> | undefined,
  rows: T[],
): PendingDiff<T> {
  const live = new Set(rows.map((r) => r.checkpointId));
  if (!announced) {
    return { toNotify: [], announced: live };
  }
  const toNotify = rows.filter((r) => !announced.has(r.checkpointId));
  const next = new Set(announced);
  for (const row of toNotify) next.add(row.checkpointId);
  for (const id of next) if (!live.has(id)) next.delete(id);
  return { toNotify, announced: next };
}
