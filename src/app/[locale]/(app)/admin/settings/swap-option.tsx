"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { saveSwapOptions } from "@/lib/swaps/actions";

/** Does a swap need an admin's final OK, or is the colleague's yes enough? */
export function SwapOption({ initial }: { initial: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    setOn(next);
    setError(false);
    start(async () => {
      const res = await saveSwapOptions(next);
      if (!res.ok) { setOn(!next); setError(true); } else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]">
      <label className="flex min-w-60 flex-1 cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1.5 size-5" checked={on} disabled={pending} onChange={(e) => change(e.target.checked)} />
        <span>
          <span className="block text-lg font-medium">{t("swapApproval")}</span>
          <span className="block text-sm text-ink-soft">{t("swapApprovalHint")}</span>
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-danger">{t("errors.unknown")}</p>}
    </div>
  );
}
