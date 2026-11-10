import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/guards";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import { LocationsManager } from "./locations-manager";

export default async function LocationsPage({ params }: PageProps<"/[locale]/admin/locations">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("locations");
  const { all } = await getLocationContext();
  const supabase = await createClient();
  const { data } = await supabase.from("employee_locations").select("location_id").returns<{ location_id: string }[]>();
  const staff: Record<string, number> = {};
  for (const r of data ?? []) staff[r.location_id] = (staff[r.location_id] ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>
      <LocationsManager rows={all.map((l) => ({ id: l.id, name: l.name, color: l.color, active: l.is_active, staff: staff[l.id] ?? 0 }))} />
    </div>
  );
}
