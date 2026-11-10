import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import { dayLabel, weekRangeLabel } from "@/lib/format/week";
import { shiftHours } from "@/lib/reports/hours";
import { addDays, mondayOf, romeDay, romeInstant, todayInRome, weekDays, TZ } from "@/lib/time/rome";
import { textOn } from "@/lib/color";
import { cn } from "@/lib/utils";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import type { Locale } from "@/i18n/routing";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Row { id: string; employee_id: string; starts_at: string; ends_at: string; job_position: string | null; weekly_schedules: { location_id: string } }

/** Every bar and every person in one week: who works where, and when. */
export default async function OverviewPage({ params, searchParams }: PageProps<"/[locale]/admin/overview">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("overview");
  const supabase = await createClient();
  const { all: locations } = await getLocationContext();

  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const days = weekDays(weekStart);
  const today = todayInRome();

  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.from("shifts").select("id, employee_id, starts_at, ends_at, job_position, weekly_schedules!inner(location_id)")
      .gte("starts_at", romeInstant(weekStart, "00:00").toISOString()).lt("starts_at", romeInstant(addDays(weekStart, 7), "00:00").toISOString())
      .order("starts_at").limit(1000).returns<Row[]>(),
    supabase.from("profiles").select("id, first_name, last_name, color").eq("role", "employee").eq("is_active", true).order("first_name")
      .returns<{ id: string; first_name: string; last_name: string; color: string }[]>(),
  ]);
  const shifts = rows ?? [];
  const staff = people ?? [];
  const place = new Map(locations.map((l) => [l.id, l]));
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const when = (s: Row) => `${hm.format(new Date(s.starts_at))}–${hm.format(new Date(s.ends_at))}`;

  const cell = (emp: string, day: string) => shifts.filter((s) => s.employee_id === emp && romeDay(new Date(s.starts_at)) === day);
  const hoursOf = (emp: string) => Math.round(shifts.filter((s) => s.employee_id === emp).reduce((n, s) => n + shiftHours(s.starts_at, s.ends_at), 0) * 100) / 100;
  /** people working at a place on a day */
  const headcount = (loc: string, day: string) => new Set(shifts.filter((s) => s.weekly_schedules.location_id === loc && romeDay(new Date(s.starts_at)) === day).map((s) => s.employee_id)).size;

  const base = (d: string) => `/admin/overview?date=${d}`;
  const pill = "rounded-full bg-mist px-3 py-2.5 text-sm font-medium text-ink-soft hover:text-ink sm:px-4 sm:py-2";
  const card = "rounded-[var(--radius-card)] bg-paper p-4 shadow-[var(--shadow-soft)]";
  const chip = (s: Row) => {
    const l = place.get(s.weekly_schedules.location_id);
    return (
      <span key={s.id} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium" style={{ backgroundColor: l?.color ?? "#234A49", color: textOn(l?.color ?? "#234A49") }}>
        <span className="tabular-nums">{when(s)}</span><span className="truncate opacity-90">{l?.name}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel="admin-overview" tables={[{ table: "shifts" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
          <p className="text-lg capitalize">{weekRangeLabel(weekStart, locale)}</p>
        </div>
        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label={t("nav")}>
          <Link href={base(addDays(weekStart, -7))} className={pill} aria-label={t("prev")}>‹</Link>
          <Link href={base(today)} className={pill}>{t("today")}</Link>
          <Link href={base(addDays(weekStart, 7))} className={pill} aria-label={t("next")}>›</Link>
          <Link href={`/admin/reports?from=${weekStart}&to=${addDays(weekStart, 6)}`} className={cn(pill, "bg-brand text-ivory hover:text-ivory")}>{t("hoursReport")}</Link>
        </nav>
      </div>

      <ul className="flex flex-wrap gap-2 text-sm" aria-label={t("legend")}>
        {locations.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-full bg-paper px-3 py-1.5 shadow-[var(--shadow-soft)]">
            <span className="size-3 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />{l.name}
          </li>
        ))}
      </ul>

      {/* phone: one card per day, grouped by bar */}
      <ol className="space-y-3 md:hidden">
        {days.map((day) => {
          const list = shifts.filter((s) => romeDay(new Date(s.starts_at)) === day);
          return (
            <li key={day} className={cn(card, day === today && "ring-2 ring-brand/40")}>
              <h2 className="font-display text-xl capitalize text-brand">{dayLabel(day, locale)}</h2>
              {list.length === 0 ? <p className="mt-1 text-sm text-ink-soft">{t("nobody")}</p> : (
                <div className="mt-2 space-y-3">
                  {locations.map((l) => {
                    const here = list.filter((s) => s.weekly_schedules.location_id === l.id);
                    if (here.length === 0) return null;
                    return (
                      <div key={l.id}>
                        <p className="flex items-center gap-2 text-sm font-semibold"><span className="size-3 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />{l.name}<span className="font-normal text-ink-soft">· {t("people", { count: headcount(l.id, day) })}</span></p>
                        <ul className="mt-1 space-y-1">
                          {here.map((s) => {
                            const p = staff.find((x) => x.id === s.employee_id);
                            return <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-mist/60 px-3 py-2 text-sm"><span className="font-medium">{p?.first_name} {p?.last_name}</span><span className="tabular-nums text-ink-soft">{when(s)}{s.job_position ? ` · ${s.job_position}` : ""}</span></li>;
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* desktop: people down, days across */}
      <div className={cn(card, "hidden overflow-x-auto md:block")}>
        <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="w-40 px-2 py-2 text-left font-medium text-ink-soft">{t("employee")}</th>
              {days.map((d) => (
                <th key={d} className={cn("px-2 py-2 text-left font-medium capitalize", d === today ? "text-brand" : "text-ink-soft")}>{dayLabel(d, locale, "short")}</th>
              ))}
              <th className="w-20 px-2 py-2 text-right font-medium text-ink-soft">{t("hours")}</th>
            </tr>
            <tr>
              <th className="px-2 pb-2 text-left text-xs font-normal text-ink-soft">{t("coverage")}</th>
              {days.map((d) => (
                <th key={d} className="px-2 pb-2 text-left text-xs font-normal text-ink-soft">
                  {locations.map((l) => (
                    <span key={l.id} className="mr-2 inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />{headcount(l.id, d)}</span>
                  ))}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="border-t border-brand/10 px-2 py-2"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ backgroundColor: p.color }} aria-hidden />{p.first_name} {p.last_name}</td>
                {days.map((d) => (
                  <td key={d} className={cn("border-t border-brand/10 px-1.5 py-1.5", d === today && "bg-brand-soft/40")}>
                    <div className="space-y-1">{cell(p.id, d).map(chip)}</div>
                  </td>
                ))}
                <td className="border-t border-brand/10 px-2 py-2 text-right font-medium tabular-nums">{hoursOf(p.id)}</td>
              </tr>
            ))}
            {staff.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-ink-soft">{t("noEmployees")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
