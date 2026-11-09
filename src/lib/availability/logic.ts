import { intervalInstants, overlaps, weekDays } from "@/lib/time/rome";

export interface WindowInput { start: string; end: string }
export interface DayInput {
  day: string;
  /** null = not answered yet (only valid for drafts) */
  available: boolean | null;
  note: string;
  windows: WindowInput[];
}

export type DayIssue = "unanswered" | "noWindows" | "sameTime" | "overlap";

export function emptyWeek(weekStart: string): DayInput[] {
  return weekDays(weekStart).map((day) => ({ day, available: null, note: "", windows: [] }));
}

/**
 * Validates a whole week of availability. Overlaps are checked on real instants,
 * so 18:00–01:00 on Monday also collides with 00:30–03:00 on Tuesday.
 * With `requireComplete` every day must be answered (needed to submit).
 */
export function validateWeek(days: DayInput[], requireComplete: boolean): Record<string, DayIssue[]> {
  const issues: Record<string, DayIssue[]> = {};
  const add = (day: string, issue: DayIssue) => {
    const list = (issues[day] ??= []);
    if (!list.includes(issue)) list.push(issue);
  };
  const spans: { day: string; s: Date; e: Date }[] = [];

  for (const d of days) {
    if (d.available === null) {
      if (requireComplete) add(d.day, "unanswered");
      continue;
    }
    if (!d.available) continue;
    if (d.windows.length === 0 && requireComplete) add(d.day, "noWindows");
    for (const w of d.windows) {
      if (w.start === w.end) {
        add(d.day, "sameTime");
        continue;
      }
      const { startsAt, endsAt } = intervalInstants(d.day, w.start, w.end);
      spans.push({ day: d.day, s: startsAt, e: endsAt });
    }
  }
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++)
      if (overlaps(spans[i].s, spans[i].e, spans[j].s, spans[j].e)) {
        add(spans[i].day, "overlap");
        add(spans[j].day, "overlap");
      }
  return issues;
}

/** Does an interval fit entirely inside the availability windows (touching windows are merged)? */
export function isCovered(start: Date, end: Date, windows: { startsAt: Date; endsAt: Date }[]): boolean {
  const sorted = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: { startsAt: Date; endsAt: Date }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.startsAt <= last.endsAt) {
      last.endsAt = new Date(Math.max(last.endsAt.getTime(), w.endsAt.getTime()));
    } else merged.push({ ...w });
  }
  return merged.some((w) => w.startsAt <= start && w.endsAt >= end);
}

export function completionPercent(submitted: number, total: number): number {
  return total === 0 ? 0 : Math.round((submitted / total) * 100);
}
