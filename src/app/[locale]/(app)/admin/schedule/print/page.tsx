import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { dayLabel, weekRangeLabel } from "@/lib/format/week";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import { addDays, mondayOf, romeDay, romeInstant, todayInRome, weekDays } from "@/lib/time/rome";
import type { Locale } from "@/i18n/routing";
import { PrintButton } from "./print-button";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Emp { id: string; first_name: string; last_name: string; color: string; employee_locations?: { location_id: string }[] }
interface Shift { id: string; employee_id: string; starts_at: string; ends_at: string; job_position: string | null; weekly_schedules: { location_id: string } }

/** Clean A4 (landscape) grid of one week: people down the side, days across. One bar, or (with ?all=1) every bar together. */
export default async function PrintSchedulePage({ params, searchParams }: PageProps<"/[locale]/admin/schedule/print">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("print");
  const ts = await getTranslations("schedule");
  const format = await getFormatter();
  const { active, all: locations } = await getLocationContext();
  const allBars = sp.all === "1";
  if (!active) return <p className="text-ink-soft">{(await getTranslations("locations"))("none")}</p>;

  const date = typeof sp.date === "string" && DAY_RE.test(sp.date) ? sp.date : todayInRome();
  const weekStart = mondayOf(date);
  const days = weekDays(weekStart);
  const supabase = await createClient();

  const empQuery = allBars
    ? supabase.from("profiles").select("id, first_name, last_name, color").eq("role", "employee").eq("is_active", true).order("first_name").returns<Emp[]>()
    : supabase.from("profiles").select("id, first_name, last_name, color, employee_locations!inner(location_id)")
        .eq("role", "employee").eq("is_active", true).eq("employee_locations.location_id", active.id).order("first_name").returns<Emp[]>();
  let shiftQuery = supabase.from("shifts").select("id, employee_id, starts_at, ends_at, job_position, weekly_schedules!inner(location_id)")
    .gte("starts_at", romeInstant(weekStart, "00:00").toISOString()).lt("starts_at", romeInstant(addDays(weekStart, 7), "00:00").toISOString())
    .order("starts_at");
  if (!allBars) shiftQuery = shiftQuery.eq("weekly_schedules.location_id", active.id);
  const [{ data: emps }, { data: shiftRows }, { data: schedRows }] = await Promise.all([
    empQuery,
    shiftQuery.returns<Shift[]>(),
    supabase.from("weekly_schedules").select("location_id, status, published_at, publisher:published_by(first_name)").eq("week_start", weekStart)
      .returns<{ location_id: string; status: "draft" | "published"; published_at: string | null; publisher: { first_name: string } | null }[]>(),
  ]);
  const sched = allBars ? null : (schedRows ?? []).find((r) => r.location_id === active.id) ?? null;
  const place = new Map(locations.map((l) => [l.id, l]));
  // with every bar on one sheet, name the bars whose week is still a draft
  const draftBars = allBars ? (schedRows ?? []).filter((r) => r.status !== "published").map((r) => place.get(r.location_id)?.name).filter(Boolean) as string[] : [];

  // people who have shifts but are no longer assigned still belong on the sheet
  const shifts = shiftRows ?? [];
  const known = new Set((emps ?? []).map((e) => e.id));
  const missingIds = [...new Set(shifts.map((s) => s.employee_id))].filter((id) => !known.has(id));
  const { data: extra } = missingIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name, color").in("id", missingIds).returns<Omit<Emp, "employee_locations">[]>()
    : { data: [] as Omit<Emp, "employee_locations">[] };
  const people = [...(emps ?? []), ...(extra ?? [])].sort((a, b) => a.first_name.localeCompare(b.first_name, locale));

  const hm = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
  const cell = (empId: string, day: string) => shifts.filter((s) => s.employee_id === empId && romeDay(new Date(s.starts_at)) === day);
  const overnight = (s: Shift) => romeDay(new Date(new Date(s.ends_at).getTime() - 1000)) !== romeDay(new Date(s.starts_at));
  const published = allBars ? draftBars.length === 0 : sched?.status === "published";
  const printedOn = format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });
  const publishedLine = !allBars && published && sched?.published_at
    ? ts("publishedBy", { name: sched.publisher?.first_name ?? "?", when: format.dateTime(new Date(sched.published_at), { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" }) })
    : null;

  return (
    <div className="mx-auto max-w-[297mm] space-y-4 bg-white p-4 text-black print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm; } @media print { html, body { background: #fff !important; } }"}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/schedule?date=${weekStart}`} className="text-sm text-brand underline">← {t("back")}</Link>
        <PrintButton label={t("printAction")} />
      </div>

      <header className="flex items-end justify-between gap-4 border-b-4 pb-2" style={{ borderColor: allBars ? "#234A49" : active.color }}>
        <div>
          <p className="text-xs font-semibold tracking-[0.25em]">HORTI MAGICI</p>
          <h1 className="font-display text-3xl font-medium">{allBars ? t("allBars") : active.name}</h1>
          <p className="text-lg capitalize">{weekRangeLabel(weekStart, locale)}</p>
        </div>
        <div className="text-right text-sm">
          {!published && <p className="inline-block rounded border-2 border-black px-2 py-0.5 font-bold tracking-wider">{t("draft")}{allBars && draftBars.length > 0 ? ` · ${draftBars.join(", ")}` : ""}</p>}
          {publishedLine && <p>{publishedLine}</p>}
        </div>
      </header>

      {people.length === 0 || shifts.length === 0 ? <p className="py-10 text-center text-gray-600">{t("empty")}</p> : (
        <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
          <thead>
            <tr>
              <th className="w-[13%] border border-gray-400 bg-gray-100 p-1.5 text-left">{t("employee")}</th>
              {days.map((d) => <th key={d} className="border border-gray-400 bg-gray-100 p-1.5 capitalize">{dayLabel(d, locale, "short")}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="break-inside-avoid">
                <th scope="row" className="border border-gray-400 p-1.5 text-left font-semibold">
                  <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: p.color }} aria-hidden />{p.first_name} {p.last_name}
                </th>
                {days.map((d) => (
                  <td key={d} className="h-9 border border-gray-400 p-1 text-center align-top">
                    {cell(p.id, d).map((s) => (
                      <p key={s.id} className="whitespace-nowrap font-medium tabular-nums">
                        {hm(s.starts_at)}–{hm(s.ends_at)}{overnight(s) ? "*" : ""}
                        {allBars && <span className="block whitespace-normal text-[10px] font-normal"><span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ backgroundColor: place.get(s.weekly_schedules.location_id)?.color }} aria-hidden />{place.get(s.weekly_schedules.location_id)?.name}</span>}
                        {s.job_position && <span className="block whitespace-normal text-[10px] font-normal text-gray-600">{s.job_position}</span>}
                      </p>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="flex justify-between text-[10px] text-gray-600">
        <span>{t("overnight")}</span>
        <span>{t("printedOn", { when: printedOn })}</span>
      </footer>
    </div>
  );
}
