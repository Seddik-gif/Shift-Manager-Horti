/** Pure helpers for the activity log: grouping of actions and a readable one-line detail for each entry. */

export const AREAS = ["all", "schedule", "shifts", "requests", "people", "settings", "chat"] as const;
export type Area = (typeof AREAS)[number];

/** Which filter an action belongs to. Order matters: the first matching prefix wins. */
const AREA_PREFIXES: Record<Exclude<Area, "all">, string[]> = {
  schedule: ["schedule.", "whatsapp."],
  shifts: ["shift.", "open_shift.", "swap."],
  requests: ["shift_request.", "absence.", "availability"],
  people: ["employee.", "location."],
  settings: ["settings."],
  chat: ["chat."],
};

export function areaOf(action: string): Exclude<Area, "all"> | "other" {
  for (const [area, prefixes] of Object.entries(AREA_PREFIXES) as [Exclude<Area, "all">, string[]][]) {
    if (prefixes.some((p) => action.startsWith(p))) return area;
  }
  return "other";
}

/** SQL `like` patterns for an area (used to filter on the server). */
export function patternsFor(area: Area): string[] {
  if (area === "all") return [];
  return AREA_PREFIXES[area].map((p) => `${p}%`);
}

/** Key in the messages file: "shift.created" -> "shift_created". */
export const actionKey = (action: string) => action.replace(/[^a-z0-9]+/gi, "_");

type Changes = Record<string, unknown>;

/** Every person id mentioned in an entry, so names can be looked up in one query. */
export function personIds(changes: Changes): string[] {
  const out = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const add = (v: unknown) => { if (typeof v === "string" && uuid.test(v)) out.add(v); };
  for (const k of ["employee_id", "from", "to"]) add(changes[k]);
  for (const side of ["from", "to"]) {
    const o = changes[side];
    if (o && typeof o === "object") add((o as Changes).employee_id);
  }
  return [...out];
}

export interface Resolvers {
  person: (id: string) => string;
  location: (id: string) => string;
  /** formats an ISO instant as "lun 12 · 10:00–14:00" style text; receives start and end */
  range: (start: string, end: string) => string;
  /** formats a calendar date (yyyy-MM-dd) */
  date: (day: string) => string;
  /** turns a stored reason code such as "outside" into words; unknown text is returned unchanged */
  reason?: (code: string) => string;
}

/** A short list of facts for one entry, e.g. ["Marco", "lun 12 · 10:00–14:00", "Lido"]. Never throws on odd data. */
export function detailParts(action: string, changes: Changes, r: Resolvers): string[] {
  const parts: string[] = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const nested = (k: string) => (changes[k] && typeof changes[k] === "object" ? (changes[k] as Changes) : null);

  if (action === "shift.updated" || action === "shift.swapped") {
    const from = nested("from"), to = nested("to");
    if (action === "shift.swapped") {
      if (str(changes.from) && str(changes.to)) parts.push(`${r.person(changes.from as string)} → ${r.person(changes.to as string)}`);
    } else if (from && to) {
      const a = str(from.employee_id), b = str(to.employee_id);
      parts.push(a && b && a !== b ? `${r.person(a)} → ${r.person(b)}` : r.person((b ?? a) as string));
    }
    const t = to ?? changes;
    if (str(t.starts_at) && str(t.ends_at)) parts.push(r.range(t.starts_at as string, t.ends_at as string));
  } else {
    const who = str(changes.employee_id);
    if (who) parts.push(r.person(who));
    if (str(changes.starts_at) && str(changes.ends_at)) parts.push(r.range(changes.starts_at as string, changes.ends_at as string));
  }
  if (str(changes.start_date)) {
    const e = str(changes.end_date);
    parts.push(e && e !== changes.start_date ? `${r.date(changes.start_date as string)} – ${r.date(e)}` : r.date(changes.start_date as string));
  }
  if (str(changes.week_start)) parts.push(r.date(changes.week_start as string));
  if (typeof changes.version === "number") parts.push(`v${changes.version}`);
  if (typeof changes.shifts === "number") parts.push(`${changes.shifts}`);
  if (typeof changes.conflicting_shifts === "number" && changes.conflicting_shifts > 0) parts.push(`⚠ ${changes.conflicting_shifts}`);
  if (str(changes.location_id)) parts.push(r.location(changes.location_id as string));
  if (str(changes.name)) parts.push(changes.name as string);
  if (str(changes.reason)) parts.push(r.reason ? r.reason(changes.reason as string) : (changes.reason as string));
  if (str(changes.note)) parts.push(`“${changes.note}”`);
  return parts;
}
