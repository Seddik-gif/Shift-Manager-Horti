"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { decideRequest } from "@/lib/scheduling/requests-actions";
import { Button } from "@/components/ui/button";

export function RequestRow({ id, who, color, kind, when, note }: { id: string; who: string; color: string; kind: "take" | "offer"; when: string; note: string }) {
  const t = useTranslations("requests");
  const te = useTranslations("schedule.errors");
  const router = useRouter();
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideRequest(id, approve, decisionNote);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-lg font-medium"><span className="size-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />{who}</p>
          <p className="text-sm text-ink-soft">{t(`kind.${kind}`)}</p>
        </div>
        <p className="font-medium capitalize">{when}</p>
      </div>
      {note && <p className="rounded-xl bg-brand-soft p-3 text-sm">“{note}”</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} maxLength={300} placeholder={t("replyNote")} aria-label={t("replyNote")}
          className="h-11 min-w-48 flex-1 rounded-xl border border-brand/20 bg-white px-3 text-sm" />
        <Button onClick={() => decide(true)} disabled={pending}>{t("approve")}</Button>
        <Button variant="outline" onClick={() => decide(false)} disabled={pending}>{t("reject")}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{te(error as "unknown")}</p>}
    </div>
  );
}
