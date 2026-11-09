import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireEmployee } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { emptyWeek, type DayInput } from "@/lib/availability/logic";
import { weekRangeLabel } from "@/lib/format/week";
import { romeTime } from "@/lib/time/rome";
import type { Locale } from "@/i18n/routing";
import { AvailabilityForm } from "./availability-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EmployeeAvailabilityPage({ params }: PageProps<"/[locale]/employee/availability/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  const profile = await requireEmployee(locale);
  if (!UUID_RE.test(id)) notFound();
  const t = await getTranslations("availability");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("availability_requests")
    .select("id, week_start, deadline, message, status")
    .eq("id", id)
    .maybeSingle<{ id: string; week_start: string; deadline: string; message: string | null; status: "open" | "closed" | "draft" }>();
  if (!request) notFound();

  const { data: sub } = await supabase
    .from("availability_submissions")
    .select("id, status, review_status, review_note, notes, availability_days(day, is_available, note), availability_time_windows(day, starts_at, ends_at)")
    .eq("request_id", id)
    .eq("employee_id", profile.id)
    .maybeSingle<{
      id: string; status: "draft" | "submitted"; review_status: "pending" | "confirmed" | "changes_requested"; review_note: string | null; notes: string | null;
      availability_days: { day: string; is_available: boolean; note: string | null }[];
      availability_time_windows: { day: string; starts_at: string; ends_at: string }[];
    }>();

  const initialDays: DayInput[] = emptyWeek(request.week_start).map((blank) => {
    const d = sub?.availability_days.find((x) => x.day === blank.day);
    if (!d) return blank;
    const windows = (sub?.availability_time_windows ?? [])
      .filter((w) => w.day === blank.day)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((w) => ({ start: romeTime(new Date(w.starts_at)), end: romeTime(new Date(w.ends_at)) }));
    return { day: blank.day, available: d.is_available, note: d.note ?? "", windows };
  });

  const deadline = format.dateTime(new Date(request.deadline), {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="mt-1 text-lg capitalize">{weekRangeLabel(request.week_start, locale)}</p>
        <p className="text-sm text-ink-soft">{t("deadline", { date: deadline })}</p>
        {request.message && (
          <p className="mt-3 rounded-xl bg-brand-soft p-3 text-sm text-brand">{request.message}</p>
        )}
      </div>

      {sub?.status === "submitted" && (
        <div role="status" className={`rounded-2xl p-4 text-sm ring-1 ${sub.review_status === "confirmed" ? "bg-brand-soft text-brand ring-brand/20" : sub.review_status === "changes_requested" ? "bg-red-50 text-danger ring-danger/30" : "bg-amber-50 text-amber-900 ring-amber-300"}`}>
          <p className="font-medium">{t(`reviewState.${sub.review_status}`)}</p>
          {sub.review_status === "changes_requested" && sub.review_note && <p className="mt-1">“{sub.review_note}”</p>}
          {sub.review_status === "pending" && <p className="mt-1">{t("reviewPendingHint")}</p>}
        </div>
      )}

      {request.status === "open" ? (
        <AvailabilityForm
          requestId={request.id}
          initialDays={initialDays}
          initialNotes={sub?.notes ?? ""}
          alreadySubmitted={sub?.status === "submitted"}
        />
      ) : (
        <p role="status" className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft shadow-[var(--shadow-soft)]">
          {t("closedNotice")}
        </p>
      )}
    </div>
  );
}
