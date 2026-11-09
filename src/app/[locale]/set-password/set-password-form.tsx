"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setPassword, type FormState } from "@/lib/auth/actions";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

export function SetPasswordForm({ locale }: { locale: Locale }) {
  const t = useTranslations("setPassword");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(setPassword.bind(null, locale), {});

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required
          aria-invalid={!!state.fieldErrors?.password} aria-describedby="password-error" />
        <FieldError id="password-error">{state.fieldErrors?.password && tv(state.fieldErrors.password as "required")}</FieldError>
      </div>
      <div>
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required
          aria-invalid={!!state.fieldErrors?.confirm} aria-describedby="confirm-error" />
        <FieldError id="confirm-error">{state.fieldErrors?.confirm && tv(state.fieldErrors.confirm as "required")}</FieldError>
      </div>
      <FieldError>{state.error && te(state.error as "invalidCredentials")}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{t("submit")}</Button>
    </form>
  );
}
