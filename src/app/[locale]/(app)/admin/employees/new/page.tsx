import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/guards";
import { EMPLOYEE_COLORS } from "@/lib/employees/colors";
import type { Locale } from "@/i18n/routing";
import { EmployeeForm } from "../employee-form";

export default async function NewEmployeePage({ params }: PageProps<"/[locale]/admin/employees/new">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("employees");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-4xl font-medium text-brand">{t("add")}</h1>
      <div className="rounded-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-soft)]">
        <EmployeeForm
          mode="create"
          defaults={{ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", color: EMPLOYEE_COLORS[0], preferredLanguage: "it" }}
        />
      </div>
    </div>
  );
}
