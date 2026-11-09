import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";
import type { Profile } from "@/types/database";

type Row = Pick<Profile, "id" | "first_name" | "last_name" | "email" | "phone" | "job_position" | "color" | "is_active">;

export default async function EmployeesPage({ params, searchParams }: PageProps<"/[locale]/admin/employees">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin(locale);
  const sp = await searchParams;
  const t = await getTranslations("employees");

  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 60);
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "all";

  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, first_name, last_name, email, phone, job_position, color, is_active")
    .eq("role", "employee")
    .order("first_name");
  if (status !== "all") query = query.eq("is_active", status === "active");
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, " ");
    const p = `%${safe}%`;
    query = query.or(`first_name.ilike.${p},last_name.ilike.${p},email.ilike.${p},job_position.ilike.${p}`);
  }
  const { data, error } = await query.returns<Row[]>();
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <Button asChild>
          <Link href="/admin/employees/new">{t("add")}</Link>
        </Button>
      </div>

      <form method="get" className="flex flex-wrap gap-3" role="search">
        <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("search")} className="max-w-xs" />
        <select name="status" defaultValue={status} aria-label={t("filterStatus")} className="h-12 rounded-xl border border-brand/20 bg-white px-4">
          <option value="all">{t("statusAll")}</option>
          <option value="active">{t("statusActive")}</option>
          <option value="inactive">{t("statusInactive")}</option>
        </select>
        <Button type="submit" variant="secondary" className="h-12">{t("apply")}</Button>
      </form>

      {error ? (
        <p role="alert" className="text-danger">{t("loadError")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-paper p-6 text-ink-soft shadow-[var(--shadow-soft)]">
          {q || status !== "all" ? t("noResults") : t("empty")}
        </p>
      ) : (
        <ul className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
          {rows.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-brand-soft/40">
                <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: e.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.first_name} {e.last_name}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {[e.job_position, e.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={e.is_active ? "rounded-full bg-brand-soft px-3 py-1 text-xs text-brand" : "rounded-full bg-mist px-3 py-1 text-xs text-ink-soft"}>
                  {e.is_active ? t("statusActive") : t("statusInactive")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
