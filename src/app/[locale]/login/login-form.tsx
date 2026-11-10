"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn, type FormState } from "@/lib/auth/actions";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

export function LoginForm({ locale, shortId = false }: { locale: Locale; shortId?: boolean }) {
  const t = useTranslations("login");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(signIn.bind(null, locale), {});

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <div>
        <Label htmlFor="email">{shortId ? t("idOrEmail") : t("email")}</Label>
        <Input id="email" name="email" type={shortId ? "text" : "email"} autoComplete={shortId ? "username" : "email"} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
          aria-invalid={!!state.fieldErrors?.email} aria-describedby="email-error" />
        <FieldError id="email-error">{state.fieldErrors?.email && tv(state.fieldErrors.email as "required")}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required
          aria-invalid={!!state.fieldErrors?.password} aria-describedby="password-error" />
        <FieldError id="password-error">{state.fieldErrors?.password && tv(state.fieldErrors.password as "required")}</FieldError>
      </div>
      <FieldError>{state.error && te(state.error as "invalidCredentials")}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
