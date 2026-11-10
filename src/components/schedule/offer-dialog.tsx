"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";
import { offerShift } from "@/lib/scheduling/requests-actions";
import { isWithinHours, toMin, type ShiftHours } from "@/lib/scheduling/shift-hours";

/** Employee: offer a time to work. Nothing is scheduled until an admin approves it. */
export function OfferDialog({ open, defaultDay, hours, locationId, onClose, onSent }: {
  open: boolean; defaultDay: string; hours: ShiftHours; locationId?: string; onClose: () => void; onSent: () => void;
}) {
  const t = useTranslations("schedule");
  const ref = useRef<HTMLDialogElement>(null);
  const [day, setDay] = useState(defaultDay);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("00:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setDay(defaultDay);
      setError(null);
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open, defaultDay]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const openH = Math.floor(toMin(hours.open) / 60);
  const closeH = Math.floor(toMin(hours.close) / 60);
  const startHours = Array.from({ length: 24 - openH }, (_, i) => pad(openH + i));
  const endHours = [...startHours, ...Array.from({ length: closeH + 1 }, (_, i) => pad(i))];
  const ok = isWithinHours(start, end, hours);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await offerShift({ day, start, end, note, locationId });
      if (res.ok) onSent();
      else setError(res.error);
    });
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="offer-title"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-b-none rounded-t-3xl sm:m-auto sm:max-h-[90dvh] sm:w-[min(30rem,calc(100vw-1.5rem))] sm:rounded-[var(--radius-card)] bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/40">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); send(); }} className="space-y-4 p-6">
        <h2 id="offer-title" className="font-display text-3xl text-brand">{t("offerTitle")}</h2>
        <p className="text-sm text-ink-soft">{t("offerIntro")}</p>
        <div>
          <Label htmlFor="offer-day">{t("date")}</Label>
          <Input id="offer-day" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>{t("from")}</Label><TimeSelect label={t("from")} value={start} hours={startHours} invalid={!ok} onChange={setStart} /></div>
          <div><Label>{t("to")}</Label><TimeSelect label={t("to")} value={end} hours={endHours} invalid={!ok} onChange={setEnd} /></div>
        </div>
        {!ok && <p role="alert" className="text-sm text-danger">{t("hoursLimit", { open: hours.open, close: hours.close })}</p>}
        <div>
          <Label htmlFor="offer-note">{t("requestNote")}</Label>
          <Input id="offer-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <FieldError>{error && t(`errors.${error as "unknown"}`)}</FieldError>
        <div className="flex gap-3">
          <Button type="submit" size="lg" disabled={pending || !ok || !day}>{t("offerSend")}</Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => ref.current?.close()}>{t("cancel")}</Button>
        </div>
      </form>
    </dialog>
  );
}
