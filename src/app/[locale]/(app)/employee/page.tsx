import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireEmployee } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { weekRangeLabel, dayLabel } from "@/lib/format/week";
import { hoursByEmployee } from "@/lib/scheduling/snapshot";
import { formatWindow, nowMs, romeDay } from "@/lib/time/rome";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import type { Locale } from "@/i18n/routing";

interface Req { id: string; week_start: string; deadline: string; availability_submissions: { status: "draft" | "submitted"; review_status: "pending" | "confirmed" | "changes_requested"; review_note: string | null }[] }

export default async function EmployeeDashboard({ params }: PageProps<"/[locale]/employee">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireEmployee(locale);
  const t = await getTranslations("employee");
  const ta = await getTranslations("availability");
  const format = await getFormatter();
  const supabase = await createClient();

  // RLS limits the embedded submissions to this employee's own row.
  const { data, error } = await supabase
    .from("availability_requests")
    .select("id, week_start, deadline, availability_submissions(status, review_status, review_note)")
    .eq("status", "open")
    .order("week_start")
    .returns<Req[]>();
  const open = data ?? [];

  // Next shifts, live from the same calendar admins edit.
  const { data: mine } = await supabase
    .from("team_shifts")
    .select("id, employee_id, employee_name, color, job_position, starts_at, ends_at")
    .eq("employee_id", profile.id)
    .gt("ends_at", new Date(nowMs()).toISOString())
    .order("starts_at")
    .limit(8)
    .returns<{ id: string; employee_id: string; employee_name: string; color: string; job_position: string | null; starts_at: string; ends_at: string }[]>();
  const upcoming = (mine ?? []).map((m) => ({ shift_id: m.id, employee_id: m.employee_id, employee_name: m.employee_name, color: m.color, position: m.job_position, starts_at: m.starts_at, ends_at: m.ends_at }));
  const upcomingHours = hoursByEmployee(upcoming)[0]?.hours ?? 0;

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="employee-requests" tables={[{ table: "availability_requests" }, { table: "availability_submissions" }, { table: "schedule_pulse" }, { table: "notifications", filter: `user_id=eq.${profile.id}` }]} />
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("greeting", { name: profile.first_name })}</h1>
        <p className="mt-1 text-ink-soft">{t("subtitle")}</p>
      </div>

      <section aria-label={ta("openRequests")} className="space-y-3">
        <h2 className="font-display text-2xl text-brand">{ta("openRequests")}</h2>
        {error ? (
          <p role="alert" className="text-danger">{ta("loadError")}</p>
        ) : open.length === 0 ? (
          <p className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft shadow-[var(--shadow-soft)]">{ta("noOpenRequests")}</p>
        ) : (
          open.map((r) => {
            const status = r.availability_submissions[0]?.status;
            const review = r.availability_submissions[0]?.review_status;
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
                <div>
                  <p className="text-lg font-medium capitalize">{weekRangeLabel(r.week_start, locale)}</p>
                  <p className="text-sm text-ink-soft">
                    {ta("deadline", { date: format.dateTime(new Date(r.deadline), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
                  </p>
                  <p className={cn("mt-1 text-sm font-medium", status !== "submitted" ? "text-danger" : review === "confirmed" ? "text-brand" : review === "changes_requested" ? "text-danger" : "text-amber-700")}>
                    {status !== "submitted" ? (status === "draft" ? ta("statusDraft") : ta("statusNotSent")) : ta(`reviewState.${review ?? "pending"}`)}
                  </p>
                  {status === "submitted" && review === "changes_requested" && r.availability_submissions[0]?.review_note && (
                    <p className="mt-1 text-sm">“{r.availability_submissions[0].review_note}”</p>
                  )}
                </div>
                <Button asChild size="lg">
                  <Link href={`/employee/availability/${r.id}`}>{status === "submitted" ? (review === "changes_requested" ? ta("reviseCta") : ta("update")) : ta("submitCta")}</Link>
                </Button>
              </div>
            );
          })
        )}
      </section>

      <section aria-label={t("nextShifts")} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl text-brand">{t("nextShifts")}</h2>
          <Button asChild variant="outline" size="sm"><Link href="/employee/schedule">{t("teamSchedule")}</Link></Button>
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft shadow-[var(--shadow-soft)]">{t("noShifts")}</p>
        ) : (
          <>
            <ul className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
              {upcoming.slice(0, 6).map((sh) => (
                <li key={sh.shift_id} className="flex flex-wrap justify-between gap-2 px-5 py-3.5">
                  <span className="font-medium capitalize">{dayLabel(romeDay(new Date(sh.starts_at)), locale)}</span>
                  <span className="tabular-nums">{formatWindow(new Date(sh.starts_at), new Date(sh.ends_at))}{sh.position ? ` · ${sh.position}` : ""}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-soft">{t("upcomingHours", { hours: upcomingHours })}</p>
          </>
        )}
      </section>
    </div>
  );
}
