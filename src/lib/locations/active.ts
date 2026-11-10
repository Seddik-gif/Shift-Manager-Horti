import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const LOCATION_COOKIE = "hm_loc";

export interface LocationRow {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
  sort_order: number;
}

export interface LocationContext {
  /** every location the user may see (admins: also archived ones) */
  all: LocationRow[];
  /** selectable locations (active only) */
  locations: LocationRow[];
  /** the location currently in use, or null when none exists */
  active: LocationRow | null;
}

/**
 * The visible locations and the one in use. The choice lives in a cookie (set by the switcher or by a
 * `?loc=` link, see proxy.ts) and is always re-validated against what RLS lets this user see.
 * Cached per request so the shell and the page share one query.
 */
export const getLocationContext = cache(async (): Promise<LocationContext> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, name, color, is_active, sort_order")
    .order("sort_order")
    .order("name")
    .returns<LocationRow[]>();
  const all = data ?? [];
  const locations = all.filter((l) => l.is_active);
  const wanted = (await cookies()).get(LOCATION_COOKIE)?.value;
  const active = locations.find((l) => l.id === wanted) ?? locations[0] ?? null;
  return { all, locations, active };
});
