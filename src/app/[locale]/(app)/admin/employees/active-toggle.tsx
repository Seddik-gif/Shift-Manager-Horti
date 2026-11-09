"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setEmployeeActive } from "@/lib/employees/actions";
import { Button } from "@/components/ui/button";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("employees");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function toggle() {
    if (active && !window.confirm(t("confirmDeactivate"))) return;
    setError(false);
    startTransition(async () => {
      const res = await setEmployeeActive(id, !active);
      if (!res.ok) setError(true);
      else router.refresh();
    });
  }

  return (
    <div>
      <Button variant={active ? "outline" : "primary"} onClick={toggle} disabled={pending}>
        {active ? t("deactivate") : t("reactivate")}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{t("errors.saveFailed")}</p>}
    </div>
  );
}
