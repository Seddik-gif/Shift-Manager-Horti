"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { publishSchedule } from "@/lib/scheduling/publish-actions";
import { Button } from "@/components/ui/button";

export function PublishButton({ weekStart, republish, warningCount }: { weekStart: string; republish: boolean; warningCount: number }) {
  const t = useTranslations("publish");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number } | null>(null);

  function run() {
    const message = warningCount > 0 ? t("confirmWithWarnings", { count: warningCount }) : t("confirm");
    if (!window.confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const res = await publishSchedule(weekStart);
      if (!res.ok) return setError(res.error);
      setDone({ version: res.version });
      router.refresh();
    });
  }

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-[var(--radius-card)] bg-brand-soft p-5 text-brand">
        <p className="font-medium">{t("published", { version: done.version })}</p>
        <Link href={`/admin/schedule/versions?date=${weekStart}#share`} className="font-medium underline">{t("shareWhatsApp")}</Link>
        <br />
        <Link href={`/admin/schedule/versions?date=${weekStart}`} className="underline">{t("viewVersions")}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button size="lg" className="h-14 w-full text-base tracking-wide sm:w-auto" onClick={run} disabled={pending}>
        {pending ? t("publishing") : republish ? t("republishCta") : t("publishCta")}
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{t(`errors.${error as "unknown"}`)}</p>}
    </div>
  );
}
