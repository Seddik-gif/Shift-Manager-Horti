import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { requireProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import { Conversation, type ChatMessage } from "./conversation";
import { NewDirect } from "./new-direct";

interface Overview {
  thread_id: string; kind: "global" | "location" | "direct"; title: string | null; last_body: string | null;
  last_sender: string | null; last_at: string | null; unread: number; notify: "all" | "mentions" | "none";
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatPage({ params, searchParams }: PageProps<"/[locale]/chat">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  const me = await requireProfile(locale);
  const sp = await searchParams;
  const t = await getTranslations("chat");
  const supabase = await createClient();

  const { data: overviewRows } = await supabase.rpc("chat_overview");
  const threads = (overviewRows ?? []) as Overview[];
  const wanted = typeof sp.thread === "string" && UUID_RE.test(sp.thread) ? sp.thread : null;
  const current = threads.find((x) => x.thread_id === wanted) ?? null;

  let messages: ChatMessage[] = [];
  let members: { id: string; name: string }[] = [];
  let broadcastOnly = false;
  if (current) {
    const [{ data: rows }, { data: memberRows }, { data: opts }] = await Promise.all([
      supabase.from("chat_messages").select("id, sender_id, body, reply_to, mentions, created_at").eq("thread_id", current.thread_id)
        .order("created_at", { ascending: false }).limit(150)
        .returns<{ id: string; sender_id: string; body: string; reply_to: string | null; mentions: string[]; created_at: string }[]>(),
      supabase.rpc("chat_members", { p_thread: current.thread_id }),
      supabase.from("app_settings").select("value").eq("key", "chat_options").maybeSingle<{ value: { location_broadcast?: boolean } }>(),
    ]);
    members = (memberRows ?? []) as { id: string; name: string }[];
    const nameOf = new Map(members.map((m) => [m.id, m.name]));
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    messages = (rows ?? []).reverse().map((r) => ({
      id: r.id, senderId: r.sender_id, sender: nameOf.get(r.sender_id) ?? "?", body: r.body, at: r.created_at,
      mine: r.sender_id === me.id, mentionsMe: r.mentions.includes(me.id),
      replyTo: r.reply_to ? { sender: nameOf.get(byId.get(r.reply_to)?.sender_id ?? "") ?? "?", body: byId.get(r.reply_to)?.body ?? "…" } : null,
      replyId: r.reply_to,
    }));
    broadcastOnly = current.kind === "location" && me.role === "employee" && opts?.value?.location_broadcast === true;
  }

  const title = (x: Overview) => (x.kind === "global" ? t("everyone") : x.title ?? "?");
  const card = "rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]";
  const hhmm = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));

  return (
    <div className="space-y-4">
      <RealtimeRefresh channel={`chat-${me.id}`} tables={[{ table: "chat_messages" }]} />
      <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
      <div className="grid gap-4 lg:grid-cols-[19rem_1fr]">
        <aside className={cn("space-y-3", current && "hidden lg:block")} aria-label={t("threads")}>
          <ul className={cn(card, "divide-y divide-brand/10 overflow-hidden")}>
            {threads.map((x) => (
              <li key={x.thread_id}>
                <Link href={`/chat?thread=${x.thread_id}`} aria-current={x.thread_id === current?.thread_id ? "page" : undefined}
                  className={cn("block px-4 py-3 hover:bg-mist/60", x.thread_id === current?.thread_id && "bg-brand-soft")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{x.kind === "direct" ? "👤 " : x.kind === "location" ? "📍 " : "💬 "}{title(x)}</span>
                    {x.unread > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-ivory" aria-label={t("unread", { count: x.unread })}>{x.unread}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-ink-soft">
                    {x.last_body ? `${x.last_sender?.split(" ")[0]}: ${x.last_body}` : t("noMessages")}
                    {x.last_at && <span className="ml-2 text-xs">{hhmm(x.last_at)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <NewDirect />
        </aside>

        <section className={cn(!current && "hidden lg:block")}>
          {current ? (
            <Conversation
              key={current.thread_id}
              threadId={current.thread_id}
              title={title(current)}
              notify={current.notify}
              messages={messages}
              members={members.filter((m) => m.id !== me.id)}
              broadcastOnly={broadcastOnly}
              canModerate={me.role === "admin"}
              locale={locale}
            />
          ) : (
            <p className={cn(card, "p-8 text-center text-ink-soft")}>{t("pickThread")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
