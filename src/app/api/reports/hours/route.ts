import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import it from "../../../../../messages/it.json";
import en from "../../../../../messages/en.json";
import { getSessionProfile } from "@/lib/auth/guards";
import { shiftHours } from "@/lib/reports/hours";
import { loadReport } from "@/lib/reports/load";
import { createClient } from "@/lib/supabase/server";
import { TZ } from "@/lib/time/rome";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cell that starts with = + - @ would be run as a formula by Excel: neutralise it. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** The hour report as an Excel file. Administrators only. */
export async function GET(request: Request) {
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active || profile.role !== "admin") return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const loc = url.searchParams.get("loc") ?? "";
  const lang: "it" | "en" = url.searchParams.get("lang") === "en" ? "en" : "it";
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || to < from) return new Response("Bad dates", { status: 400 });
  const locationId = UUID_RE.test(loc) ? loc : null;

  const supabase = await createClient();
  const { shifts, people, places, summary } = await loadReport(supabase, from, to, locationId);
  const t = createTranslator({ locale: lang, messages: lang === "en" ? en : it, namespace: "reports" });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const placeName = new Map(places.map((l) => [l.id, l.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Horti Magici";

  // ── summary: one row per person ──
  const s1 = wb.addWorksheet(t("sheetSummary"), { views: [{ state: "frozen", ySplit: 1 }] });
  s1.columns = [
    { header: t("employee"), key: "name", width: 28 },
    { header: t("shifts"), key: "shifts", width: 10 },
    { header: t("hours"), key: "hours", width: 12 },
    ...places.map((l) => ({ header: safe(l.name), key: `l_${l.id}`, width: 14 })),
  ];
  for (const r of summary.rows) {
    s1.addRow({ name: safe(r.name), shifts: r.shifts, hours: r.hours, ...Object.fromEntries(places.map((l) => [`l_${l.id}`, r.byLocation[l.id] ?? 0])) });
  }
  const total = s1.addRow({ name: t("total"), shifts: summary.totals.shifts, hours: summary.totals.hours, ...Object.fromEntries(places.map((l) => [`l_${l.id}`, summary.totals.byLocation[l.id] ?? 0])) });
  total.font = { bold: true };
  s1.getRow(1).font = { bold: true };
  for (let c = 3; c <= 3 + places.length; c++) s1.getColumn(c).numFmt = "0.00";

  // ── detail: one row per shift ──
  const s2 = wb.addWorksheet(t("sheetDetail"), { views: [{ state: "frozen", ySplit: 1 }] });
  s2.columns = [
    { header: t("date"), key: "date", width: 14 },
    { header: t("employee"), key: "name", width: 28 },
    { header: t("location"), key: "place", width: 18 },
    { header: t("position"), key: "pos", width: 18 },
    { header: t("start"), key: "start", width: 9 },
    { header: t("end"), key: "end", width: 9 },
    { header: t("hours"), key: "hours", width: 10 },
  ];
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const s of shifts) {
    s2.addRow({
      date: d.format(new Date(s.startsAt)), name: safe(nameOf.get(s.employeeId) ?? "?"), place: safe(placeName.get(s.locationId) ?? "?"), pos: safe(s.position),
      start: hm.format(new Date(s.startsAt)), end: hm.format(new Date(s.endsAt)), hours: shiftHours(s.startsAt, s.endsAt),
    });
  }
  s2.getRow(1).font = { bold: true };
  s2.getColumn(7).numFmt = "0.00";

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${lang === "en" ? "hours" : "ore"}-${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
