"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { discardShiftNotices, sendShiftUpdates } from "@/lib/scheduling/actions";

/**
 * Shift edits are held back: nobody is notified while the admin is still working. This bar says what is waiting and
 * lets the admin announce it once (one message per employee) or keep it quiet.
 */
export function PendingNotices({ employees, changes }: { employees: number; changes: number }) {
  const t = useTranslations("schedule");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<number | null>(null);

  if (changes === 0 && sent === null) return null;
  if (changes === 0 && sent !== null) {
    return <p role="status" className="rounded-[var(--radius-card)] bg-brand-soft px-4 py-3 text-sm text-brand">{t("pendingSent", { employees: sent })}</p>;
  }
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-amber-50 px-4 py-3 ring-1 ring-amber-300/60">
      <div>
        <p className="font-medium text-amber-950">{t("pendingTitle")}</p>
        <p className="text-sm text-amber-900">{t("pendingBody", { changes, employees })}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { const r = await sendShiftUpdates(); if (r.ok) setSent(r.employees); })}
          className="min-h-11 rounded-full bg-brand px-5 text-sm font-medium text-ivory hover:bg-brand-dark disabled:opacity-60"
        >
          {t("pendingSend")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (window.confirm(t("pendingConfirm"))) start(async () => { await discardShiftNotices(); }); }}
          className="min-h-11 rounded-full border border-amber-400 px-5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
        >
          {t("pendingDiscard")}
        </button>
      </div>
    </div>
  );
}
