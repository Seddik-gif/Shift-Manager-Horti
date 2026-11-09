"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "./client";

export interface TableWatch { table: string; filter?: string; event?: "INSERT" | "UPDATE" | "DELETE" | "*" }

export interface WatchOptions {
  /** human-readable name, only used for the topic prefix */
  name: string;
  tables: TableWatch[];
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
  /** called on the first connection AND after every reconnection, so callers can catch up on what they missed */
  onConnected?: () => void;
}

let counter = 0;

/**
 * Subscribes to Postgres changes and keeps the subscription alive.
 *
 * Why this exists (instead of calling `supabase.channel(name)` directly):
 *  - Every subscription gets a UNIQUE topic. React Strict Mode mounts effects twice in development; reusing
 *    a topic hands the second mount the first mount's half-closed channel, which silently never delivers.
 *  - If the channel errors or times out it is torn down and re-created with backoff, instead of staying dead.
 *  - `onConnected` fires after each (re)connection so the caller can reload anything missed meanwhile.
 * Returns an unsubscribe function.
 */
export function watchTables({ name, tables, onChange, onConnected }: WatchOptions): () => void {
  // diagnostic switch: NEXT_PUBLIC_DISABLE_REALTIME=1 turns live push off so the polling fallback can be tested alone
  if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === "1") {
    onConnected?.();
    return () => {};
  }
  const supabase = createClient();
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let current: ReturnType<typeof supabase.channel> | null = null;

  const connect = () => {
    if (stopped) return;
    const channel = supabase.channel(`${name}:${++counter}:${Math.random().toString(36).slice(2, 8)}`);
    current = channel;
    for (const t of tables) {
      channel.on("postgres_changes", { event: t.event ?? "*", schema: "public", table: t.table, filter: t.filter }, onChange);
    }
    channel.subscribe((status) => {
      if (stopped || current !== channel) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        onConnected?.();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        void supabase.removeChannel(channel);
        const delay = Math.min(15000, 1000 * 2 ** attempt++);
        retry = setTimeout(connect, delay);
      }
    });
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (current) void supabase.removeChannel(current);
  };
}
