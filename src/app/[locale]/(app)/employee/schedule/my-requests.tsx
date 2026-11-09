"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { withdrawRequest } from "@/lib/scheduling/requests-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MyRequest { id: string; kind: "take" | "offer"; when: string; status: "pending" | "approved" | "rejected" | "cancelled"; note: string }

export function MyRequests({ items }: { items: MyRequest[] }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  if (items.length === 0) return null;
  const tone = { pending: "bg-amber-100 text-amber-900", approved: "bg-brand-soft text-brand", rejected: "bg-red-50 text-danger", cancelled: "bg-mist text-ink-soft" } as const;

  return (
    <section aria-label={t("mine")} className="space-y-3">
      <h2 className="font-display text-2xl text-brand">{t("mine")}</h2>
      <ul className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="font-medium capitalize">{r.when}</p>
              <p className="text-sm text-ink-soft">{t(`kind.${r.kind}`)}{r.note ? ` · “${r.note}”` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-3 py-1 text-xs", tone[r.status])}>{t(`status.${r.status}`)}</span>
              {r.status === "pending" && (
                <Button size="sm" variant="ghost" disabled={pending}
                  onClick={() => { setError(false); startTransition(async () => { const res = await withdrawRequest(r.id); if (res.ok) router.refresh(); else setError(true); }); }}>
                  {t("withdraw")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{t("withdrawFailed")}</p>}
    </section>
  );
}
