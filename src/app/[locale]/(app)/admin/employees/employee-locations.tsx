"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setEmployeeLocations } from "@/lib/locations/actions";

export interface LocationChoice { id: string; name: string; color: string }

/** Which bars this person can be scheduled at. */
export function EmployeeLocations({ employeeId, locations, selected }: { employeeId: string; locations: LocationChoice[]; selected: string[] }) {
  const t = useTranslations("employees");
  const te = useTranslations("locations.errors");
  const [chosen, setChosen] = useState(new Set(selected));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = () => start(async () => {
    setMsg(null);
    const res = await setEmployeeLocations(employeeId, [...chosen]);
    setMsg(res.ok ? { ok: true, text: t("locationsSaved") } : { ok: false, text: te(res.error as "unknown") });
  });

  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl text-brand">{t("locationsTitle")}</h2>
      <p className="text-sm text-ink-soft">{t("locationsHint")}</p>
      <ul className="flex flex-wrap gap-2">
        {locations.map((l) => (
          <li key={l.id}>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-mist px-4 py-2 text-sm">
              <input type="checkbox" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} />
              <span className="size-3 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />{l.name}
            </label>
          </li>
        ))}
      </ul>
      {chosen.size === 0 && <p className="text-sm text-amber-700">{t("locationsNone")}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending}>{t("locationsSave")}</Button>
        {msg && <p role="status" className={msg.ok ? "text-sm text-brand" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </div>
  );
}
