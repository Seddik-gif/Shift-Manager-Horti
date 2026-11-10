import { getSessionProfile } from "@/lib/auth/guards";
import { buildIcs, type IcsEvent } from "@/lib/calendar/ics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * The signed-in person's own shifts as an .ics file (a week back to four months ahead). Opening it adds the shifts to
 * Google Calendar, Apple Calendar or Outlook. Event ids are stable, so opening a newer file updates instead of duplicating.
 */
export async function GET(request: Request) {
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active) return new Response("Unauthorized", { status: 401 });
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "it";

  const supabase = await createClient();
  const now = Date.now();
  const [{ data: shifts }, { data: places }] = await Promise.all([
    supabase.from("team_shifts").select("id, starts_at, ends_at, job_position, location_id")
      .eq("employee_id", profile.id)
      .gte("starts_at", new Date(now - 7 * DAY).toISOString()).lt("starts_at", new Date(now + 120 * DAY).toISOString())
      .order("starts_at").limit(500)
      .returns<{ id: string; starts_at: string; ends_at: string; job_position: string | null; location_id: string }[]>(),
    supabase.from("locations").select("id, name").returns<{ id: string; name: string }[]>(),
  ]);
  const placeName = new Map((places ?? []).map((l) => [l.id, l.name]));

  const events: IcsEvent[] = (shifts ?? []).map((s) => {
    const place = placeName.get(s.location_id);
    return {
      uid: `shift-${s.id}@horti-magici`,
      start: new Date(s.starts_at),
      end: new Date(s.ends_at),
      summary: place ? `Horti Magici – ${place}` : "Horti Magici",
      location: place,
      description: s.job_position ? (lang === "en" ? `Role: ${s.job_position}` : `Ruolo: ${s.job_position}`) : undefined,
    };
  });

  return new Response(buildIcs(events, lang === "en" ? "Horti Magici shifts" : "Turni Horti Magici"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="turni-horti-magici.ics"',
      "Cache-Control": "no-store",
    },
  });
}
