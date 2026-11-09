import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { RequestRow } from "./request-row";

interface Row {
  id: string; kind: "take" | "offer"; starts_at: string; ends_at: string; note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled"; decision_note: string | null; decided_at: string | null; created_at: string;
  employee: { first_name: string; last_name: string; color: string } | null;
  decider: { first_name: string } | null;
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
    .select("id, kind, starts_at, ends_at, note, status, decision_note, decided_at, created_at, employee:employee_id(first_name, last_name, color), decider:decided_by(first_name)")
    .order("created_at", { ascending: false })
    .limit(60)
    .returns<Row[]>();
  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  const when = (r: Row) => {
    const day = format.dateTime(new Date(r.starts_at), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
    const time = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
    return `${day} · ${time(r.starts_at)}–${time(r.ends_at)}`;
  };
  const who = (r: Row) => (r.employee ? `${r.employee.first_name} ${r.employee.last_name}`.trim() : "?");
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="admin-requests" tables={[{ table: "shift_requests" }]} />
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>

      {error && <p role="alert" className="text-danger">{t("loadError")}</p>}

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
