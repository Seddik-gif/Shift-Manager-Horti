"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { watchTables, type TableWatch } from "@/lib/supabase/realtime";

const POLL_MS = 30_000;

/**
 * Keeps a server-rendered page live. A change on a watched table (RLS still decides what this user may hear
 * about) refreshes the page's data, debounced into one refresh. Because a realtime connection can drop or miss
 * events (sleep, network change, restart), the page also refreshes after every reconnection, when the tab becomes
 * visible again, and every 30 s while it is visible.
 */
export function RealtimeRefresh({ tables, channel }: { tables: TableWatch[]; channel: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedOnce = useRef(false);
  const key = JSON.stringify(tables);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    connectedOnce.current = false;
    const stop = watchTables({
      name: channel,
      tables: JSON.parse(key) as TableWatch[],
      onChange: refresh,
      // the first connection is covered by the page's own render; later ones may have missed events
      onConnected: () => {
        if (connectedOnce.current) refresh();
        connectedOnce.current = true;
      },
    });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, channel, router]);

  return null;
}
