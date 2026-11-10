"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { purgeChatNow, saveChatOptions } from "@/lib/chat/actions";

export interface PurgeStatus { lastRun: string | null; messages: number; notifications: number }

/** Chat options: announcement mode for bar threads, and the 90-day clean-up with its last result. */
export function ChatAdmin({ broadcast, status, locale }: { broadcast: boolean; status: PurgeStatus; locale: string }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [on, setOn] = useState(broadcast);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  const when = status.lastRun
    ? new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastRun))
    : null;

  function change(next: boolean) {
    setOn(next);
    setMsg(null);
    start(async () => {
      const res = await saveChatOptions(next);
      if (!res.ok) { setOn(!next); setMsg({ ok: false, text: t("errors.unknown") }); } else router.refresh();
    });
  }

  function purge() {
    if (!window.confirm(t("purgeConfirm"))) return;
    setMsg(null);
    start(async () => {
      const res = await purgeChatNow();
      if (!res.ok) return setMsg({ ok: false, text: t("errors.unknown") });
      setMsg({ ok: true, text: t("purgeDone", { messages: res.messages, notifications: res.notifications }) });
      router.refresh();
    });
  }

  return (
    <>
      <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <label className="flex min-w-60 flex-1 cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1.5 size-5" checked={on} disabled={pending} onChange={(e) => change(e.target.checked)} />
          <span>
            <span className="block text-lg font-medium">{t("chatBroadcast")}</span>
            <span className="block text-sm text-ink-soft">{t("chatBroadcastHint")}</span>
          </span>
        </label>
      </div>

      <div className={`${card} space-y-2`}>
        <h2 className="font-display text-2xl text-brand">{t("purgeTitle")}</h2>
        <p className="text-sm text-ink-soft">{t("purgeHint")}</p>
        <p className="text-sm">{when ? t("purgeLast", { when, messages: status.messages, notifications: status.notifications }) : t("purgeNever")}</p>
        <Button variant="outline" size="sm" onClick={purge} disabled={pending}>{t("purgeNow")}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-brand" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </>
  );
}
