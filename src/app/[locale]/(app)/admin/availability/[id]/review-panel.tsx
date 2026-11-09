"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { reviewAvailability } from "@/lib/availability/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Review = "pending" | "confirmed" | "changes_requested";

/** An admin confirms what the employee chose, or asks them to change it (a note is required). */
export function ReviewPanel({ submissionId, review, note, name }: { submissionId: string; review: Review; note: string; name: string }) {
  const t = useTranslations("availability.review");
  const te = useTranslations("availability.errors");
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(confirm: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await reviewAvailability(submissionId, confirm, text);
      if (!res.ok) setError(res.error);
      else { setText(""); router.refresh(); }
    });
  }

  const tone = { pending: "bg-amber-50 text-amber-900 ring-amber-300", confirmed: "bg-brand-soft text-brand ring-brand/20", changes_requested: "bg-red-50 text-danger ring-danger/30" }[review];

  return (
    <div className={cn("space-y-3 rounded-2xl p-4 ring-1", tone)}>
      <p className="font-medium">{t(`state.${review}`, { name })}</p>
      {review === "changes_requested" && note && <p className="text-sm">“{note}”</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")}
          className="h-11 min-w-48 flex-1 rounded-xl border border-brand/20 bg-white px-3 text-sm text-ink" />
        <Button onClick={() => send(true)} disabled={pending || review === "confirmed"}>{t("confirm")}</Button>
        <Button variant="outline" onClick={() => send(false)} disabled={pending || review === "changes_requested"}>{t("requestChanges")}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{te(error as "unknown")}</p>}
    </div>
  );
}
