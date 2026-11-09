"use client";

import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

const selectCls =
  "h-11 rounded-xl border border-brand/20 bg-white px-2 text-base tabular-nums aria-[invalid=true]:border-danger";

/** 24-hour time picker (never AM/PM), 5-minute steps, big touch targets for phones. */
export function TimeSelect({
  value, onChange, label, invalid, className, hours,
}: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean; className?: string; hours?: string[] }) {
  const [h, m] = value.split(":");
  const minuteOptions = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  return (
    <span role="group" aria-label={label} className={cn("inline-flex items-center gap-1", className)}>
      <select aria-label={`${label} – h`} aria-invalid={invalid} className={selectCls} value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {(hours ?? HOURS).map((x) => <option key={x}>{x}</option>)}
      </select>
      <span aria-hidden>:</span>
      <select aria-label={`${label} – min`} aria-invalid={invalid} className={selectCls} value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {minuteOptions.map((x) => <option key={x}>{x}</option>)}
      </select>
    </span>
  );
}
