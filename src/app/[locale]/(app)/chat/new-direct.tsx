"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { openDirectChat } from "@/lib/chat/actions";
import { createClient } from "@/lib/supabase/client";

interface Person { id: string; name: string; role: string }

/** Start a private chat with one colleague (everyone can see everyone's name). */
export function NewDirect() {
  const t = useTranslations("chat");
  const tr = useTranslations("roles");
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  async function toggle() {
    setOpen((v) => !v);
    if (people === null) {
      const { data } = await createClient().rpc("chat_people");
      setPeople((data ?? []) as Person[]);
    }
  }

  function pick(id: string) {
    setError(false);
    start(async () => {
      const res = await openDirectChat(id);
      if (!res.ok) return setError(true);
      setOpen(false);
      router.push(`/chat?thread=${res.threadId}`);
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={toggle} aria-expanded={open}>＋ {t("newDirect")}</Button>
      {open && (
        <ul className="max-h-64 divide-y divide-brand/10 overflow-y-auto rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
          {people === null ? <li className="px-4 py-3 text-sm text-ink-soft">…</li> : people.map((p) => (
            <li key={p.id}>
              <button type="button" disabled={pending} onClick={() => pick(p.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-mist/60">
                <span>{p.name}</span><span className="text-xs text-ink-soft">{tr(p.role as "admin")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-danger">{t("errors.unknown")}</p>}
    </div>
  );
}
