export interface Incoming { id: string; read_at: string | null; created_at: string }

/**
 * Decides which freshly loaded notifications deserve a pop-up.
 * `seen` holds every id already known to this page (initial load, realtime events, earlier polls).
 * The first load only seeds `seen` (nothing pops up for old notifications); afterwards any unread,
 * recent, previously unseen notification is returned. `seen` is updated in place.
 */
export function newForToast<T extends Incoming>(items: T[], seen: Set<string>, firstLoad: boolean, nowMs: number, recentMs = 120_000): T[] {
  const fresh: T[] = [];
  for (const n of items) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (firstLoad) continue;
    if (!n.read_at && nowMs - Date.parse(n.created_at) <= recentMs) fresh.push(n);
  }
  // oldest first, so the newest ends up on top of the stack
  return fresh.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
