import { hoursBetween, romeDay } from "@/lib/time/rome";

export interface SnapshotShift {
  shift_id: string;
  employee_id: string;
  employee_name: string;
  color: string;
  position: string | null;
  starts_at: string;
  ends_at: string;
}
export interface Snapshot { week_start: string; shifts: SnapshotShift[] }

/** Group shifts by the Rome day they start on, each day sorted by start time then name. */
export function groupByDay(shifts: SnapshotShift[], days: string[]): Record<string, SnapshotShift[]> {
  const out: Record<string, SnapshotShift[]> = Object.fromEntries(days.map((d) => [d, []]));
  for (const s of shifts) {
    const d = romeDay(new Date(s.starts_at));
    if (d in out) out[d].push(s);
  }
  for (const d of days) out[d].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.employee_name.localeCompare(b.employee_name));
  return out;
}

/** Total hours per employee (real elapsed time). */
export function hoursByEmployee(shifts: SnapshotShift[]): { id: string; name: string; hours: number }[] {
  const map = new Map<string, { id: string; name: string; hours: number }>();
  for (const s of shifts) {
    const cur = map.get(s.employee_id) ?? { id: s.employee_id, name: s.employee_name, hours: 0 };
    cur.hours += hoursBetween(new Date(s.starts_at), new Date(s.ends_at));
    map.set(s.employee_id, cur);
  }
  return [...map.values()].map((e) => ({ ...e, hours: Math.round(e.hours * 100) / 100 })).sort((a, b) => a.name.localeCompare(b.name));
}

/** What changed between two published versions, matched by shift id. */
export function diffSnapshots(prev: SnapshotShift[], next: SnapshotShift[]) {
  const before = new Map(prev.map((s) => [s.shift_id, s]));
  const after = new Map(next.map((s) => [s.shift_id, s]));
  let changed = 0;
  for (const [id, s] of after) {
    const p = before.get(id);
    if (p && (p.employee_id !== s.employee_id || p.starts_at !== s.starts_at || p.ends_at !== s.ends_at || p.position !== s.position)) changed++;
  }
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).length,
    removed: [...before.keys()].filter((id) => !after.has(id)).length,
    changed,
  };
}
