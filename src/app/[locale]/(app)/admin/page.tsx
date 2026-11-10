import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/guards";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import { completionPercent } from "@/lib/availability/logic";
import { weekRangeLabel } from "@/lib/format/week";
import { loadWeek } from "@/lib/scheduling/load-week";
import { addDays, mondayOf, todayInRome } from "@/lib/time/rome";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { PushCard } from "@/components/pwa/push-card";
import type { Locale } from "@/i18n/routing";

export default async function AdminDashboard({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireAdmin(locale);
  const t = await getTranslations("admin");
  const format = await getFormatter();

  // Real data only: the count comes straight from the database (RLS: admin).
  const supabase = await createClient();
  const { active } = await getLocationContext();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "employee")
    .eq("is_active", true);

  // Latest open availability request: who has answered and who has not.
  const { data: openReq } = await supabase
    .from("availability_requests")
    .select("id, week_start")
    .eq("status", "open")
    .order("week_start")
    .limit(1)
    .maybeSingle<{ id: string; week_start: string }>();
  let pendingNames: string[] = [];
  let submittedCount = 0;
  if (openReq) {
    const [{ data: emps }, { data: subs }] = await Promise.all([
      supabase.from("profiles").select("id, first_name").eq("role", "employee").eq("is_active", true).order("first_name"),
      supabase.from("availability_submissions").select("employee_id").eq("request_id", openReq.id).eq("status", "submitted"),
    ]);
    const done = new Set((subs ?? []).map((s) => s.employee_id));
    submittedCount = (emps ?? []).filter((e) => done.has(e.id)).length;
    pendingNames = (emps ?? []).filter((e) => !done.has(e.id)).map((e) => e.first_name);
  }

  // Schedules that still need publishing, and the most recent publications.
  const { data: schedRows } = await supabase
    .from("weekly_schedules")
    .select("week_start, status, has_unpublished_changes, shifts(count)")
    .eq("location_id", active?.id ?? "")
    .gte("week_start", addDays(mondayOf(todayInRome()), -7))
    .order("week_start")
    .returns<{ week_start: string; status: "draft" | "published"; has_unpublished_changes: boolean; shifts: { count: number }[] }[]>();
  const drafts = (schedRows ?? []).filter((s) => (s.status === "draft" && (s.shifts[0]?.count ?? 0) > 0) || s.has_unpublished_changes);
  const { data: recent } = await supabase
    .from("weekly_schedules")
    .select("week_start, published_at, current_version")
    .eq("location_id", active?.id ?? "")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(3)
    .returns<{ week_start: string; published_at: string; current_version: number }[]>();
  const { count: pendingRequests } = await supabase.from("shift_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  let warningCount = 0;
  if (drafts[0] && active) {
    const w = await loadWeek(supabase, drafts[0].week_start, active.id);
    warningCount = w.analysis.warnings.filter((x) => x.type !== "overridden" && x.type !== "no_shifts").length;
  }

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="admin-dashboard" tables={[{ table: "availability_submissions" }, { table: "availability_requests" }, { table: "weekly_schedules" }, { table: "shift_requests" }]} />
      <div>
        <p className="text-sm capitalize text-ink-soft">
          {format.dateTime(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        <h1 className="font-display text-4xl font-medium text-brand">
          {t("greeting", { name: profile.first_name })}
        </h1>
        <p className="mt-1 text-ink-soft">{t("subtitle")}</p>
      </div>

      <PushCard />

      <section aria-label={t("quickActions")} className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/admin/employees/new">{t("addEmployee")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/admin/availability">{t("requestAvailability")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/admin/schedule">{t("openWeek")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/admin/schedule?view=month">{t("openMonth")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/admin/schedule">{t("createShifts")}</Link>
        </Button>
      </section>

      {error ? (
        <p role="alert" className="text-danger">{t("loadError")}</p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]">
            <p className="text-sm text-ink-soft">{t("activeEmployees")}</p>
            <p className="mt-2 font-display text-5xl text-brand">{count ?? 0}</p>
            {count === 0 && <p className="mt-3 text-sm text-ink-soft">{t("noEmployees")}</p>}
          </div>
          <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] sm:col-span-2">
            <p className="text-sm text-ink-soft">{t("availabilityRequest")}</p>
            {openReq ? (
              <>
                <Link href={`/admin/availability/${openReq.id}`} className="mt-1 block font-medium capitalize text-brand underline">
                  {weekRangeLabel(openReq.week_start, locale)}
                </Link>
                <p className="mt-2 font-display text-5xl text-brand">{completionPercent(submittedCount, submittedCount + pendingNames.length)}%</p>
                <p className="mt-2 text-sm">
                  {pendingNames.length === 0 ? t("everyoneResponded") : <>{t("notResponded")}: <strong>{pendingNames.join(", ")}</strong></>}
                </p>
              </>
            ) : (
              <p className="mt-2 text-ink-soft">{t("noOpenRequest")}</p>
            )}
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2" aria-label={t("publishing")}>
        <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)] lg:col-span-2">
          <p className="text-sm text-ink-soft">{t("pendingRequests")}</p>
          {(pendingRequests ?? 0) === 0 ? <p className="mt-2 text-ink-soft">{t("noPendingRequests")}</p> : (
            <p className="mt-2 flex items-center justify-between gap-3">
              <span className="font-display text-4xl text-brand">{pendingRequests}</span>
              <Link href="/admin/requests" className="font-medium text-brand underline">{t("reviewRequests")}</Link>
            </p>
          )}
        </div>
        <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]">
          <p className="text-sm text-ink-soft">{t("unpublished")}</p>
          {drafts.length === 0 ? <p className="mt-2 text-ink-soft">{t("noDrafts")}</p> : (
            <ul className="mt-2 space-y-2">
              {drafts.map((d) => (
                <li key={d.week_start} className="flex items-center justify-between gap-3">
                  <span className="font-medium capitalize">{weekRangeLabel(d.week_start, locale)}{d.has_unpublished_changes ? ` · ${t("changed")}` : ""}</span>
                  <Link href={`/admin/schedule/review?date=${d.week_start}`} className="text-sm text-brand underline">{t("reviewPublish")}</Link>
                </li>
              ))}
            </ul>
          )}
          {drafts[0] && <p className="mt-3 text-sm">{warningCount === 0 ? t("noWarnings") : t("warningsCount", { count: warningCount })}</p>}
        </div>
        <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]">
          <p className="text-sm text-ink-soft">{t("recentlyPublished")}</p>
          {!recent?.length ? <p className="mt-2 text-ink-soft">{t("nonePublished")}</p> : (
            <ul className="mt-2 space-y-2">
              {recent.map((r) => (
                <li key={r.week_start} className="flex items-center justify-between gap-3">
                  <span className="font-medium capitalize">{weekRangeLabel(r.week_start, locale)} · v{r.current_version}</span>
                  <Link href={`/admin/schedule/versions?date=${r.week_start}`} className="text-sm text-brand underline">{t("history")}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
