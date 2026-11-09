"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Volume2, VolumeX, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { watchTables } from "@/lib/supabase/realtime";
import { newForToast } from "@/lib/notifications/ingest";
import { renderNotification } from "@/lib/notifications/render";
import { playChime, setSoundEnabled, soundEnabled, unlockAudio } from "@/lib/notifications/sound";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const TOAST_MS = 9000;
const MAX_TOASTS = 4;
const POLL_MS = 15_000;

/**
 * In-app notifications: a bell with an unread counter, plus pop-up toasts with a chime the moment a
 * new notification arrives.
 *
 * Delivery is belt-and-braces: Realtime pushes new rows instantly, and the list is ALSO reloaded after every
 * (re)connection, when the tab becomes visible, and every 15 s while visible. Anything a dropped connection
 * missed still pops up within seconds, and is never shown twice.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const t = useTranslations("notifications");
  const locale = useLocale() as "it" | "en";
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [toasts, setToasts] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seen = useRef(new Set<string>());
  const firstLoad = useRef(true);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const pushToast = useCallback((n: Item) => {
    setToasts((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, MAX_TOASTS));
    timers.current.set(n.id, setTimeout(() => dismiss(n.id), TOAST_MS));
    if (soundEnabled()) playChime();
  }, [dismiss]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, params, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return setFailed(true);
    setFailed(false);
    const rows = data as Item[];
    setItems(rows);
    const fresh = newForToast(rows, seen.current, firstLoad.current, Date.now());
    firstLoad.current = false;
    fresh.forEach(pushToast);
  }, [pushToast]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read the saved sound preference once on mount */
    setSound(soundEnabled());
    /* eslint-enable react-hooks/set-state-in-effect */
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    const timerMap = timers.current;
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      timerMap.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    // instant path: Realtime
    const stop = watchTables({
      name: `notifications-${userId}`,
      tables: [{ table: "notifications", filter: `user_id=eq.${userId}` }],
      onChange: (payload) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new as unknown as Item;
          if (!seen.current.has(row.id)) {
            seen.current.add(row.id);
            pushToast(row);
          }
        }
        void load();
      },
      onConnected: () => void load(), // first connection and every reconnection: catch up
    });
    // safety net: poll, and catch up when the tab comes back
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = setInterval(onVisible, POLL_MS);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from an external system
    void load();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(poll);
    };
  }, [userId, load, pushToast]);

  const unread = items.filter((i) => !i.read_at).length;

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    await load();
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    unlockAudio();
    if (next) playChime();
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={unread > 0 ? t("unreadCount", { count: unread }) : t("title")}
          className="relative grid size-10 place-items-center rounded-full text-ink-soft hover:bg-mist"
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-5 text-ivory">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed inset-x-3 top-16 z-50 max-h-[70dvh] overflow-auto rounded-[var(--radius-card)] bg-paper p-2 shadow-[var(--shadow-soft)] ring-1 ring-brand/10 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <h2 className="font-display text-xl text-brand">{t("title")}</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? t("soundOn") : t("soundOff")} title={sound ? t("soundOn") : t("soundOff")}
                  className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-mist">
                  {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
                </button>
                {unread > 0 && (
                  <button type="button" className="text-sm text-brand underline" onClick={() => markRead(items.filter((i) => !i.read_at).map((i) => i.id))}>
                    {t("markAllRead")}
                  </button>
                )}
              </div>
            </div>
            {failed ? (
              <p role="alert" className="px-3 py-4 text-sm text-danger">{t("loadError")}</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-soft">{t("empty")}</p>
            ) : (
              <ul>
                {items.map((n) => {
                  const { title, body } = renderNotification(locale, n.type, n.params);
                  const content = (
                    <>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="block text-sm text-ink-soft">{body}</span>
                    </>
                  );
                  const cls = cn("block rounded-xl px-3 py-2.5 hover:bg-brand-soft/50", !n.read_at && "bg-brand-soft/40");
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link href={n.link} className={cls} onClick={() => { void markRead([n.id]); setOpen(false); }}>{content}</Link>
                      ) : (
                        <button type="button" className={cn(cls, "w-full text-left")} onClick={() => markRead([n.id])}>{content}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* pop-ups */}
      <div aria-live="polite" className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 sm:top-4">
        {toasts.map((n) => {
          const { title, body } = renderNotification(locale, n.type, n.params);
          const go = () => {
            void markRead([n.id]);
            dismiss(n.id);
            if (n.link) router.push(n.link);
          };
          return (
            <div key={n.id} role="status" className="toast-in pointer-events-auto relative overflow-hidden rounded-2xl bg-paper shadow-[0_12px_40px_-8px_rgb(35_74_73/0.35)] ring-1 ring-brand/15">
              <button type="button" onClick={go} className="block w-full px-4 py-3 pr-10 text-left">
                <span className="flex items-center gap-2 text-sm font-semibold text-brand">
                  <Bell className="size-4" aria-hidden /> {title}
                </span>
                <span className="mt-1 block text-sm text-ink">{body}</span>
              </button>
              <button type="button" onClick={() => dismiss(n.id)} aria-label={t("dismiss")} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-ink-soft hover:bg-mist">
                <X className="size-4" aria-hidden />
              </button>
              <span className="toast-bar absolute inset-x-0 bottom-0 h-1 bg-brand/60" style={{ animationDuration: `${TOAST_MS}ms` }} aria-hidden />
            </div>
          );
        })}
      </div>
    </>
  );
}
