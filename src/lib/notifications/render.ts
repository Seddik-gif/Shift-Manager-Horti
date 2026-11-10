import { createTranslator } from "next-intl";
import it from "../../../messages/it.json";
import en from "../../../messages/en.json";
import { weekRangeLabel } from "@/lib/format/week";
import { TZ } from "@/lib/time/rome";

export const NOTIFICATION_TYPES = [
  "availability_requested",
  "availability_submitted",
  "availability_updated",
  "availability_confirmed",
  "availability_deadline",
  "availability_missing",
  "schedule_modified",
  "schedule_published",
  "schedule_updated",
  "schedule_publish_confirmed",
  "open_shift_posted",
  "shift_request_received",
  "shift_request_approved",
  "shift_request_rejected",
  "shift_assigned",
  "shift_changed",
  "shift_removed",
  "shifts_updated",
  "availability_review_confirmed",
  "availability_changes_requested",
  "absence_requested",
  "absence_approved",
  "absence_rejected",
  "swap_proposed",
  "swap_accepted",
  "swap_declined",
  "swap_review",
  "swap_approved",
  "swap_rejected",
  "chat_message",
  "chat_mention",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const MESSAGES = { it, en } as const;

/** "lunedì 16 novembre · 18:00–02:00" from starts_at / ends_at, in Rome time. */
function whenLabel(locale: "it" | "en", params: Record<string, unknown>): string {
  if (typeof params.starts_at !== "string" || typeof params.ends_at !== "string") return "";
  const s = new Date(params.starts_at);
  const e = new Date(params.ends_at);
  const day = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(s);
  const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day} · ${hm(s)}–${hm(e)}`;
}

/** "16–20 novembre" / "16 novembre" from start_date / end_date (Rome calendar days). */
function datesLabel(locale: "it" | "en", params: Record<string, unknown>): string {
  if (typeof params.start_date !== "string" || typeof params.end_date !== "string") return "";
  const f = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));
  if (params.start_date === params.end_date) return f(params.start_date, { day: "numeric", month: "long" });
  return `${f(params.start_date, { day: "numeric", month: "short" })} – ${f(params.end_date, { day: "numeric", month: "short" })}`;
}

/**
 * Notifications are stored language-neutral (type + params) and rendered in the
 * reader's own language, in the app, in emails and anywhere else.
 */
export function renderNotification(
  locale: "it" | "en",
  type: string,
  params: Record<string, unknown>,
): { title: string; body: string } {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "notifications.types" });
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) return { title: type, body: "" };

  const weekStart = typeof params.week_start === "string" ? params.week_start : null;
  const deadline = typeof params.deadline === "string" ? new Date(params.deadline) : null;
  const values = {
    week: weekStart ? weekRangeLabel(weekStart, locale) : "",
    name: String(params.employee_name ?? ""),
    other: String(params.other_name ?? ""),
    preview: String(params.preview ?? ""),
    count: Number(params.count ?? 0),
    assigned: Number(params.assigned ?? 0),
    changed: Number(params.changed ?? 0),
    removed: Number(params.removed ?? 0),
    version: Number(params.version ?? 0),
    kind: String(params.kind ?? ""),
    note: String(params.note ?? ""),
    when: whenLabel(locale, params),
    dates: datesLabel(locale, params),
    absenceKind: params.kind === "ferie" ? (locale === "it" ? "ferie" : "holiday") : (locale === "it" ? "assenza" : "absence"),
    republished: params.republished === true ? "yes" : "no",
    deadline: deadline
      ? new Intl.DateTimeFormat(locale, {
          timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).format(deadline)
      : "",
  };
  const key = type as NotificationType;
  return { title: t(`${key}.title`, values), body: t(`${key}.body`, values) };
}
