"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { saveRules } from "@/lib/scheduling/rules-actions";
import { cn } from "@/lib/utils";

type Key = "staffing";
type Values = Record<Key, number | null>;

const DEFAULTS: Record<Key, number> = { staffing: 2 };
const UNIT: Record<Key, "hours" | "people"> = { staffing: "people" };
const MAX: Record<Key, number> = { staffing: 50 };
const ORDER: Key[] = ["staffing"];

export function RulesForm({ initial }: { initial: Values }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (k: Key, on: boolean) => setValues((v) => ({ ...v, [k]: on ? DEFAULTS[k] : null }));
  const set = (k: Key, n: number) => setValues((v) => ({ ...v, [k]: n }));

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveRules({ min_staff_per_day: values.staffing });
      if (!res.ok) return setMsg({ ok: false, text: t(`errors.${res.error}`) });
      setMsg({ ok: true, text: t("saved") });
      router.refresh();
    });
  }

  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  return (
    <div className="space-y-4">
      <p className={cn(card, "text-sm text-ink-soft")}>🔒 {t("alwaysOn")}</p>
      {ORDER.map((k) => {
        const on = values[k] !== null;
        return (
          <div key={k} className={cn(card, "flex flex-wrap items-center justify-between gap-4")}>
            <label className="flex min-w-60 flex-1 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1.5 size-5" checked={on} onChange={(e) => toggle(k, e.target.checked)} />
              <span>
                <span className="block text-lg font-medium">{t(k)}</span>
                <span className="block text-sm text-ink-soft">{t(`${k}Hint`)}</span>
              </span>
            </label>
            <label className={cn("flex items-center gap-2", !on && "opacity-40")}>
              <input
                type="number" min={1} max={MAX[k]} step={k === "staffing" ? 1 : 0.5} disabled={!on} aria-label={t(k)}
                value={values[k] ?? ""} onChange={(e) => set(k, Number(e.target.value))}
                className="h-11 w-24 rounded-xl border border-brand/20 bg-white px-3 text-right"
              />
              <span className="text-sm text-ink-soft">{t(UNIT[k])}</span>
            </label>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>{pending ? t("saving") : t("save")}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-brand" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </div>
  );
}
