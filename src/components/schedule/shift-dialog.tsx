"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { deleteShift, saveShift } from "@/lib/scheduling/actions";
import { createOpenShift } from "@/lib/scheduling/requests-actions";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";
import { isWithinHours, toMin, type ShiftHours } from "@/lib/scheduling/shift-hours";

export interface ShiftDraft {
  id: string | null;
  employeeId: string;
  day: string;
  start: string;
  end: string;
  position: string;
  notes: string;
  /** set when a drag/resize already hit an availability mismatch */
  warning?: "outside" | "no_submission" | "absence" | null;
}
/** pseudo-employee id meaning "an open shift, to be taken by someone" */
export const OPEN = "__open__";
export interface EmployeeOption { id: string; name: string; position: string; active: boolean; color: string }

interface Props {
  draft: ShiftDraft | null;
  employees: EmployeeOption[];
  hours: ShiftHours;
  locationId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ShiftDialog({ draft, employees, hours, locationId, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("schedule");
  const [form, setForm] = useState<ShiftDraft | null>(draft);
  const [warning, setWarning] = useState<"outside" | "no_submission" | "absence" | null>(null);
  const [overrideNote, setOverrideNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState(1);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (draft) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset form when a new draft is opened */
      setForm(draft);
      setWarning(draft.warning ?? null);
      setOverrideNote("");
      setSlots(1);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      if (!el.open) el.showModal();
    } else if (el.open) el.close();
  }, [draft]);

  if (!form) return <dialog ref={ref} onClose={onClose} />;
  const set = (patch: Partial<ShiftDraft>) => {
    setForm({ ...form, ...patch });
    setWarning(null);
    setError(null);
  };
  const overnight = form.end <= form.start && form.end !== form.start;
  const inRange = isWithinHours(form.start, form.end, hours);
  // hour choices: starts from opening time to 23; ends from opening time to 23, then the small hours up to closing
  const pad = (n: number) => String(n).padStart(2, "0");
  const openH = Math.floor(toMin(hours.open) / 60);
  const closeH = Math.floor(toMin(hours.close) / 60);
  const startHours = Array.from({ length: 24 - openH }, (_, i) => pad(openH + i));
  const endHours = [...startHours, ...Array.from({ length: closeH + 1 }, (_, i) => pad(i))];

  const isOpen = form.employeeId === OPEN && !form.id;

  function submit() {
    if (!form) return;
    setError(null);
    startTransition(async () => {
      if (isOpen) {
        const r = await createOpenShift({ day: form.day, start: form.start, end: form.end, position: form.position, note: form.notes, slots, locationId });
        if (r.ok) return onSaved();
        return setError(r.error);
      }
      const res = await saveShift({
        id: form.id, employeeId: form.employeeId, day: form.day, start: form.start, end: form.end,
        position: form.position, notes: form.notes, override: warning !== null, overrideNote, locationId,
      });
      if (res.ok) return onSaved();
      if ("warning" in res) return setWarning(res.warning);
      setError(res.error);
    });
  }

  function remove() {
    if (!form?.id || !window.confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      const res = await deleteShift(form.id as string);
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="shift-dialog-title"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-b-none rounded-t-3xl sm:m-auto sm:max-h-[90dvh] sm:w-[min(32rem,calc(100vw-1.5rem))] sm:rounded-[var(--radius-card)] sm:rounded-b-[var(--radius-card)] bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4 p-6">
        <h2 id="shift-dialog-title" className="font-display text-3xl text-brand">{form.id ? t("editShift") : t("newShift")}</h2>

        <div>
          <Label htmlFor="shift-employee">{t("employee")}</Label>
          <select id="shift-employee" value={form.employeeId} className="h-12 w-full rounded-xl border border-brand/20 bg-white px-4"
            onChange={(e) => {
              const emp = employees.find((x) => x.id === e.target.value);
              set({ employeeId: e.target.value, position: form.position || emp?.position || "" });
            }}>
            {!form.id && <option value={OPEN}>{t("openShiftOption")}</option>}
            {employees.filter((e) => e.active || e.id === form.employeeId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="shift-day">{t("date")}</Label>
            <Input id="shift-day" type="date" required value={form.day} onChange={(e) => set({ day: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="shift-position">{t("position")}</Label>
            <Input id="shift-position" maxLength={60} value={form.position} onChange={(e) => set({ position: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div><Label>{t("from")}</Label><TimeSelect label={t("from")} value={form.start} hours={startHours} invalid={!inRange} onChange={(v) => set({ start: v })} /></div>
          <div><Label>{t("to")}</Label><TimeSelect label={t("to")} value={form.end} hours={endHours} onChange={(v) => set({ end: v })} invalid={!inRange} /></div>
          {!inRange && <p role="alert" className="basis-full text-sm text-danger">{t("hoursLimit", { open: hours.open, close: hours.close })}</p>}
          {overnight && <span className="mb-2 rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">{t("nextDay")}</span>}
        </div>

        {isOpen && (
          <div>
            <Label htmlFor="shift-slots">{t("slots")}</Label>
            <Input id="shift-slots" type="number" min={1} max={20} value={slots} onChange={(e) => setSlots(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} className="w-28" />
            <p className="mt-1 text-xs text-ink-soft">{t("openShiftHint")}</p>
          </div>
        )}
        <div>
          <Label htmlFor="shift-notes">{t("notes")}</Label>
          <textarea id="shift-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })}
            className="w-full rounded-xl border border-brand/20 bg-white p-3" />
        </div>

        {warning && (
          <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-300">
            <p className="font-medium">{t(`override.${warning}`)}</p>
            <p>{t("override.hint")}</p>
            <Label htmlFor="override-note" className="mb-0">{t("override.note")}</Label>
            <Input id="override-note" maxLength={300} value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} className="h-10" />
          </div>
        )}
        <FieldError>{error && t(`errors.${error as "unknown"}`)}</FieldError>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" size="lg" disabled={pending || !inRange || !form.day}>
            {pending ? t("saving") : warning ? t("override.confirm") : t("save")}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => ref.current?.close()}>{t("cancel")}</Button>
          {form.id && <Button type="button" variant="ghost" className="ml-auto text-danger" onClick={remove} disabled={pending}>{t("delete")}</Button>}
        </div>
      </form>
    </dialog>
  );
}
