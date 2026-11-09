import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { weekRangeLabel } from "@/lib/format/week";
import { addDays, mondayOf, todayInRome } from "@/lib/time/rome";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import type { Locale } from "@/i18n/routing";
import { NewRequestForm } from "./new-request-form";

interface RequestRow { id: string; week_start: string; status: "draft" | "open" | "closed"; deadline: string }

export default async function AvailabilityPage({ params }: PageProps<"/[locale]/admin/availability">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("availability.admin");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("availability_requests")
    .select("id, week_start, status, deadline")
    .order("week_start", { ascending: false })
    .limit(30)
    .returns<RequestRow[]>();
  const requests = data ?? [];

  // next 8 Mondays that do not have a request yet
  const taken = new Set(requests.map((r) => r.week_start));
  const firstMonday = addDays(mondayOf(todayInRome()), 7);
  const free = Array.from({ length: 8 }, (_, i) => addDays(firstMonday, i * 7)).filter((w) => !taken.has(w));

  const badge = {
    draft: "bg-mist text-ink-soft",
    open: "bg-brand text-ivory",
    closed: "bg-brand-soft text-brand",
  } as const;

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="admin-availability-list" tables={[{ table: "availability_requests" }]} />
      <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>

      <section className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]">
        <h2 className="mb-4 font-display text-2xl text-brand">{t("newRequest")}</h2>
        <NewRequestForm weeks={free} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl text-brand">{t("requests")}</h2>
        {error ? (
          <p role="alert" className="text-danger">{t("loadError")}</p>
        ) : requests.length === 0 ? (
          <p className="text-ink-soft">{t("noRequests")}</p>
        ) : (
          <ul className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/availability/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-brand-soft/40">
                  <span className="font-medium capitalize">{weekRangeLabel(r.week_start, locale)}</span>
                  <span className={`rounded-full px-3 py-1 text-xs ${badge[r.status]}`}>{t(`status.${r.status}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
