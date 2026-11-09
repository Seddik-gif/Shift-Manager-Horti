"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createEmployee, updateEmployee } from "@/lib/employees/actions";
import { EMPLOYEE_COLORS } from "@/lib/employees/colors";
import { employeeSchema, employeeUpdateSchema, type EmployeeInput } from "@/lib/validation/employee";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  mode: "create" | "edit";
  employeeId?: string;
  defaults: EmployeeInput;
}

export function EmployeeForm({ mode, employeeId, defaults }: Props) {
  const t = useTranslations("employees.form");
  const tv = useTranslations("validation");
  const te = useTranslations("employees.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<EmployeeInput>({
    resolver: zodResolver(mode === "create" ? employeeSchema : employeeUpdateSchema.extend({ email: employeeSchema.shape.email.optional() })) as never,
    defaultValues: defaults,
  });
  const color = useWatch({ control, name: "color" });
  const msg = (key?: string) => (key ? tv(key as "required") : undefined);

  function onSubmit(values: EmployeeInput) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      const res = mode === "create" ? await createEmployee(values) : await updateEmployee(employeeId!, values);
      if (!res.ok) return setServerError(res.error);
      if (mode === "create") router.push(`/admin/employees/${res.id}`);
      else setSaved(true);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName">{t("firstName")}</Label>
          <Input id="firstName" autoComplete="off" aria-invalid={!!errors.firstName} {...register("firstName")} />
          <FieldError>{msg(errors.firstName?.message)}</FieldError>
        </div>
        <div>
          <Label htmlFor="lastName">{t("lastName")}</Label>
          <Input id="lastName" autoComplete="off" aria-invalid={!!errors.lastName} {...register("lastName")} />
          <FieldError>{msg(errors.lastName?.message)}</FieldError>
        </div>
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" type="email" inputMode="email" readOnly={mode === "edit"} aria-invalid={!!errors.email}
            className={mode === "edit" ? "bg-mist" : undefined} {...register("email")} />
          <FieldError>{msg(errors.email?.message)}</FieldError>
          {mode === "edit" && <p className="mt-1.5 text-xs text-ink-soft">{t("emailLocked")}</p>}
        </div>
        <div>
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" type="tel" inputMode="tel" aria-invalid={!!errors.phone} {...register("phone")} />
          <FieldError>{msg(errors.phone?.message)}</FieldError>
        </div>
        <div>
          <Label htmlFor="jobPosition">{t("jobPosition")}</Label>
          <Input id="jobPosition" placeholder={t("jobPositionHint")} aria-invalid={!!errors.jobPosition} {...register("jobPosition")} />
          <FieldError>{msg(errors.jobPosition?.message)}</FieldError>
        </div>
        <div>
          <Label htmlFor="preferredLanguage">{t("language")}</Label>
          <select id="preferredLanguage" className="h-12 w-full rounded-xl border border-brand/20 bg-white px-4 text-base" {...register("preferredLanguage")}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t("color")}</legend>
        <div className="flex flex-wrap gap-2">
          {EMPLOYEE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setValue("color", c, { shouldDirty: true })}
              aria-label={c}
              aria-pressed={color.toLowerCase() === c.toLowerCase()}
              style={{ backgroundColor: c }}
              className={cn("size-9 rounded-full ring-offset-2 transition", color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-brand" : "hover:scale-110")}
            />
          ))}
        </div>
        <FieldError>{msg(errors.color?.message)}</FieldError>
      </fieldset>

      {mode === "create" && <p className="text-sm text-ink-soft">{t("inviteNote")}</p>}
      <FieldError>{serverError && te(serverError as "forbidden")}</FieldError>
      {saved && <p role="status" className="text-sm text-brand">{t("saved")}</p>}

      <Button type="submit" size="lg" disabled={pending}>
        {mode === "create" ? t("createAndInvite") : t("save")}
      </Button>
    </form>
  );
}
