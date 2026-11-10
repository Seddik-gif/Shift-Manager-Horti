"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { deleteChatMessage, markChatRead, sendChatMessage, setChatNotify } from "@/lib/chat/actions";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  senderId: string;
  sender: string;
  body: string;
  at: string;
  mine: boolean;
  mentionsMe: boolean;
  replyId: string | null;
  replyTo: { sender: string; body: string } | null;
}

type Member = { id: string; name: string };

/** People named with @ in the text, matched against the thread's members (longest names first). */
export function mentionedIds(body: string, members: Member[]): string[] {
  const lower = body.toLowerCase();
  return [...members].sort((a, b) => b.name.length - a.name.length)
    .filter((m) => lower.includes(`@${m.name.toLowerCase()}`) || lower.includes(`@${m.name.split(" ")[0].toLowerCase()}`))
    .map((m) => m.id);
}

export function Conversation({ threadId, title, notify, messages, members, broadcastOnly, canModerate, locale }: {
  threadId: string; title: string; notify: "all" | "mentions" | "none"; messages: ChatMessage[]; members: Member[];
  broadcastOnly: boolean; canModerate: boolean; locale: string;
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  // read receipts + scroll to the newest message whenever the conversation changes
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
    void markChatRead(threadId);
  }, [threadId, lastId]);

  const mustReply = broadcastOnly && !replyTo;
  const day = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
  const hm = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));

  function send() {
    const body = text.trim();
    if (!body || mustReply) return;
    setError(null);
    start(async () => {
      const res = await sendChatMessage(threadId, body, replyTo?.id ?? null, mentionedIds(body, members));
      if (!res.ok) return setError(res.error);
      setText("");
      setReplyTo(null);
      router.refresh();
    });
  }

  const card = "rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]";
  const headers = messages.map((m, i) => (i === 0 || day(messages[i - 1].at) !== day(m.at) ? day(m.at) : null));
  return (
    <div className={cn(card, "flex h-[calc(100dvh-16rem)] min-h-[22rem] md:h-[calc(100dvh-14rem)] md:min-h-[26rem] flex-col")}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-brand/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/chat" className="rounded-full px-2 py-1 text-brand hover:bg-mist lg:hidden" aria-label={t("back")}>←</Link>
          <h2 className="font-display text-2xl text-brand">{title}</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          {t("notifications")}
          <select value={notify} onChange={(e) => start(async () => { await setChatNotify(threadId, e.target.value as "all" | "mentions" | "none"); router.refresh(); })}
            className="h-9 rounded-xl border border-brand/20 bg-white px-2 text-ink">
            <option value="all">{t("notifyAll")}</option>
            <option value="mentions">{t("notifyMentions")}</option>
            <option value="none">{t("notifyNone")}</option>
          </select>
        </label>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label={title}>
        {messages.length === 0 && <p className="py-10 text-center text-ink-soft">{t("empty")}</p>}
        {messages.map((m, i) => {
          const header = headers[i];
          return (
            <div key={m.id}>
              {header && <p className="my-3 text-center text-xs capitalize text-ink-soft">{header}</p>}
              <div className={cn("group flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-3 py-2", m.mine ? "bg-brand text-ivory" : "bg-mist", m.mentionsMe && "ring-2 ring-amber-400")}>
                  {!m.mine && <p className="text-xs font-semibold text-brand">{m.sender}</p>}
                  {m.replyTo && (
                    <p className={cn("mb-1 truncate border-l-2 pl-2 text-xs", m.mine ? "border-ivory/50 text-ivory/80" : "border-brand/40 text-ink-soft")}>
                      {m.replyTo.sender}: {m.replyTo.body}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cn("mt-0.5 flex items-center justify-end gap-2 text-[11px]", m.mine ? "text-ivory/70" : "text-ink-soft")}>
                    <button type="button" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => setReplyTo(m)}>{t("reply")}</button>
                    {(m.mine || canModerate) && (
                      <button type="button" className="opacity-0 focus:opacity-100 group-hover:opacity-100"
                        onClick={() => window.confirm(t("confirmDelete")) && start(async () => { await deleteChatMessage(m.id); router.refresh(); })}>{t("delete")}</button>
                    )}
                    {hm(m.at)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form className="space-y-2 border-t border-brand/10 p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {broadcastOnly && !replyTo && <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{t("broadcastOnly")}</p>}
        {replyTo && (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-brand-soft px-3 py-1.5 text-sm">
            <span className="truncate">{t("replyingTo", { name: replyTo.sender })}: {replyTo.body}</span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label={t("cancelReply")}>✕</button>
          </p>
        )}
        {members.length > 0 && members.length <= 12 && (
          <div className="flex flex-wrap gap-1" aria-label={t("mention")}>
            {members.map((m) => (
              <button key={m.id} type="button" onClick={() => setText((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}@${m.name} `)}
                className="rounded-full bg-mist px-2.5 py-0.5 text-xs text-ink-soft hover:text-ink">@{m.name.split(" ")[0]}</button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder={t("placeholder")} aria-label={t("placeholder")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-brand/20 bg-white px-3 py-2.5 disabled:opacity-50" disabled={mustReply} />
          <Button type="submit" disabled={pending || mustReply || !text.trim()}>{t("send")}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{t(`errors.${error as "unknown"}`)}</p>}
        <p className="text-center text-xs text-ink-soft">{t("retention")}</p>
      </form>
    </div>
  );
}
