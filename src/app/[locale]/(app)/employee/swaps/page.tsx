import { getTranslations, setRequestLocale } from "next-intl/server";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { requireEmployee } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time/rome";
import type { Locale } from "@/i18n/routing";
import { SwapsPanel, type MyShift, type SwapItem } from "./swaps-panel";

interface SwapRow { id: string; shift_id: string; proposer: string; recipient: string; note: string | null; status: SwapItem["status"]; decision_note: string | null }

export default async function SwapsPage({ params }: PageProps<"/[locale]/employee/swaps">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const me = await requireEmployee(locale);
  const t = await getTranslations("swaps");
  const supabase = await createClient();
  const now = new Date(nowMs()).toISOString();

  const [mineRes, swapsRes, dirRes] = await Promise.all([
    supabase.from("team_shifts").select("id, starts_at, ends_at, job_position").eq("employee_id", me.id).gt("starts_at", now).order("starts_at").limit(30)
      .returns<{ id: string; starts_at: string; ends_at: string; job_position: string | null }[]>(),
    supabase.from("shift_swaps").select("id, shift_id, proposer, recipient, note, status, decision_note").order("created_at", { ascending: false }).limit(40)
      .returns<SwapRow[]>(),
    supabase.from("team_directory").select("id, first_name, last_name").returns<{ id: string; first_name: string; last_name: string }[]>(),
  ]);
  const swaps = swapsRes.data ?? [];
  const names = new Map((dirRes.data ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
  // the shifts behind each swap (employees read them through the live calendar view)
  const { data: swapShifts } = swaps.length
    ? await supabase.from("team_shifts").select("id, starts_at, ends_at").in("id", swaps.map((s) => s.shift_id)).returns<{ id: string; starts_at: string; ends_at: string }[]>()
    : { data: [] as { id: string; starts_at: string; ends_at: string }[] };
  const when = new Map((swapShifts ?? []).map((s) => [s.id, { start: s.starts_at, end: s.ends_at }]));

  const active = new Set(swaps.filter((s) => s.status === "pending" || s.status === "review").map((s) => s.shift_id));
  const shifts: MyShift[] = (mineRes.data ?? []).map((s) => ({ id: s.id, start: s.starts_at, end: s.ends_at, position: s.job_position ?? "", hasSwap: active.has(s.id) }));
  const items: SwapItem[] = swaps.map((s) => ({
    id: s.id, status: s.status, note: s.note ?? "", decisionNote: s.decision_note ?? "",
    start: when.get(s.shift_id)?.start ?? null, end: when.get(s.shift_id)?.end ?? null,
    direction: s.recipient === me.id ? "incoming" : "outgoing",
    other: names.get(s.recipient === me.id ? s.proposer : s.recipient) ?? "?",
  }));

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`employee-swaps-${me.id}`} tables={[{ table: "shift_swaps" }, { table: "schedule_pulse" }]} />
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>
      <SwapsPanel shifts={shifts} items={items} locale={locale} />
    </div>
  );
}
