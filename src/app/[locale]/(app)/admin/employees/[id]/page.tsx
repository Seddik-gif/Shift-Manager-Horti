import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import type { Profile } from "@/types/database";
import { EmployeeForm } from "../employee-form";
import { ActiveToggle } from "../active-toggle";
import { EmployeeLocations } from "../employee-locations";
import { getLocationContext } from "@/lib/locations/active";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmissionRow {
  id: string;
  status: "draft" | "submitted";
  submitted_at: string | null;
  availability_requests: { week_start: string } | null;
}
interface ShiftRow {
  id: string;
  starts_at: string;
  ends_at: string;
  job_position: string | null;
  weekly_schedules: { status: "draft" | "published" } | null;
}

export default async function EmployeeDetailPage({ params }: PageProps<"/[locale]/admin/employees/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const t = await getTranslations("employees");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data: employee } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, phone, job_position, color, is_active, role, preferred_language, created_at")
    .eq("id", id)
    .eq("role", "employee")
    .maybeSingle<Profile>();
  if (!employee) notFound();

  const { locations } = await getLocationContext();
  const { data: assigned } = await supabase.from("employee_locations").select("location_id").eq("employee_id", id).returns<{ location_id: string }[]>();

  const [{ data: submissions }, { data: shifts }] = await Promise.all([
    supabase
      .from("availability_submissions")
      .select("id, status, submitted_at, availability_requests(week_start)")
      .eq("employee_id", id)
      .order("created_at", { ascending: false })
      .limit(12)
      .returns<SubmissionRow[]>(),
    supabase
      .from("shifts")
      .select("id, starts_at, ends_at, job_position, weekly_schedules(status)")
      .eq("employee_id", id)
      .order("starts_at", { ascending: false })
      .limit(20)
      .returns<ShiftRow[]>(),
  ]);

  const time = (d: string) => format.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = (d: string) => format.dateTime(new Date(d), { weekday: "short", day: "numeric", month: "short" });
  const card = "rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="size-6 rounded-full" style={{ backgroundColor: employee.color }} aria-hidden />
          <div>
            <h1 className="font-display text-4xl font-medium text-brand">{employee.first_name} {employee.last_name}</h1>
            <p className="text-sm text-ink-soft">
              {employee.is_active ? t("statusActive") : t("statusInactive")} · {t("memberSince", { date: format.dateTime(new Date(employee.created_at), { dateStyle: "medium" }) })}
            </p>
          </div>
        </div>
        <ActiveToggle id={employee.id} active={employee.is_active} />
      </div>

      <section className={card}>
        <EmployeeForm
          mode="edit"
          employeeId={employee.id}
          defaults={{
            firstName: employee.first_name,
            lastName: employee.last_name,
            email: employee.email,
            phone: employee.phone ?? "",
            jobPosition: employee.job_position ?? "",
            color: employee.color,
            preferredLanguage: employee.preferred_language,
          }}
        />
      </section>

      <section className={card}>
        <EmployeeLocations
          employeeId={employee.id}
          locations={locations.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
          selected={(assigned ?? []).map((a) => a.location_id)}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-display text-2xl text-brand">{t("availabilityHistory")}</h2>
          {!submissions?.length ? (
            <p className="mt-3 text-sm text-ink-soft">{t("noAvailability")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-brand/10">
              {submissions.map((s) => (
                <li key={s.id} className="flex justify-between py-2 text-sm">
                  <span>{s.availability_requests ? t("weekOf", { date: format.dateTime(new Date(`${s.availability_requests.week_start}T12:00:00Z`), { day: "numeric", month: "long", timeZone: "UTC" }) }) : "—"}</span>
                  <span className="text-ink-soft">{s.status === "submitted" ? t("submitted") : t("draft")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="font-display text-2xl text-brand">{t("shifts")}</h2>
          {!shifts?.length ? (
            <p className="mt-3 text-sm text-ink-soft">{t("noShifts")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-brand/10">
              {shifts.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="capitalize">{day(s.starts_at)} · {time(s.starts_at)}–{time(s.ends_at)}</span>
                  <span className="text-ink-soft">{s.weekly_schedules?.status === "published" ? t("published") : t("draft")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
