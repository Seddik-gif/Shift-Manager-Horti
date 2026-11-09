import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { ScheduleCalendar, type CalEvent } from "@/components/schedule/schedule-calendar";
import { requireEmployee } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { weekRangeLabel } from "@/lib/format/week";
import { parseShiftHours } from "@/lib/scheduling/shift-hours";
import { addDays, hoursBetween, mondayOf, romeDay, romeInstant, romeWallClock, todayInRome } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { MyRequests, type MyRequest } from "./my-requests";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftMonth(day: string, delta: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

interface TeamShift { id: string; employee_id: string; employee_name: string; color: string; job_position: string | null; starts_at: string; ends_at: string }

/** The same calendar admins see, read-only and live: employees read it through the `team_shifts` view. */
export default async function EmployeeSchedulePage({ params, searchParams }: PageProps<"/[locale]/employee/schedule">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  const me = await requireEmployee(locale);
  const sp = await searchParams;
  const t = await getTranslations("schedule");
  const format = await getFormatter();
  const supabase = await createClient();

  const view = sp.view === "month" ? "month" : "week";
  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const gridStart = view === "week" ? weekStart : mondayOf(`${date.slice(0, 7)}-01`);
  const rangeStart = romeInstant(gridStart, "00:00").toISOString();
  const rangeEnd = romeInstant(addDays(gridStart, view === "week" ? 7 : 42), "00:00").toISOString();

  const [shiftsRes, openRes, dirRes, hoursRes, reqRes] = await Promise.all([
    supabase.from("team_shifts").select("id, employee_id, employee_name, color, job_position, starts_at, ends_at")
      .gte("starts_at", rangeStart).lt("starts_at", rangeEnd).order("starts_at").returns<TeamShift[]>(),
    supabase.from("open_shifts").select("id, starts_at, ends_at, job_position, note, slots").eq("status", "open")
      .gte("starts_at", rangeStart).lt("starts_at", rangeEnd)
      .returns<{ id: string; starts_at: string; ends_at: string; job_position: string | null; note: string | null; slots: number }[]>(),
    supabase.from("team_directory").select("id, first_name, last_name, job_position, color, is_active").order("first_name")
      .returns<{ id: string; first_name: string; last_name: string; job_position: string | null; color: string; is_active: boolean }[]>(),
    supabase.from("app_settings").select("value").eq("key", "shift_hours").maybeSingle<{ value: unknown }>(),
    supabase.from("shift_requests").select("id, kind, starts_at, ends_at, note, status").eq("employee_id", me.id)
      .order("created_at", { ascending: false }).limit(15)
      .returns<{ id: string; kind: "take" | "offer"; starts_at: string; ends_at: string; note: string | null; status: MyRequest["status"] }[]>(),
  ]);

  const shifts = shiftsRes.data ?? [];
  const events: CalEvent[] = shifts.map((s) => ({
    id: s.id, employeeId: s.employee_id, name: s.employee_name.split(" ")[0], color: s.color, position: s.job_position ?? "", notes: "",
    start: romeWallClock(new Date(s.starts_at)), end: romeWallClock(new Date(s.ends_at)),
  })).concat((openRes.data ?? []).map((o) => ({
    id: o.id, employeeId: "", name: "", color: "#ffffff", position: o.job_position ?? "", notes: o.note ?? "",
    start: romeWallClock(new Date(o.starts_at)), end: romeWallClock(new Date(o.ends_at)), open: { slots: o.slots },
  })));

  const perDay = new Map<string, Set<string>>();
  for (const s of shifts) {
    const d = romeDay(new Date(s.starts_at));
    (perDay.get(d) ?? perDay.set(d, new Set()).get(d)!).add(s.employee_id);
  }
  const dayCounts = Object.fromEntries([...perDay].map(([d, set]) => [d, set.size]));
  const myHours = Math.round(shifts.filter((s) => s.employee_id === me.id && romeDay(new Date(s.starts_at)) >= weekStart && romeDay(new Date(s.starts_at)) < addDays(weekStart, 7))
    .reduce((a, s) => a + hoursBetween(new Date(s.starts_at), new Date(s.ends_at)), 0) * 100) / 100;

  const time = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
  const myRequests: MyRequest[] = (reqRes.data ?? []).map((r) => ({
    id: r.id, kind: r.kind, status: r.status, note: r.note ?? "",
    when: `${format.dateTime(new Date(r.starts_at), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" })} · ${time(r.starts_at)}–${time(r.ends_at)}`,
  }));

  const base = (v: string, d: string) => `/employee/schedule?view=${v}&date=${d}`;
  const prev = view === "week" ? addDays(weekStart, -7) : shiftMonth(date, -1);
  const next = view === "week" ? addDays(weekStart, 7) : shiftMonth(date, 1);
  const title = view === "week"
    ? weekRangeLabel(weekStart, locale)
    : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 7)}-15T12:00:00Z`));
  const pill = (on: boolean) => cn("rounded-full px-4 py-2 text-sm font-medium", on ? "bg-brand text-ivory" : "bg-mist text-ink-soft hover:text-ink");

  return (
    <div className="space-y-6">
      <RealtimeRefresh
        channel={`employee-calendar-${me.id}`}
        tables={[{ table: "schedule_pulse" }, { table: "open_shifts" }, { table: "shift_requests", filter: `employee_id=eq.${me.id}` }]}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-medium text-brand">{t("teamCalendar")}</h1>
          <p className="text-lg capitalize">{title}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label={t("views")}>
          <Link href={base("week", date)} className={pill(view === "week")}>{t("week")}</Link>
          <Link href={base("month", date)} className={pill(view === "month")}>{t("month")}</Link>
          <span className="mx-1 h-6 w-px bg-brand/15" aria-hidden />
          <Link href={base(view, prev)} className={pill(false)} aria-label={t("prev")}>‹</Link>
          <Link href={base(view, todayInRome())} className={pill(false)}>{t("today")}</Link>
          <Link href={base(view, next)} className={pill(false)} aria-label={t("next")}>›</Link>
        </nav>
      </div>

      {view === "week" && (
        <p className={cn("rounded-[var(--radius-card)] p-4", myHours > 0 ? "bg-brand-soft text-brand" : "bg-mist/60 text-ink-soft")}>
          {myHours > 0 ? t("myHours", { hours: myHours }) : t("noMyShifts")}
        </p>
      )}

      {shiftsRes.error ? <p role="alert" className="text-danger">{t("loadError")}</p> : (
        <ScheduleCalendar
          mode="employee"
          view={view}
          date={view === "week" ? weekStart : date}
          events={events}
          dayCounts={dayCounts}
          hours={parseShiftHours((hoursRes.data as { value: unknown } | null)?.value)}
          meId={me.id}
          employees={(dirRes.data ?? []).filter((e) => shifts.some((s) => s.employee_id === e.id)).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), position: e.job_position ?? "", active: e.is_active, color: e.color }))}
        />
      )}

      <MyRequests items={myRequests} />
    </div>
  );
}
