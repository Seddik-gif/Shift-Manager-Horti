import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { addDays, romeInstant, todayInRome } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { AbsenceRow } from "./absence-row";
import { SwapRow } from "./swap-row";
import { RequestRow } from "./request-row";

interface Row {
  id: string; kind: "take" | "offer"; starts_at: string; ends_at: string; note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled"; decision_note: string | null; decided_at: string | null; created_at: string;
  employee: { first_name: string; last_name: string; color: string } | null;
  decider: { first_name: string } | null;
  location: { name: string } | null;
}

export default async function RequestsPage({ params }: PageProps<"/[locale]/admin/requests">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("requests");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shift_requests")
    .select("id, kind, starts_at, ends_at, note, status, decision_note, decided_at, created_at, employee:employee_id(first_name, last_name, color), decider:decided_by(first_name), location:location_id(name)")
    .order("created_at", { ascending: false })
    .limit(60)
    .returns<Row[]>();
  const rows = data ?? [];
  const { data: absData } = await supabase
    .from("absence_requests")
    .select("id, kind, start_date, end_date, reason, employee:employee_id(first_name, last_name, color)")
    .eq("status", "pending").order("start_date").limit(60)
    .returns<{ id: string; kind: "ferie" | "assenza"; start_date: string; end_date: string; reason: string | null; employee: { first_name: string; last_name: string; color: string } | null }[]>();
  const { data: decidedAbs } = await supabase
    .from("absence_requests")
    .select("id, employee_id, kind, status, start_date, end_date, employee:employee_id(first_name, last_name)")
    .in("status", ["approved", "rejected"]).order("decided_at", { ascending: false }).limit(8)
    .returns<{ id: string; employee_id: string; kind: "ferie" | "assenza"; status: "approved" | "rejected"; start_date: string; end_date: string; employee: { first_name: string; last_name: string } | null }[]>();
  // planned shifts still inside a recently approved absence: survives page refreshes, unlike a one-off message
  const today = todayInRome();
  const recentAbs = await Promise.all((decidedAbs ?? []).map(async (a) => {
    let conflicts = 0;
    if (a.status === "approved" && a.end_date >= today) {
      const { count } = await supabase.from("shifts").select("id", { count: "exact", head: true })
        .eq("employee_id", a.employee_id)
        .lt("starts_at", romeInstant(addDays(a.end_date, 1), "00:00").toISOString())
        .gt("ends_at", romeInstant(a.start_date, "00:00").toISOString());
      conflicts = count ?? 0;
    }
    return { ...a, conflicts };
  }));
  const { data: swapData } = await supabase
    .from("shift_swaps")
    .select("id, note, from_p:proposer(first_name, last_name, color), to_p:recipient(first_name, last_name), shift:shift_id(starts_at, ends_at)")
    .eq("status", "review").order("responded_at").limit(60)
    .returns<{ id: string; note: string | null; from_p: { first_name: string; last_name: string; color: string } | null; to_p: { first_name: string; last_name: string } | null; shift: { starts_at: string; ends_at: string } | null }[]>();
  const tSwap = await getTranslations("swaps");
  const tAbs = await getTranslations("requestsAbsences");
  const absRange = (a: string, b: string) => {
    const f = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00Z`));
    return a === b ? f(a) : `${f(a)} – ${f(b)}`;
  };
  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  const when = (r: Row) => {
    const day = format.dateTime(new Date(r.starts_at), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
    const time = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
    return `${day} · ${time(r.starts_at)}–${time(r.ends_at)}${r.location ? ` · ${r.location.name}` : ""}`;
  };
  const who = (r: Row) => (r.employee ? `${r.employee.first_name} ${r.employee.last_name}`.trim() : "?");
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="admin-requests" tables={[{ table: "shift_requests" }, { table: "absence_requests" }, { table: "shift_swaps" }]} />
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>

      {error && <p role="alert" className="text-danger">{t("loadError")}</p>}

      <section aria-label={tSwap("adminTitle")} className="space-y-3">
        <h2 className="font-display text-2xl text-brand">{tSwap("adminTitle")} <span className="text-base text-ink-soft">({(swapData ?? []).length})</span></h2>
        {(swapData ?? []).length === 0 ? <p className={cn(card, "text-ink-soft")}>{tSwap("adminNone")}</p> : (swapData ?? []).map((s) => {
          const person = (p: { first_name: string; last_name: string } | null) => (p ? `${p.first_name} ${p.last_name}`.trim() : "?");
          const time = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
          const day = s.shift ? format.dateTime(new Date(s.shift.starts_at), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" }) : "";
          return <SwapRow key={s.id} id={s.id} from={person(s.from_p)} to={person(s.to_p)} color={s.from_p?.color ?? "#234A49"}
            when={s.shift ? `${day} · ${time(s.shift.starts_at)}–${time(s.shift.ends_at)}` : "—"} note={s.note ?? ""} />;
        })}
      </section>

      <section aria-label={tAbs("title")} className="space-y-3">
        <h2 className="font-display text-2xl text-brand">{tAbs("title")} <span className="text-base text-ink-soft">({(absData ?? []).length})</span></h2>
        {(absData ?? []).length === 0 ? <p className={cn(card, "text-ink-soft")}>{tAbs("none")}</p> : (absData ?? []).map((a) => (
          <AbsenceRow key={a.id} id={a.id} who={a.employee ? `${a.employee.first_name} ${a.employee.last_name}`.trim() : "?"} color={a.employee?.color ?? "#234A49"}
            kind={a.kind} when={absRange(a.start_date, a.end_date)} reason={a.reason ?? ""} />
        ))}
        {recentAbs.length > 0 && (
          <ul className={cn(card, "space-y-2 text-sm")} aria-label={tAbs("recent")}>
            {recentAbs.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{a.employee ? `${a.employee.first_name} ${a.employee.last_name}`.trim() : "?"} · {absRange(a.start_date, a.end_date)} · {tAbs(a.status === "approved" ? "approved" : "rejected")}</span>
                {a.conflicts > 0 && <span className="rounded-full bg-amber-100 px-3 py-0.5 text-amber-900">{tAbs("conflictsShort", { count: a.conflicts })}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("pending")} className="space-y-3">
        <h2 className="font-display text-2xl text-brand">{t("pending")} <span className="text-base text-ink-soft">({pending.length})</span></h2>
        {pending.length === 0 ? <p className={cn(card, "text-ink-soft")}>{t("nonePending")}</p> : pending.map((r) => (
          <RequestRow key={r.id} id={r.id} who={who(r)} color={r.employee?.color ?? "#234A49"} kind={r.kind} when={when(r)} note={r.note ?? ""} />
        ))}
      </section>

      <section aria-label={t("history")} className="space-y-3">
        <h2 className="font-display text-2xl text-brand">{t("history")}</h2>
        {history.length === 0 ? <p className="text-ink-soft">{t("noneHistory")}</p> : (
          <ul className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span><strong>{who(r)}</strong> · {t(`kind.${r.kind}`)} · <span className="capitalize">{when(r)}</span></span>
                <span className="text-ink-soft">
                  {t(`status.${r.status}`)}{r.decider ? ` · ${r.decider.first_name}` : ""}{r.decision_note ? ` · “${r.decision_note}”` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
