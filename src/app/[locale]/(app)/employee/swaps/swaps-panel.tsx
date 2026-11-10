"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { proposeSwap, respondSwap, swapCandidates, withdrawSwap, type SwapResult } from "@/lib/swaps/actions";
import { cn } from "@/lib/utils";

export interface MyShift { id: string; start: string; end: string; position: string; hasSwap: boolean }
export interface SwapItem {
  id: string;
  status: "pending" | "review" | "approved" | "rejected" | "cancelled";
  note: string;
  decisionNote: string;
  start: string | null;
  end: string | null;
  direction: "incoming" | "outgoing";
  other: string;
}

const TONE: Record<SwapItem["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  review: "bg-sky-100 text-sky-900",
  approved: "bg-brand-soft text-brand",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-mist text-ink-soft",
};

function whenLabel(start: string | null, end: string | null, locale: string) {
  if (!start || !end) return "—";
  const day = new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" }).format(new Date(start));
  const hm = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
  return `${day} · ${hm(start)}–${hm(end)}`;
}

export function SwapsPanel({ shifts, items, locale }: { shifts: MyShift[]; items: SwapItem[]; locale: string }) {
  const t = useTranslations("swaps");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");

  function run<T extends object>(fn: () => Promise<SwapResult<T>>, okText?: (r: T) => string, after?: () => void) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setMsg({ ok: false, text: t(`errors.${res.error}`) });
      if (okText) setMsg({ ok: true, text: okText(res) });
      after?.();
      router.refresh();
    });
  }

  function openPicker(shiftId: string) {
    if (open === shiftId) return setOpen(null);
    setOpen(shiftId); setCandidates(null); setPick(""); setNote(""); setMsg(null);
    start(async () => {
      const res = await swapCandidates(shiftId);
      if (!res.ok) return setMsg({ ok: false, text: t(`errors.${res.error}`) });
      setCandidates(res.candidates);
      setPick(res.candidates[0]?.id ?? "");
    });
  }

  const incoming = items.filter((i) => i.direction === "incoming" && i.status === "pending");
  const others = items.filter((i) => !incoming.includes(i));
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";

  return (
    <div className="space-y-6">
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-brand" : "text-danger"}>{msg.text}</p>}

      <section className="space-y-3" aria-label={t("incoming")}>
        <h2 className="font-display text-2xl text-brand">{t("incoming")} <span className="text-base text-ink-soft">({incoming.length})</span></h2>
        {incoming.length === 0 ? <p className={cn(card, "text-ink-soft")}>{t("noIncoming")}</p> : incoming.map((i) => (
          <div key={i.id} className={cn(card, "space-y-2")}>
            <p className="font-medium">{t("incomingFrom", { name: i.other })}</p>
            <p className="capitalize">{whenLabel(i.start, i.end, locale)}</p>
            {i.note && <p className="rounded-xl bg-brand-soft p-3 text-sm">“{i.note}”</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => run(() => respondSwap(i.id, true), (r) => t(r.outcome === "approved" ? "doneApproved" : "doneReview"))}>{t("accept")}</Button>
              <Button variant="outline" disabled={pending} onClick={() => run(() => respondSwap(i.id, false))}>{t("decline")}</Button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3" aria-label={t("myShifts")}>
        <h2 className="font-display text-2xl text-brand">{t("myShifts")}</h2>
        {shifts.length === 0 ? <p className={cn(card, "text-ink-soft")}>{t("noShifts")}</p> : shifts.map((s) => (
          <div key={s.id} className={cn(card, "space-y-3")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium capitalize">{whenLabel(s.start, s.end, locale)}</p>
                {s.position && <p className="text-sm text-ink-soft">{s.position}</p>}
              </div>
              {s.hasSwap ? <span className="rounded-full bg-sky-100 px-3 py-0.5 text-xs text-sky-900">{t("swapOngoing")}</span>
                : <Button size="sm" variant="outline" disabled={pending} onClick={() => openPicker(s.id)}>{t("propose")}</Button>}
            </div>
            {open === s.id && (
              <form className="space-y-3 rounded-xl bg-mist/50 p-4" onSubmit={(e) => { e.preventDefault(); run(() => proposeSwap(s.id, pick, note), () => t("proposed"), () => setOpen(null)); }}>
                {candidates === null ? <p className="text-sm text-ink-soft">{t("loading")}</p> : candidates.length === 0 ? <p className="text-sm text-ink-soft">{t("noCandidates")}</p> : (
                  <>
                    <label className="block text-sm font-medium">{t("chooseColleague")}
                      <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-brand/20 bg-white px-3">
                        {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">{t("noteLabel")}
                      <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-brand/20 bg-white px-3" />
                    </label>
                    <Button type="submit" disabled={pending || !pick}>{t("send")}</Button>
                  </>
                )}
              </form>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3" aria-label={t("history")}>
        <h2 className="font-display text-2xl text-brand">{t("history")}</h2>
        {others.length === 0 ? <p className={cn(card, "text-ink-soft")}>{t("noHistory")}</p> : others.map((i) => (
          <div key={i.id} className={cn(card, "space-y-1")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{i.direction === "incoming" ? t("incomingFrom", { name: i.other }) : t("outgoingTo", { name: i.other })}</p>
              <span className={cn("rounded-full px-3 py-0.5 text-xs font-medium", TONE[i.status])}>{t(`status.${i.status}`)}</span>
            </div>
            <p className="text-sm capitalize text-ink-soft">{whenLabel(i.start, i.end, locale)}</p>
            {i.decisionNote && <p className="text-sm">“{i.decisionNote}”</p>}
            {i.direction === "outgoing" && (i.status === "pending" || i.status === "review") && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawSwap(i.id))}>{t("withdraw")}</Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
