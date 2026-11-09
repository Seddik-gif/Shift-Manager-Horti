"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { closeRequest, sendRequest } from "@/lib/availability/actions";
import { Button } from "@/components/ui/button";

export function RequestActions({ id, status }: { id: string; status: "draft" | "open" | "closed" }) {
  const t = useTranslations("availability.admin");
  const te = useTranslations("availability.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "closed") return null;

  function run(kind: "send" | "close") {
    if (kind === "close" && !window.confirm(t("confirmClose"))) return;
    setError(null);
    startTransition(async () => {
      const res = kind === "send" ? await sendRequest(id) : await closeRequest(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {status === "draft" ? (
        <Button onClick={() => run("send")} disabled={pending}>{t("sendNow")}</Button>
      ) : (
        <Button variant="outline" onClick={() => run("close")} disabled={pending}>{t("close")}</Button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{te(error as "unknown")}</p>}
    </div>
  );
}
