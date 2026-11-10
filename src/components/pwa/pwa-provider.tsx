"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Registers the service worker (production only), offers "new version available → update",
 * and shows a banner while the device has no connection.
 */
export function PwaProvider() {
  const t = useTranslations("pwa");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  const reloading = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    const onVisible = () => { if (document.visibilityState === "visible") void registration?.update().catch(() => {}); };

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        if (cancelled) return;
        registration = reg;
        // an update that finished installing while the page was closed
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      }).catch(() => { /* the app works without it */ });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloading.current) return;
        reloading.current = true;
        window.location.reload();
      });
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!waiting && !offline) return null;
  return (
    <div className="relative z-10 space-y-px print:hidden">
      {offline && <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("offline")}</p>}
      {waiting && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-brand px-4 py-2 text-sm text-ivory">
          <span>{t("updateAvailable")}</span>
          <Button size="sm" variant="secondary" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>{t("update")}</Button>
        </div>
      )}
    </div>
  );
}
