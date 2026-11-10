"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setActiveLocation } from "@/lib/locations/actions";

export interface SwitcherLocation { id: string; name: string; color: string }

/** Pick the bar you are working in. The accent colour follows the selection. */
export function LocationSwitcher({ locations, activeId }: { locations: SwitcherLocation[]; activeId: string }) {
  const t = useTranslations("locations");
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = locations.find((l) => l.id === activeId);
  if (locations.length < 2) {
    return active ? (
      <span className="inline-flex items-center gap-2 rounded-full bg-mist px-3 py-1.5 text-sm font-medium text-ink">
        <span className="size-3 rounded-full" style={{ backgroundColor: active.color }} aria-hidden />{active.name}
      </span>
    ) : null;
  }
  return (
    <label className="inline-flex items-center gap-2 rounded-full bg-mist px-3 py-1.5 text-sm font-medium text-ink">
      <span className="size-3 rounded-full" style={{ backgroundColor: active?.color }} aria-hidden />
      <span className="sr-only">{t("switch")}</span>
      <select
        value={activeId}
        disabled={pending}
        onChange={(e) => start(async () => { await setActiveLocation(e.target.value); router.refresh(); })}
        className="max-w-36 truncate bg-transparent pr-1 outline-none sm:max-w-none"
      >
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}
