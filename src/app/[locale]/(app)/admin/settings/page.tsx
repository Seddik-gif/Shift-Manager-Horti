import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { parseRules } from "@/lib/scheduling/analysis";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import { RulesForm } from "./rules-form";
import { SwapOption } from "./swap-option";
import { ChatAdmin } from "./chat-admin";

export default async function SettingsPage({ params }: PageProps<"/[locale]/admin/settings">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("settings");
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "scheduling_rules").maybeSingle<{ value: unknown }>();
  const rules = parseRules(data?.value);
  const [{ data: chatRow }, { data: purgeRow }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "chat_options").maybeSingle<{ value: { location_broadcast?: boolean } }>(),
    supabase.from("app_settings").select("value").eq("key", "chat_purge").maybeSingle<{ value: { last_run?: string; messages?: number; notifications?: number } }>(),
  ]);
  const { data: swapRow } = await supabase.from("app_settings").select("value").eq("key", "swap_options").maybeSingle<{ value: { admin_approval?: boolean } }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-medium text-brand">{t("title")}</h1>
        <p className="text-ink-soft">{t("intro")}</p>
        <Link href="/admin/audit" className="mt-2 inline-block text-sm text-brand underline">{(await getTranslations("audit"))("link")} →</Link>
      </div>
      <RulesForm initial={{ staffing: rules.minStaffPerDay ?? null }} />
      <SwapOption initial={swapRow?.value?.admin_approval !== false} />
      <ChatAdmin
        broadcast={chatRow?.value?.location_broadcast === true}
        status={{ lastRun: purgeRow?.value?.last_run ?? null, messages: purgeRow?.value?.messages ?? 0, notifications: purgeRow?.value?.notifications ?? 0 }}
        locale={locale}
      />
    </div>
  );
}
