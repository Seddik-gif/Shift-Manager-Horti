import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { weekRangeLabel } from "@/lib/format/week";
import { diffSnapshots, type Snapshot } from "@/lib/scheduling/snapshot";
import { mondayOf, todayInRome } from "@/lib/time/rome";
import type { Locale } from "@/i18n/routing";
import { WhatsAppPanel, type ShareState } from "./whatsapp-panel";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface VersionRow { version: number; snapshot: Snapshot; published_at: string; profiles: { first_name: string; last_name: string } | null }

export default async function VersionsPage({ params, searchParams }: PageProps<"/[locale]/admin/schedule/versions">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("publish");
  const ts = await getTranslations("schedule");
  const format = await getFormatter();

  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const supabase = await createClient();
  const { data: sched } = await supabase.from("weekly_schedules").select("id").eq("week_start", weekStart).maybeSingle<{ id: string }>();
  const { data } = sched
    ? await supabase.from("schedule_versions")
        .select("version, snapshot, published_at, profiles:published_by(first_name, last_name)")
        .eq("schedule_id", sched.id).order("version", { ascending: false }).returns<VersionRow[]>()
    : { data: [] as VersionRow[] };
  const versions = data ?? [];

  // Latest WhatsApp preparation for the current version (manual-sharing audit trail).
  let share: ShareState | null = null;
  if (sched && versions[0]) {
    const { data: row } = await supabase
      .from("whatsapp_shares")
      .select("id, message, copied_at, opened_at, confirmed_sent_at, confirmer:confirmed_by(first_name, last_name)")
      .eq("schedule_id", sched.id).eq("version", versions[0].version)
      .order("prepared_at", { ascending: false }).limit(1)
      .maybeSingle<{ id: string; message: string; copied_at: string | null; opened_at: string | null; confirmed_sent_at: string | null; confirmer: { first_name: string; last_name: string } | null }>();
    if (row) share = { id: row.id, message: row.message, copiedAt: row.copied_at, openedAt: row.opened_at, confirmedAt: row.confirmed_sent_at, confirmedBy: row.confirmer ? `${row.confirmer.first_name} ${row.confirmer.last_name}`.trim() : null };
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/schedule?date=${weekStart}`} className="text-sm text-brand underline">← {ts("title")}</Link>
        <h1 className="font-display text-4xl font-medium text-brand">{t("historyTitle")}</h1>
        <p className="text-lg capitalize">{weekRangeLabel(weekStart, locale)}</p>
      </div>

      {versions.length > 0 && <WhatsAppPanel key={share?.id ?? "new"} weekStart={weekStart} initial={share} />}

      {versions.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft shadow-[var(--shadow-soft)]">{t("noVersions")}</p>
      ) : (
        versions.map((v, i) => {
          const prev = versions[i + 1];
          const diff = prev ? diffSnapshots(prev.snapshot.shifts, v.snapshot.shifts) : null;
          return (
            <details key={v.version} open={i === 0} className="rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
              <summary className="cursor-pointer">
                <span className="font-display text-2xl text-brand">{t("version", { version: v.version })}</span>
                {i === 0 && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-ivory">{t("current")}</span>}
                <span className="ml-3 text-sm text-ink-soft">
                  {format.dateTime(new Date(v.published_at), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome", hourCycle: "h23" })}
                  {" · "}{v.profiles ? `${v.profiles.first_name} ${v.profiles.last_name}`.trim() : "—"}
                  {" · "}{t("shiftCount", { count: v.snapshot.shifts.length })}
                  {diff && ` · ${t("diff", diff)}`}
                </span>
              </summary>
              <div className="mt-4"><ScheduleList weekStart={weekStart} shifts={v.snapshot.shifts} /></div>
            </details>
          );
        })
      )}
    </div>
  );
}
