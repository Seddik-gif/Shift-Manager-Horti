import { dayLabel } from "@/lib/format/week";
import type { Warning } from "./analysis";

/** Values for the `schedule.warnings.<type>` messages. */
export function warningValues(w: Warning, nameOf: (employeeId: string) => string, locale: string) {
  return {
    name: w.employeeId ? nameOf(w.employeeId) : "",
    day: "day" in w ? dayLabel(w.day, locale) : "",
    count: "count" in w ? w.count : 0,
    min: "min" in w ? w.min : 0,
  };
}

/** Colour of a warning row: hard conflicts red, advice amber, information grey. */
export function warningTone(w: Warning): string {
  if (w.type === "no_shifts" || w.type === "overridden") return "bg-mist/60 text-ink-soft";
  if (w.type === "overlap" || w.type === "on_absence") return "bg-red-50 text-red-800";
  return "bg-amber-50 text-amber-900";
}
