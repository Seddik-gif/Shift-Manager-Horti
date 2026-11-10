"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { decideAbsence } from "@/lib/absences/actions";

export function AbsenceRow({ id, who, color, kind, when, reason }: { id: string; who: string; color: string; kind: "ferie" | "assenza"; when: string; reason: string }) {
  const t = useTranslations("requests");
  const ta = useTranslations("absences");
  const tr = useTranslations("requestsAbsences");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; hold?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setResult(null);
    startTransition(async () => {
      const res = await decideAbsence(id, approve, note);
      if (!res.ok) return setResult({ ok: false, text: ta(`errors.${res.error}`) });
      const hold = approve && res.conflicts > 0;
      setResult({ ok: true, hold, text: !approve ? tr("rejected") : hold ? tr("conflicts", { count: res.conflicts }) : tr("approved") });
      if (!hold) router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-lg font-medium"><span className="size-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />{who}</p>
          <p className="text-sm text-ink-soft">{ta(kind)}</p>
        </div>
        <p className="font-medium capitalize">{when}</p>
      </div>
      {reason && <p className="rounded-xl bg-brand-soft p-3 text-sm">“{reason}”</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("replyNote")} aria-label={t("replyNote")}
          className="h-11 min-w-48 flex-1 rounded-xl border border-brand/20 bg-white px-3 text-sm" />
        <Button onClick={() => decide(true)} disabled={pending || !!result?.hold}>{t("approve")}</Button>
        <Button variant="outline" onClick={() => decide(false)} disabled={pending || !!result?.hold}>{t("reject")}</Button>
      </div>
      {result && (
        <div className="flex flex-wrap items-center gap-3">
          <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm text-amber-800" : "text-sm text-danger"}>{result.text}</p>
          {result.hold && <Button size="sm" variant="outline" onClick={() => router.refresh()}>OK</Button>}
        </div>
      )}
    </div>
  );
}
