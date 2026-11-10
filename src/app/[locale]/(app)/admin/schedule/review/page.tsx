import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { requireAdmin } from "@/lib/auth/guards";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import { weekRangeLabel } from "@/lib/format/week";
import { loadWeek } from "@/lib/scheduling/load-week";
import { warningTone, warningValues } from "@/lib/scheduling/warning-text";
import type { Warning } from "@/lib/scheduling/analysis";
import type { SnapshotShift } from "@/lib/scheduling/snapshot";
import { mondayOf, todayInRome } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { PublishButton } from "./publish-button";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReviewPage({ params, searchParams }: PageProps<"/[locale]/admin/schedule/review">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("publish");
  const ts = await getTranslations("schedule");

  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const { active: loc } = await getLocationContext();
  if (!loc) return <p className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft">{(await getTranslations("locations"))("none")}</p>;
  const supabase = await createClient();
  const week = await loadWeek(supabase, weekStart, loc.id);
  const { data: coverageRows } = await supabase.rpc("push_coverage", { p_location: loc.id });
  const coverage = (coverageRows ?? []) as { user_id: string; name: string; state: "active" | "disabled" | "none" }[];
  const notified = coverage.filter((c) => c.state === "active");
  const unreachable = coverage.filter((c) => c.state !== "active");
  const { analysis, employees } = week;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const nameOf = (id: string) => `${byId.get(id)?.first_name ?? "?"} ${byId.get(id)?.last_name ?? ""}`.trim();

  const shifts: SnapshotShift[] = week.shifts.map((s) => ({
    shift_id: s.id, employee_id: s.employee_id, employee_name: nameOf(s.employee_id), color: byId.get(s.employee_id)?.color ?? "#234A49",
    position: s.job_position, starts_at: s.starts_at, ends_at: s.ends_at,
  }));
  const active = employees.filter((e) => e.is_active);
  const conflicts = analysis.warnings.filter((w) => ["outside_availability", "no_submission", "overlap", "on_absence"].includes(w.type));
  const blocking = analysis.warnings.filter((w) => w.type !== "overridden" && w.type !== "no_shifts").length;
  const warnText = (w: Warning) => ts(`warnings.${w.type}`, warningValues(w, nameOf, locale));
  const canPublish = week.status === "draft" || week.status === "publishedChanges";
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/schedule?date=${weekStart}`} className="text-sm text-brand underline">← {ts("title")}</Link>
        <h1 className="font-display text-4xl font-medium text-brand">{t("reviewTitle")}</h1>
        <p className="text-lg capitalize">{weekRangeLabel(weekStart, locale)}
          <span className="ml-3 rounded-full bg-brand-soft px-3 py-1 text-xs text-brand">{ts(`status.${week.status}`)}</span>
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className={card}><p className="text-sm text-ink-soft">{ts("summary.shifts")}</p><p className="font-display text-4xl text-brand">{analysis.shiftCount}</p></div>
        <div className={card}><p className="text-sm text-ink-soft">{t("conflicts")}</p><p className={cn("font-display text-4xl", conflicts.length ? "text-danger" : "text-brand")}>{conflicts.length}</p></div>
        <div className={card}><p className="text-sm text-ink-soft">{t("withoutShifts")}</p>
          <p className="font-display text-4xl text-brand">{analysis.warnings.filter((w) => w.type === "no_shifts").length}</p></div>
      </section>

      <section className={card}>
        <h2 className="font-display text-2xl text-brand">{ts("summary.warnings")}</h2>
        {analysis.warnings.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{ts("summary.noWarnings")}</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {analysis.warnings.map((w, i) => (
              <li key={i} className={cn("rounded-xl p-2.5", warningTone(w))}>{warnText(w)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-display text-2xl text-brand">{ts("summary.hoursPerEmployee")}</h2>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-1 font-medium">{ts("employee")}</th><th className="py-1 text-right font-medium">{ts("summary.shifts")}</th><th className="py-1 text-right font-medium">{ts("summary.hours")}</th></tr></thead>
          <tbody className="divide-y divide-brand/10">
            {active.map((e) => (
              <tr key={e.id}>
                <td className="py-2"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ backgroundColor: e.color }} aria-hidden />{e.first_name} {e.last_name}</td>
                <td className="py-2 text-right tabular-nums">{analysis.shiftsByEmployee[e.id] ?? 0}</td>
                <td className="py-2 text-right tabular-nums">{analysis.hoursByEmployee[e.id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={card} aria-label={t("pushTitle")}>
        <h2 className="font-display text-2xl text-brand">{t("pushTitle")}</h2>
        <p className="mt-1 text-sm">
          <span className="font-medium text-brand">{t("pushNotified", { count: notified.length })}</span>
          {" · "}
          <span className={unreachable.length ? "font-medium text-amber-800" : "text-ink-soft"}>{unreachable.length ? "⚠️ " : ""}{t("pushMissing", { count: unreachable.length })}</span>
        </p>
        {unreachable.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {unreachable.map((c) => <li key={c.user_id} className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">{c.name} · {t(c.state === "disabled" ? "pushDisabled" : "pushNone")}</li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-soft">{t("pushNote")}</p>
      </section>

      <ScheduleList weekStart={weekStart} shifts={shifts} />

      {week.error ? <p role="alert" className="text-danger">{ts("loadError")}</p>
        : analysis.shiftCount === 0 ? <p className={cn(card, "text-ink-soft")}>{t("nothingToPublishEmpty")}</p>
        : canPublish ? <PublishButton locationId={loc.id} weekStart={weekStart} republish={week.status === "publishedChanges"} warningCount={blocking} />
        : <p className={cn(card, "text-ink-soft")}>{t("alreadyPublished")} <Link href={`/admin/schedule/versions?date=${weekStart}`} className="text-brand underline">{t("viewVersions")}</Link></p>}
    </div>
  );
}
