"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { removePushSubscription, savePushSubscription, sendMyTestPush } from "@/lib/push/actions";
import { isIos, pushState, urlBase64ToUint8Array, type PushState } from "@/lib/push/client-utils";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Turn notifications on for this device, with the install steps iPhones need first. */
export function PushCard() {
  const t = useTranslations("pwa.push");
  const [state, setState] = useState<PushState>("loading");
  const [ios, setIos] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    await Promise.resolve(); // browser state is read after mount, never during render
    const hasSw = "serviceWorker" in navigator;
    let subscribed = false;
    if (hasSw && "PushManager" in window) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        subscribed = !!(await reg?.pushManager.getSubscription());
      } catch { /* treated as not subscribed */ }
    }
    const nav = navigator as Navigator & { standalone?: boolean };
    setIos(isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    setState(pushState({
      userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
      standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
      hasServiceWorker: hasSw, hasPushManager: "PushManager" in window, hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : "denied", subscribed,
    }));
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0); // browser capabilities are only known after mount
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(first);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, [refresh]);

  const enable = () => start(async () => {
    setMsg(null);
    try {
      if (!PUBLIC_KEY) throw new Error("not_configured");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return void (await refresh());
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) }));
      const res = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!res.ok) throw new Error(res.error);
      setMsg({ ok: true, text: t("enabled") });
    } catch {
      setMsg({ ok: false, text: t("error") });
    }
    await refresh();
  });

  const disable = () => start(async () => {
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch { /* ignore: state is re-read below */ }
    await refresh();
  });

  const test = () => start(async () => {
    setMsg(null);
    const r = await sendMyTestPush();
    setMsg(r.ok ? { ok: true, text: t("testSent", { count: r.delivered }) } : { ok: false, text: r.configured ? t("testNone") : t("notConfigured") });
  });

  const install = () => start(async () => {
    await installEvent?.prompt();
    setInstallEvent(null);
  });

  if (state === "loading" || (!PUBLIC_KEY && state !== "install_first")) return null;
  const card = "space-y-3 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";

  return (
    <section className={card} aria-label={t("title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl text-brand">{t("title")}</h2>
        {state === "on" && <span className="rounded-full bg-brand-soft px-3 py-0.5 text-xs font-medium text-brand">✓ {t("on")}</span>}
        {state === "off" && <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-900">{t("off")}</span>}
      </div>

      {state === "install_first" && (
        <>
          <p className="text-sm text-ink-soft">{t("iosIntro")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>{t("iosStep1")}</li>
            <li>{t("iosStep2")}</li>
            <li>{t("iosStep3")}</li>
          </ol>
        </>
      )}
      {state === "unsupported" && <p className="text-sm text-ink-soft">{t("unsupported")}</p>}
      {state === "blocked" && <p className="text-sm text-ink-soft">{t("blocked")}</p>}
      {state === "off" && <p className="text-sm text-ink-soft">{t("intro")}</p>}
      {state === "on" && <p className="text-sm text-ink-soft">{t("onHint")}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {state === "off" && <Button onClick={enable} disabled={pending}>{pending ? t("enabling") : t("enable")}</Button>}
        {state === "on" && (
          <>
            <Button variant="outline" size="sm" onClick={test} disabled={pending}>{t("test")}</Button>
            <Button variant="ghost" size="sm" onClick={disable} disabled={pending}>{t("disable")}</Button>
          </>
        )}
        {installEvent && !ios && <Button variant="secondary" size="sm" onClick={install} disabled={pending}>{t("install")}</Button>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-brand" : "text-sm text-danger"}>{msg.text}</p>}
    </section>
  );
}
