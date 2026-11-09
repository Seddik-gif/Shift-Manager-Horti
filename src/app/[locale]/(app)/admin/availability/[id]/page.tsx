import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { completionPercent } from "@/lib/availability/logic";
import { dayLabel, weekRangeLabel } from "@/lib/format/week";
import { formatWindow, weekDays } from "@/lib/time/rome";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { AvailabilityTimeline, type AvailabilityDay } from "@/components/schedule/availability-timeline";
import { RequestActions } from "./request-actions";
import { ReviewPanel } from "./review-panel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Emp { id: string; first_name: string; last_name: string; color: string }
interface Sub {
  id: string; review_status: "pending" | "confirmed" | "changes_requested"; review_note: string | null;
  employee_id: string; status: "draft" | "submitted"; notes: string | null; submitted_at: string | null;
  availability_days: { day: string; is_available: boolean; note: string | null }[];
  availability_time_windows: { day: string; starts_at: string; ends_at: string }[];
}

export default async function AvailabilityOverviewPage({ params, searchParams }: PageProps<"/[locale]/admin/availability/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const t = await getTranslations("availability.admin");
  const ta = await getTranslations("availability");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("availability_requests").select("id, week_start, deadline, message, status").eq("id", id)
    .maybeSingle<{ id: string; week_start: string; deadline: string; message: string | null; status: "draft" | "open" | "closed" }>();
  if (!request) notFound();

  const [{ data: employees }, { data: subs }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, color").eq("role", "employee").eq("is_active", true).order("first_name").returns<Emp[]>(),
    supabase.from("availability_submissions")
      .select("id, review_status, review_note, employee_id, status, notes, submitted_at, availability_days(day, is_available, note), availability_time_windows(day, starts_at, ends_at)")
      .eq("request_id", id).returns<Sub[]>(),
  ]);
  const emps = employees ?? [];
  const subBy = new Map((subs ?? []).map((s) => [s.employee_id, s]));
  const submittedCount = emps.filter((e) => subBy.get(e.id)?.status === "submitted").length;
  const pct = completionPercent(submittedCount, emps.length);
  const toReview = emps.filter((e) => subBy.get(e.id)?.status === "submitted" && subBy.get(e.id)?.review_status === "pending");
  const reviewOf = (e: Emp) => (subBy.get(e.id)?.status === "submitted" ? subBy.get(e.id)!.review_status : null);
  const days = weekDays(request.week_start);

  const employeeFilter = typeof sp.employee === "string" && UUID_RE.test(sp.employee) ? sp.employee : null;
  const dayFilter = typeof sp.day === "string" && DAY_RE.test(sp.day) && days.includes(sp.day) ? sp.day : null;
  const base = `/admin/availability/${id}`;

  const statusOf = (e: Emp) => {
    const s = subBy.get(e.id);
    return s?.status === "submitted" ? "submitted" : s ? "draft" : "pending";
  };
  /** Shows availability only for submitted answers; drafts are unfinished and must not drive decisions. */
  const cell = (e: Emp, day: string) => {
    const s = subBy.get(e.id);
    if (s?.status !== "submitted") return null;
    const d = s.availability_days.find((x) => x.day === day);
    if (!d) return null;
    const windows = s.availability_time_windows.filter((w) => w.day === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((w) => formatWindow(new Date(w.starts_at), new Date(w.ends_at)));
    return { available: d.is_available, windows, note: d.note };
  };

  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  const pill = (active: boolean) => cn("rounded-full px-3 py-1.5 text-sm", active ? "bg-brand text-ivory" : "bg-mist text-ink-soft hover:text-ink");
  const selected = employeeFilter ? emps.find((e) => e.id === employeeFilter) : null;

  return (
    <div className="space-y-6">
      <RealtimeRefresh
        channel={`admin-availability-${id}`}
        tables={[{ table: "availability_submissions", filter: `request_id=eq.${id}` }, { table: "availability_requests", filter: `id=eq.${id}` }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/availability" className="text-sm text-brand underline">← {t("title")}</Link>
          <h1 className="font-display text-4xl font-medium capitalize text-brand">{weekRangeLabel(request.week_start, locale)}</h1>
          <p className="text-sm text-ink-soft">
            {t(`status.${request.status}`)} · {t("deadlineLabel", { date: format.dateTime(new Date(request.deadline), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
          </p>
        </div>
        <RequestActions id={request.id} status={request.status} />
      </div>

      <section className={card} aria-label={t("completion")}>
        <div className="flex items-end justify-between">
          <p className="font-display text-5xl text-brand">{pct}%</p>
          <p className="text-sm text-ink-soft">{t("submittedOf", { done: submittedCount, total: emps.length })}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
        {emps.length === 0 && <p className="mt-3 text-sm text-ink-soft">{t("noEmployees")}</p>}
        <ul className="mt-4 flex flex-wrap gap-2">
          {emps.map((e) => {
            const st = statusOf(e);
            return (
              <li key={e.id}>
                <Link href={`${base}?employee=${e.id}`} className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1", st === "submitted" ? "bg-brand-soft ring-brand/20" : "bg-paper ring-brand/10")}>
                  <span className="size-3 rounded-full" style={{ backgroundColor: e.color }} aria-hidden />
                  {e.first_name} — <span className={st === "pending" ? "text-danger" : "text-brand"}>{t(`state.${st}`)}</span>
                  {reviewOf(e) && <span className={cn("rounded-full px-2 py-0.5 text-[11px]", reviewOf(e) === "confirmed" ? "bg-brand text-ivory" : reviewOf(e) === "pending" ? "bg-amber-200 text-amber-900" : "bg-red-100 text-danger")}>{ta(`review.short.${reviewOf(e)!}`)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        {toReview.length > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {ta("review.waiting", { count: toReview.length })}{" "}
            <Link href={`${base}?employee=${toReview[0].id}`} className="font-medium underline">{ta("review.reviewNow")}</Link>
          </p>
        )}
      </section>

      <nav className="flex flex-wrap gap-2" aria-label={t("views")}>
        <Link href={base} className={pill(!employeeFilter && !dayFilter)}>{t("viewWeek")}</Link>
        {days.map((d) => <Link key={d} href={`${base}?day=${d}`} className={cn(pill(dayFilter === d), "capitalize")}>{dayLabel(d, locale, "short")}</Link>)}
        {selected && <span className={pill(true)}>{selected.first_name} {selected.last_name}</span>}
      </nav>

      {selected ? (
        <section className={cn(card, "space-y-4")}>
          <h2 className="font-display text-2xl text-brand">{selected.first_name} {selected.last_name}</h2>
          {subBy.get(selected.id)?.status === "submitted" ? (
            <>
              {subBy.get(selected.id)?.notes && <p className="rounded-xl bg-brand-soft p-3 text-sm">{subBy.get(selected.id)?.notes}</p>}
              <AvailabilityTimeline days={days.map((d): AvailabilityDay => {
                const s = subBy.get(selected.id)!;
                const dd = s.availability_days.find((x) => x.day === d);
                return {
                  day: d, available: dd ? dd.is_available : null, note: dd?.note ?? "",
                  windows: s.availability_time_windows.filter((w) => w.day === d).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                    .map((w) => ({ startsAt: new Date(w.starts_at), endsAt: new Date(w.ends_at) })),
                };
              })} />
              <ReviewPanel submissionId={subBy.get(selected.id)!.id} review={subBy.get(selected.id)!.review_status} note={subBy.get(selected.id)!.review_note ?? ""} name={selected.first_name} />
            </>
          ) : (
            <p className="text-ink-soft">{t(`state.${statusOf(selected)}`)}</p>
          )}
        </section>
      ) : dayFilter ? (
        <section className={card}>
          <h2 className="font-display text-2xl capitalize text-brand">{dayLabel(dayFilter, locale)}</h2>
          <ul className="mt-3 divide-y divide-brand/10">
            {emps.map((e) => {
              const c = cell(e, dayFilter);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`${base}?employee=${e.id}`} className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: e.color }} aria-hidden />{e.first_name} {e.last_name}
                  </Link>
                  <span className={cn("text-right", c?.available ? "font-medium text-brand" : "text-ink-soft")}>
                    {!c ? t(`state.${statusOf(e)}`) : c.available ? c.windows.join(" · ") : ta("unavailable")}
                    {c?.note && <span className="block text-xs font-normal">{c.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className={cn(card, "overflow-x-auto p-0")}>
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-brand/10 text-left text-ink-soft">
                <th scope="col" className="sticky left-0 bg-paper px-4 py-3 font-medium">{t("employee")}</th>
                {days.map((d) => <th key={d} scope="col" className="px-3 py-3 font-medium capitalize">{dayLabel(d, locale, "short")}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand/10">
              {emps.map((e) => (
                <tr key={e.id} className="align-top">
                  <th scope="row" className="sticky left-0 bg-paper px-4 py-3 text-left font-medium">
                    <Link href={`${base}?employee=${e.id}`} className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ backgroundColor: e.color }} aria-hidden />{e.first_name}
                    </Link>
                  </th>
                  {days.map((d) => {
                    const c = cell(e, d);
                    return (
                      <td key={d} className="px-3 py-3">
                        {!c ? <span className="text-ink-soft">{statusOf(e) === "submitted" ? "—" : "·"}</span>
                          : c.available ? <span className="block font-medium text-brand">{c.windows.map((w) => <span key={w} className="block">{w}</span>)}</span>
                          : <span className="text-ink-soft">{ta("unavailable")}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
