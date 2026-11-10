import { getTranslations, setRequestLocale } from "next-intl/server";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { requireEmployee } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { todayInRome } from "@/lib/time/rome";
import type { Locale } from "@/i18n/routing";
import { AbsenceForm, type AbsenceItem } from "./absence-form";

export default async function AbsencesPage({ params }: PageProps<"/[locale]/employee/absences">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const me = await requireEmployee(locale);
  const t = await getTranslations("absences");
  const supabase = await createClient();
  const { data } = await supabase
    .from("absence_requests")
    .select("id, kind, start_date, end_date, reason, status, decision_note")
    .eq("employee_id", me.id)
    .order("start_date", { ascending: false })
    .limit(30)
    .returns<{ id: string; kind: "ferie" | "assenza"; start_date: string; end_date: string; reason: string | null; status: AbsenceItem["status"]; decision_note: string | null }[]>();

  const today = todayInRome();
  const items: AbsenceItem[] = (data ?? []).map((a) => ({
    id: a.id, kind: a.kind, start: a.start_date, end: a.end_date, reason: a.reason ?? "", status: a.status, decisionNote: a.decision_note ?? "",
    withdrawable: a.status === "pending" || (a.status === "approved" && a.start_date > today),
  }));

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`employee-absences-${me.id}`} tables={[{ table: "absence_requests", filter: `employee_id=eq.${me.id}` }]} />
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
      </div>
      <AbsenceForm items={items} today={today} locale={locale} />
    </div>
  );
}
