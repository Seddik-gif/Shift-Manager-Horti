"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createRequest } from "@/lib/availability/actions";
import { weekRangeLabel } from "@/lib/format/week";
import { addDays } from "@/lib/time/rome";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";

export function NewRequestForm({ weeks }: { weeks: string[] }) {
  const t = useTranslations("availability.admin");
  const te = useTranslations("availability.errors");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weekStart, setWeekStart] = useState(weeks[0] ?? "");
  const [deadlineDay, setDeadlineDay] = useState(weeks[0] ? addDays(weeks[0], -3) : "");
  const [deadlineTime, setDeadlineTime] = useState("20:00");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (weeks.length === 0) return <p className="text-sm text-ink-soft">{t("noFreeWeeks")}</p>;

  function submit(send: boolean) {
    setError(null);
    if (!deadlineDay) return setError("invalid_input");
    startTransition(async () => {
      const res = await createRequest({ weekStart, deadline: `${deadlineDay}T${deadlineTime}`, message, send });
      if (!res.ok) return setError(res.error);
      router.push(`/admin/availability/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="week">{t("week")}</Label>
          <select id="week" value={weekStart} className="h-12 w-full rounded-xl border border-brand/20 bg-white px-4 capitalize"
            onChange={(e) => { setWeekStart(e.target.value); setDeadlineDay(addDays(e.target.value, -3)); }}>
            {weeks.map((w) => <option key={w} value={w}>{weekRangeLabel(w, locale)}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="deadlineDay">{t("deadline")}</Label>
          <div className="flex items-center gap-2">
            <Input id="deadlineDay" type="date" value={deadlineDay} onChange={(e) => setDeadlineDay(e.target.value)} />
            <TimeSelect label={t("deadline")} value={deadlineTime} onChange={setDeadlineTime} />
          </div>
        </div>
      </div>
      <div>
        <Label htmlFor="message">{t("message")}</Label>
        <textarea id="message" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-xl border border-brand/20 bg-white p-3" placeholder={t("messageHint")} />
      </div>
      <FieldError>{error && te(error as "unknown")}</FieldError>
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="lg" disabled={pending} onClick={() => submit(true)}>{t("sendNow")}</Button>
        <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => submit(false)}>{t("saveDraft")}</Button>
      </div>
    </div>
  );
}
