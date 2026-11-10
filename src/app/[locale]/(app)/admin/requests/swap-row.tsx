"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { decideSwap } from "@/lib/swaps/actions";

export function SwapRow({ id, from, to, color, when, note }: { id: string; from: string; to: string; color: string; when: string; note: string }) {
  const t = useTranslations("requests");
  const ts = useTranslations("swaps");
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const res = await decideSwap(id, approve, reply);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-lg font-medium"><span className="size-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />{ts("adminLine", { from, to })}</p>
          <p className="text-sm text-ink-soft">{ts("adminAccepted")}</p>
        </div>
        <p className="font-medium capitalize">{when}</p>
      </div>
      {note && <p className="rounded-xl bg-brand-soft p-3 text-sm">“{note}”</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={300} placeholder={t("replyNote")} aria-label={t("replyNote")}
          className="h-11 min-w-48 flex-1 rounded-xl border border-brand/20 bg-white px-3 text-sm" />
        <Button onClick={() => decide(true)} disabled={pending}>{t("approve")}</Button>
        <Button variant="outline" onClick={() => decide(false)} disabled={pending}>{t("reject")}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{ts(`errors.${error as "unknown"}`)}</p>}
    </div>
  );
}
