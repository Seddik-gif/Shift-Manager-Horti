"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { requestAbsence, withdrawAbsence, type AbsenceResult } from "@/lib/absences/actions";
import { cn } from "@/lib/utils";

export interface AbsenceItem {
  id: string;
  kind: "ferie" | "assenza";
  start: string;
  end: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote: string;
  withdrawable: boolean;
}

const STATUS_STYLE: Record<AbsenceItem["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-brand-soft text-brand",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-mist text-ink-soft",
};

function range(a: string, b: string, locale: string) {
  const f = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T12:00:00Z`));
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
}

export function AbsenceForm({ items, today, locale }: { items: AbsenceItem[]; today: string; locale: string }) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [kind, setKind] = useState<"ferie" | "assenza">("ferie");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<AbsenceResult>, okText?: string, after?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setMsg({ ok: false, text: t(`errors.${res.error}`) });
      if (okText) setMsg({ ok: true, text: okText });
      after?.();
      router.refresh();
    });
  }

  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className={cn(card, "space-y-4")} onSubmit={(e) => { e.preventDefault(); run(() => requestAbsence({ kind, start, end, reason }), t("sent"), () => setReason("")); }}>
        <h2 className="font-display text-2xl text-brand">{t("new")}</h2>
        <fieldset className="flex gap-2">
          <legend className="sr-only">{t("kind")}</legend>
          {(["ferie", "assenza"] as const).map((k) => (
            <label key={k} className={cn("cursor-pointer rounded-full px-4 py-2 text-sm font-medium", kind === k ? "bg-brand text-ivory" : "bg-mist text-ink-soft")}>
              <input type="radio" className="sr-only" name="kind" checked={kind === k} onChange={() => setKind(k)} />{t(k)}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="abs-from">{t("from")}</Label>
            <Input id="abs-from" type="date" required value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></div>
          <div><Label htmlFor="abs-to">{t("to")}</Label>
            <Input id="abs-to" type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div><Label htmlFor="abs-reason">{t("reason")}</Label>
          <Input id="abs-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></div>
        <Button type="submit" disabled={pending}>{pending ? t("sending") : t("send")}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-brand" : "text-sm text-danger"}>{msg.text}</p>}
      </form>

      <section className={cn(card, "space-y-3")} aria-label={t("mine")}>
        <h2 className="font-display text-2xl text-brand">{t("mine")}</h2>
        {items.length === 0 ? <p className="text-ink-soft">{t("none")}</p> : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl bg-mist/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t(a.kind)} · {range(a.start, a.end, locale)}</p>
                  <span className={cn("rounded-full px-3 py-0.5 text-xs font-medium", STATUS_STYLE[a.status])}>{t(`status.${a.status}`)}</span>
                </div>
                {a.reason && <p className="mt-1 text-sm text-ink-soft">{a.reason}</p>}
                {a.decisionNote && <p className="mt-1 text-sm">“{a.decisionNote}”</p>}
                {a.withdrawable && (
                  <Button size="sm" variant="ghost" className="mt-2" disabled={pending} onClick={() => run(() => withdrawAbsence(a.id))}>{t("withdraw")}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
