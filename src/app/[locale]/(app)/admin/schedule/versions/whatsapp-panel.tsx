"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { markShareStep, prepareShare } from "@/lib/whatsapp/actions";
import { Button } from "@/components/ui/button";

export interface ShareState {
  id: string;
  message: string;
  copiedAt: string | null;
  openedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

const WHATSAPP_WEB = "https://web.whatsapp.com/";

/**
 * Manual sharing to the EXISTING staff group. This panel never sends anything: the admin copies the
 * text, opens WhatsApp Web themselves, pastes it in the group, and then states that they sent it.
 */
export function WhatsAppPanel({ weekStart, initial, locationId }: { weekStart: string; initial: ShareState | null; locationId: string }) {
  const t = useTranslations("whatsapp");
  const uiLocale = useLocale() as "it" | "en";
  const [lang, setLang] = useState<"it" | "en">(uiLocale);
  const [share, setShare] = useState<ShareState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fmt = (iso: string) => new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome", hourCycle: "h23" }).format(new Date(iso));

  function prepare() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await prepareShare(weekStart, lang, locationId);
      if (!res.ok) return setError(res.error);
      setShare({ id: res.id, message: res.message, copiedAt: null, openedAt: null, confirmedAt: null, confirmedBy: null });
    });
  }

  async function step(kind: "copied" | "opened" | "confirmed") {
    if (!share) return;
    const res = await markShareStep(share.id, kind);
    if (!res.ok) return setError(res.error);
    const now = new Date().toISOString();
    setShare((s) => s && { ...s, copiedAt: kind === "copied" ? now : s.copiedAt, openedAt: kind === "opened" ? now : s.openedAt, confirmedAt: kind === "confirmed" ? now : s.confirmedAt });
  }

  async function copy() {
    if (!share) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(share.message);
      setNotice(t("copied"));
      await step("copied");
    } catch {
      // clipboard blocked: never claim it was copied
      setNotice(t("copyFailed"));
    }
  }

  function open() {
    window.open(WHATSAPP_WEB, "_blank", "noopener,noreferrer");
    void step("opened");
  }

  function confirmSent() {
    if (window.confirm(t("confirmPrompt"))) void step("confirmed");
  }

  return (
    <section id="share" className="space-y-4 rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]" aria-labelledby="wa-title">
      <h2 id="wa-title" className="font-display text-2xl text-brand">{t("title")}</h2>
      <p className="text-sm text-ink-soft">{t("manualNote")}</p>

      {!share ? (
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t("language")} className="inline-flex rounded-full bg-mist p-1">
            {(["it", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${lang === l ? "bg-brand text-ivory" : "text-ink-soft"}`}>{l}</button>
            ))}
          </div>
          <Button onClick={prepare} disabled={pending}>{t("prepare")}</Button>
        </div>
      ) : (
        <>
          <textarea readOnly rows={14} value={share.message} aria-label={t("messagePreview")}
            className="w-full rounded-xl border border-brand/20 bg-white p-3 font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={copy}>{t("copyCta")}</Button>
            <Button size="lg" variant="outline" onClick={open}>{t("openCta")}</Button>
            {!share.confirmedAt && <Button size="lg" variant="secondary" onClick={confirmSent} disabled={pending}>{t("confirmCta")}</Button>}
          </div>
          <ol className="space-y-1 text-sm text-ink-soft">
            <li>{t("stepPrepared")}</li>
            <li className={share.copiedAt ? "text-brand" : ""}>{share.copiedAt ? t("stepCopied", { date: fmt(share.copiedAt) }) : t("stepCopyPending")}</li>
            <li className={share.openedAt ? "text-brand" : ""}>{share.openedAt ? t("stepOpened", { date: fmt(share.openedAt) }) : t("stepOpenPending")}</li>
            <li className={share.confirmedAt ? "font-medium text-brand" : ""}>
              {share.confirmedAt ? t("stepConfirmed", { date: fmt(share.confirmedAt), name: share.confirmedBy ?? t("you") }) : t("stepConfirmPending")}
            </li>
          </ol>
          {share.confirmedAt && <p className="text-xs text-ink-soft">{t("manualDisclaimer")}</p>}
          <Button variant="ghost" size="sm" onClick={() => { setShare(null); setNotice(null); }}>{t("newMessage")}</Button>
        </>
      )}
      {notice && <p role="status" className="text-sm text-brand">{notice}</p>}
      {error && <p role="alert" className="text-sm text-danger">{t(`errors.${error as "unknown"}`)}</p>}
    </section>
  );
}
