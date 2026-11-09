import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { type Warning } from "@/lib/scheduling/analysis";
import { loadWeek } from "@/lib/scheduling/load-week";
import { parseShiftHours } from "@/lib/scheduling/shift-hours";
import { dayLabel, weekRangeLabel } from "@/lib/format/week";
import { addDays, mondayOf, romeDay, romeInstant, romeWallClock, todayInRome, weekDays } from "@/lib/time/rome";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { ScheduleCalendar, type CalEvent } from "@/components/schedule/schedule-calendar";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Emp { id: string; first_name: string; last_name: string; color: string; job_position: string | null; is_active: boolean }
interface ShiftRow {
  id: string; employee_id: string; starts_at: string; ends_at: string; job_position: string | null; notes: string | null; availability_override: boolean;
}

function shiftMonth(day: string, delta: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

export default async function SchedulePage({ params, searchParams }: PageProps<"/[locale]/admin/schedule">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("schedule");
  const supabase = await createClient();

  const view = sp.view === "month" ? "month" : "week";
  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const gridStart = view === "week" ? weekStart : mondayOf(`${date.slice(0, 7)}-01`);
  const gridDays = view === "week" ? 7 : 42;
  const rangeStart = romeInstant(gridStart, "00:00");
  const rangeEnd = romeInstant(addDays(gridStart, gridDays), "00:00");

  const [{ data: empRows }, { data: shiftRows, error }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, color, job_position, is_active").eq("role", "employee").order("first_name").returns<Emp[]>(),
    supabase.from("shifts")
      .select("id, employee_id, starts_at, ends_at, job_position, notes, availability_override")
      .gte("starts_at", rangeStart.toISOString()).lt("starts_at", rangeEnd.toISOString())
      .order("starts_at").returns<ShiftRow[]>(),
  ]);
  const { data: hoursRow } = await supabase.from("app_settings").select("value").eq("key", "shift_hours").maybeSingle<{ value: unknown }>();
  const hours = parseShiftHours(hoursRow?.value);
  const emps = empRows ?? [];
  const byId = new Map(emps.map((e) => [e.id, e]));
  const nameOf = (id: string) => (byId.get(id) ? `${byId.get(id)!.first_name} ${byId.get(id)!.last_name}`.trim() : "?");
  const shifts = shiftRows ?? [];

  const { data: openRows } = await supabase
    .from("open_shifts")
    .select("id, starts_at, ends_at, job_position, note, slots")
    .eq("status", "open")
    .gte("starts_at", rangeStart.toISOString()).lt("starts_at", rangeEnd.toISOString())
    .returns<{ id: string; starts_at: string; ends_at: string; job_position: string | null; note: string | null; slots: number }[]>();

  const openEvents: CalEvent[] = (openRows ?? []).map((o) => ({
    id: o.id, employeeId: "", name: "", color: "#ffffff", position: o.job_position ?? "", notes: o.note ?? "",
    start: romeWallClock(new Date(o.starts_at)), end: romeWallClock(new Date(o.ends_at)), open: { slots: o.slots },
  }));

  const events: CalEvent[] = shifts.map((s) => ({
    id: s.id, employeeId: s.employee_id, name: byId.get(s.employee_id)?.first_name ?? "?", color: byId.get(s.employee_id)?.color ?? "#234A49",
    start: romeWallClock(new Date(s.starts_at)), end: romeWallClock(new Date(s.ends_at)), position: s.job_position ?? "", notes: s.notes ?? "",
  })).concat(openEvents);

  // month: how many distinct people work each day
  const perDay = new Map<string, Set<string>>();
  for (const s of shifts) {
    const d = romeDay(new Date(s.starts_at));
    (perDay.get(d) ?? perDay.set(d, new Set()).get(d)!).add(s.employee_id);
  }
  const dayCounts = Object.fromEntries([...perDay].map(([d, set]) => [d, set.size]));

  // week analysis: hours, availability checks, warnings (shared with the review screen)
  const week = view === "week" ? await loadWeek(supabase, weekStart) : null;
  const analysis = week?.analysis ?? null;
  const scheduleStatus = week?.status ?? "none";

  const base = (v: string, d: string) => `/admin/schedule?view=${v}&date=${d}`;
  const prev = view === "week" ? addDays(weekStart, -7) : shiftMonth(date, -1);
  const next = view === "week" ? addDays(weekStart, 7) : shiftMonth(date, 1);
  const title = view === "week"
    ? weekRangeLabel(weekStart, locale)
    : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 7)}-15T12:00:00Z`));
  const pill = (on: boolean) => cn("rounded-full px-4 py-2 text-sm font-medium", on ? "bg-brand text-ivory" : "bg-mist text-ink-soft hover:text-ink");
  const warnText = (w: Warning) =>
    t(`warnings.${w.type}`, { name: nameOf(w.employeeId), hours: "hours" in w ? w.hours : 0 });
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  const activeEmps = emps.filter((e) => e.is_active);

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel="admin-schedule" tables={[{ table: "shifts" }, { table: "open_shifts" }, { table: "shift_requests" }, { table: "availability_submissions" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
          <p className="text-lg capitalize">{title}
            {view === "week" && <span className="ml-3 rounded-full bg-brand-soft px-3 py-1 text-xs text-brand">{t(`status.${scheduleStatus}`)}</span>}
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label={t("views")}>
          <Link href={base("week", date)} className={pill(view === "week")}>{t("week")}</Link>
          <Link href={base("month", date)} className={pill(view === "month")}>{t("month")}</Link>
          {view === "week" && (scheduleStatus === "draft" || scheduleStatus === "publishedChanges") && (
            <Link href={`/admin/schedule/review?date=${weekStart}`} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-ivory hover:bg-brand-dark">{t("reviewPublish")}</Link>
          )}
          {view === "week" && scheduleStatus !== "none" && scheduleStatus !== "draft" && (
            <Link href={`/admin/schedule/versions?date=${weekStart}`} className={pill(false)}>{t("history")}</Link>
          )}
          <span className="mx-1 h-6 w-px bg-brand/15" aria-hidden />
          <Link href={base(view, prev)} className={pill(false)} aria-label={t("prev")}>‹</Link>
          <Link href={base(view, todayInRome())} className={pill(false)}>{t("today")}</Link>
          <Link href={base(view, next)} className={pill(false)} aria-label={t("next")}>›</Link>
        </nav>
      </div>

      {error ? <p role="alert" className="text-danger">{t("loadError")}</p> : activeEmps.length === 0 ? (
        <p className={cn(card, "text-ink-soft")}>{t("noEmployees")}</p>
      ) : (
        <ScheduleCalendar
          mode="admin"
          view={view}
          date={view === "week" ? weekStart : date}
          events={events}
          dayCounts={dayCounts}
          hours={hours}
          employees={emps.map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), position: e.job_position ?? "", active: e.is_active, color: e.color }))}
        />
      )}

      {analysis && (
        <section className="grid gap-4 lg:grid-cols-3" aria-label={t("summary.title")}>
          <div className={cn(card, "lg:col-span-2")}>
            <h2 className="font-display text-2xl text-brand">{t("summary.hoursPerEmployee")}</h2>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-ink-soft"><th className="py-1 font-medium">{t("employee")}</th><th className="py-1 text-right font-medium">{t("summary.shifts")}</th><th className="py-1 text-right font-medium">{t("summary.hours")}</th></tr></thead>
              <tbody className="divide-y divide-brand/10">
                {activeEmps.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ backgroundColor: e.color }} aria-hidden />{e.first_name} {e.last_name}</td>
                    <td className="py-2 text-right tabular-nums">{analysis.shiftsByEmployee[e.id] ?? 0}</td>
                    <td className="py-2 text-right tabular-nums">{analysis.hoursByEmployee[e.id] ?? 0}</td>
                  </tr>
                ))}
                <tr className="font-medium"><td className="py-2">{t("summary.total")}</td><td className="py-2 text-right tabular-nums">{analysis.shiftCount}</td>
                  <td className="py-2 text-right tabular-nums">{Math.round(Object.values(analysis.hoursByEmployee).reduce((a, b) => a + b, 0) * 100) / 100}</td></tr>
              </tbody>
            </table>
            <h3 className="mt-5 font-display text-xl text-brand">{t("summary.hoursPerDay")}</h3>
            <ul className="mt-2 grid grid-cols-7 gap-2 text-center text-sm">
              {weekDays(weekStart).map((d) => (
                <li key={d} className="rounded-xl bg-mist/60 p-2"><span className="block text-xs capitalize text-ink-soft">{dayLabel(d, locale, "short")}</span><span className="tabular-nums">{analysis.hoursByDay[d]}</span></li>
              ))}
            </ul>
          </div>
          <div className={card}>
            <h2 className="font-display text-2xl text-brand">{t("summary.warnings")}</h2>
            {analysis.warnings.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">{analysis.shiftCount === 0 ? t("summary.noShifts") : t("summary.noWarnings")}</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {analysis.warnings.map((w, i) => (
                  <li key={i} className={cn("rounded-xl p-2.5", w.type === "no_shifts" || w.type === "overridden" ? "bg-mist/60 text-ink-soft" : "bg-amber-50 text-amber-900")}>{warnText(w)}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
