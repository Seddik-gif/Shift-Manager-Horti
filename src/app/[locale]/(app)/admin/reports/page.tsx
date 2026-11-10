import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getLocationContext } from "@/lib/locations/active";
import { loadReport } from "@/lib/reports/load";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayInRome } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** first and last day of the month containing `day` */
function monthBounds(day: string, delta = 0): { from: string; to: string } {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  const from = d.toISOString().slice(0, 10);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, to: addDays(d.toISOString().slice(0, 10), -1) };
}

const nf = (locale: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default async function ReportsPage({ params, searchParams }: PageProps<"/[locale]/admin/reports">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("reports");
  const { all: locations } = await getLocationContext();

  const today = todayInRome();
  const month = monthBounds(today);
  const from = typeof sp.from === "string" && DAY_RE.test(sp.from) ? sp.from : month.from;
  let to = typeof sp.to === "string" && DAY_RE.test(sp.to) ? sp.to : month.to;
  if (to < from) to = from;
  const loc = typeof sp.loc === "string" && UUID_RE.test(sp.loc) && locations.some((l) => l.id === sp.loc) ? sp.loc : "";

  const supabase = await createClient();
  const { places, summary } = await loadReport(supabase, from, to, loc || null);
  const n = nf(locale);

  const qs = (f: string, tt: string) => `?from=${f}&to=${tt}${loc ? `&loc=${loc}` : ""}`;
  const thisWeekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const presets = [
    { label: t("thisWeek"), from: thisWeekStart, to: addDays(thisWeekStart, 6) },
    { label: t("thisMonth"), ...month },
    { label: t("lastMonth"), ...monthBounds(today, -1) },
  ];
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  const field = "min-h-11 rounded-xl border border-brand/20 bg-white px-3 text-base";
  const exportHref = `/api/reports/hours${qs(from, to)}&lang=${locale}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("subtitle")}</p>
      </div>

      <form method="get" className={cn(card, "flex flex-wrap items-end gap-3")}>
        <label className="grid gap-1 text-sm">{t("from")}<input type="date" name="from" defaultValue={from} required className={field} /></label>
        <label className="grid gap-1 text-sm">{t("to")}<input type="date" name="to" defaultValue={to} required className={field} /></label>
        <label className="grid gap-1 text-sm">{t("location")}
          <select name="loc" defaultValue={loc} className={field}>
            <option value="">{t("allLocations")}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-full bg-brand px-5 text-sm font-medium text-ivory hover:bg-brand-dark">{t("apply")}</button>
        <a href={exportHref} className="min-h-11 rounded-full border border-brand/30 px-5 py-2.5 text-sm font-medium text-brand hover:bg-brand-soft">⬇ {t("download")}</a>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label={t("presets")}>
        {presets.map((p) => (
          <Link key={p.label} href={`/admin/reports${qs(p.from, p.to)}`} className={cn("rounded-full px-4 py-2 text-sm", p.from === from && p.to === to ? "bg-brand text-ivory" : "bg-mist text-ink-soft hover:text-ink")}>{p.label}</Link>
        ))}
      </nav>

      <section className={card}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-2 pr-3 font-medium">{t("employee")}</th>
                <th className="py-2 px-3 text-right font-medium">{t("shifts")}</th>
                <th className="py-2 px-3 text-right font-medium">{t("hours")}</th>
                {places.map((l) => <th key={l.id} className="py-2 pl-3 text-right font-medium">{l.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand/10">
              {summary.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="py-2.5 pr-3">{r.name}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{r.shifts}</td>
                  <td className="py-2.5 px-3 text-right font-medium tabular-nums">{n.format(r.hours)}</td>
                  {places.map((l) => <td key={l.id} className="py-2.5 pl-3 text-right tabular-nums text-ink-soft">{n.format(r.byLocation[l.id] ?? 0)}</td>)}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2.5 pr-3">{t("total")}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{summary.totals.shifts}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{n.format(summary.totals.hours)}</td>
                {places.map((l) => <td key={l.id} className="py-2.5 pl-3 text-right tabular-nums">{n.format(summary.totals.byLocation[l.id] ?? 0)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        {summary.totals.shifts === 0 && <p className="mt-3 text-sm text-ink-soft">{t("noData")}</p>}
        <p className="mt-4 text-xs text-ink-soft">{t("note")}</p>
      </section>
    </div>
  );
}
