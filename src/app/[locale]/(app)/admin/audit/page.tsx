import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { AREAS, actionKey, areaOf, detailParts, patternsFor, type Area } from "@/lib/audit/format";
import { getLocationContext } from "@/lib/locations/active";
import { createClient } from "@/lib/supabase/server";
import { addDays, romeInstant } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

const PAGE = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown>; created_at: string }

export default async function AuditPage({ params, searchParams }: PageProps<"/[locale]/admin/audit">) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("audit");
  const format = await getFormatter();
  const supabase = await createClient();
  const { all: locations } = await getLocationContext();

  const area = (AREAS as readonly string[]).includes(String(sp.area)) ? (sp.area as Area) : "all";
  const actor = typeof sp.actor === "string" && UUID_RE.test(sp.actor) ? sp.actor : null;
  const from = typeof sp.from === "string" && DAY_RE.test(sp.from) ? sp.from : null;
  const to = typeof sp.to === "string" && DAY_RE.test(sp.to) ? sp.to : null;
  const before = typeof sp.before === "string" && /^\d{1,15}$/.test(sp.before) ? Number(sp.before) : null;

  let query = supabase.from("audit_logs").select("id, actor_id, action, entity_type, entity_id, changes, created_at").order("id", { ascending: false }).limit(PAGE + 1);
  const patterns = patternsFor(area);
  if (patterns.length) query = query.or(patterns.map((p) => `action.like.${p}`).join(","));
  if (actor) query = query.eq("actor_id", actor);
  if (from) query = query.gte("created_at", romeInstant(from, "00:00").toISOString());
  if (to) query = query.lt("created_at", romeInstant(addDays(to, 1), "00:00").toISOString());
  if (before) query = query.lt("id", before);
  const { data, error } = await query.returns<Row[]>();
  const rows = (data ?? []).slice(0, PAGE);
  const hasMore = (data ?? []).length > PAGE;

  // names of everyone who did something or is mentioned (admins can read all profiles)
  const { data: people } = await supabase.from("profiles").select("id, first_name, last_name, role").returns<{ id: string; first_name: string; last_name: string; role: string }[]>();
  const names = new Map((people ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
  const admins = (people ?? []).filter((p) => p.role === "admin");
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const when = (d: string) => format.dateTime(new Date(d), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
  const hm = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Rome" });
  const resolvers = {
    person: (id: string) => names.get(id) ?? "?",
    location: (id: string) => locName.get(id) ?? "?",
    range: (a: string, b: string) => `${format.dateTime(new Date(a), { weekday: "short", day: "numeric", timeZone: "Europe/Rome" })} · ${hm(a)}–${hm(b)}`,
    date: (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }),
    reason: (code: string) => (t.has(`reasons.${code}`) ? t(`reasons.${code}`) : code),
  };
  const label = (action: string) => {
    const key = actionKey(action);
    return t.has(`actions.${key}`) ? t(`actions.${key}`) : action;
  };

  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { area: area === "all" ? null : area, actor, from, to, before: null, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/audit${s ? `?${s}` : ""}`;
  };
  const card = "rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-soft)]";
  const pill = (on: boolean) => cn("rounded-full px-4 py-2 text-sm font-medium", on ? "bg-brand text-ivory" : "bg-mist text-ink-soft hover:text-ink");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={t("filters")}>
        {AREAS.map((a) => <Link key={a} href={qs({ area: a === "all" ? null : a })} className={pill(a === area)}>{t(`area.${a}`)}</Link>)}
      </nav>

      <form method="get" className={cn(card, "flex flex-wrap items-end gap-3")}>
        {area !== "all" && <input type="hidden" name="area" value={area} />}
        <label className="text-sm font-medium">{t("who")}
          <select name="actor" defaultValue={actor ?? ""} className="mt-1 block h-11 rounded-xl border border-brand/20 bg-white px-3">
            <option value="">{t("anyone")}</option>
            {admins.map((p) => <option key={p.id} value={p.id}>{`${p.first_name} ${p.last_name}`.trim()}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{t("from")}<input type="date" name="from" defaultValue={from ?? ""} className="mt-1 block h-11 rounded-xl border border-brand/20 bg-white px-3" /></label>
        <label className="text-sm font-medium">{t("to")}<input type="date" name="to" defaultValue={to ?? ""} className="mt-1 block h-11 rounded-xl border border-brand/20 bg-white px-3" /></label>
        <button type="submit" className="h-11 rounded-full bg-brand px-6 text-sm font-medium text-ivory hover:bg-brand-dark">{t("apply")}</button>
        {(actor || from || to) && <Link href={qs({ actor: null, from: null, to: null })} className="h-11 self-center text-sm text-brand underline">{t("reset")}</Link>}
      </form>

      {error && <p role="alert" className="text-danger">{t("loadError")}</p>}

      <section className={cn(card, "overflow-x-auto p-0")} aria-label={t("title")}>
        {rows.length === 0 ? <p className="p-6 text-ink-soft">{t("empty")}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft">
              <th className="px-4 py-3 font-medium">{t("colWhen")}</th><th className="px-4 py-3 font-medium">{t("colWho")}</th>
              <th className="px-4 py-3 font-medium">{t("colWhat")}</th><th className="px-4 py-3 font-medium">{t("colDetail")}</th>
            </tr></thead>
            <tbody className="divide-y divide-brand/10">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-soft">{when(r.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{r.actor_id ? names.get(r.actor_id) ?? "?" : t("system")}</td>
                  <td className="px-4 py-2.5"><span className={cn("rounded-full px-2.5 py-0.5 text-xs", areaOf(r.action) === "other" ? "bg-mist" : "bg-brand-soft text-brand")}>{label(r.action)}</span></td>
                  <td className="px-4 py-2.5 text-ink-soft">{detailParts(r.action, r.changes, resolvers).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {hasMore && rows.length > 0 && (
        <Link href={qs({ before: String(rows[rows.length - 1].id) })} className={cn(pill(false), "inline-block")}>{t("older")} →</Link>
      )}
      <p className="text-xs text-ink-soft">{t("appendOnly")}</p>
    </div>
  );
}
