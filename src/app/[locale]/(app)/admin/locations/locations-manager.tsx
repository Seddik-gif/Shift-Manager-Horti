"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { deleteLocation, saveLocation, setLocationActive, type LocationResult } from "@/lib/locations/actions";
import { cn } from "@/lib/utils";

export interface LocationItem { id: string; name: string; color: string; active: boolean; staff: number }

const PALETTE = ["#F5A524", "#12A594", "#E5484D", "#3E63DD", "#8E4EC6", "#30A46C", "#234A49", "#D6409F"];

function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={cn("size-8 rounded-full border-2 transition-transform", value === c ? "scale-110 border-ink" : "border-transparent")}
          style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

export function LocationsManager({ rows }: { rows: LocationItem[] }) {
  const t = useTranslations("locations");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[1]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  function run(fn: () => Promise<LocationResult>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      after?.();
      router.refresh();
    });
  }

  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-danger">{t(`errors.${error as "unknown"}`)}</p>}

      <ul className="space-y-3">
        {rows.map((l) => (
          <li key={l.id} className={cn(card, !l.active && "opacity-70")}>
            {editing === l.id ? (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => saveLocation({ id: l.id, name, color }), () => setEditing(null)); }}>
                <div><Label htmlFor={`n-${l.id}`}>{t("newName")}</Label><Input id={`n-${l.id}`} value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} /></div>
                <ColorPicker value={color} onChange={setColor} label={t("color")} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pending}>{t("save")}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("cancel")}</Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="size-6 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                  <div>
                    <p className="text-lg font-medium">{l.name} {!l.active && <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs text-ink-soft">{t("archived")}</span>}</p>
                    <p className="text-sm text-ink-soft">{t("staff", { count: l.staff })}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(l.id); setName(l.name); setColor(l.color); }}>{t("rename")}</Button>
                  {l.active ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t("confirmArchive")) && run(() => setLocationActive(l.id, false))}>{t("archive")}</Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setLocationActive(l.id, true))}>{t("restore")}</Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t("confirmDelete")) && run(() => deleteLocation(l.id))}>{t("delete")}</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form className={cn(card, "space-y-3")} onSubmit={(e) => { e.preventDefault(); run(() => saveLocation({ id: null, name: newName, color: newColor }), () => setNewName("")); }}>
        <h2 className="font-display text-2xl text-brand">{t("add")}</h2>
        <div><Label htmlFor="new-loc">{t("newName")}</Label><Input id="new-loc" value={newName} maxLength={60} required onChange={(e) => setNewName(e.target.value)} /></div>
        <ColorPicker value={newColor} onChange={setNewColor} label={t("color")} />
        <Button type="submit" disabled={pending || !newName.trim()}>{t("create")}</Button>
      </form>
    </div>
  );
}
