import { renderNotification } from "@/lib/notifications/render";

/** Consecutive failures after which a device is switched off and shown as "notifications off". */
export const MAX_FAILURES = 3;

export type PushOutcome =
  | { kind: "ok" }
  | { kind: "gone" } // the push service reports the subscription as expired/unsubscribed (404/410)
  | { kind: "error"; status?: number };

export type SubscriptionAction = "keep" | "delete" | "disable";

/** What to do with a subscription after one delivery attempt. Pure, so it can be tested without a network. */
export function afterAttempt(failureCount: number, outcome: PushOutcome): { action: SubscriptionAction; failureCount: number } {
  if (outcome.kind === "ok") return { action: "keep", failureCount: 0 };
  if (outcome.kind === "gone") return { action: "delete", failureCount };
  const next = failureCount + 1;
  return { action: next >= MAX_FAILURES ? "disable" : "keep", failureCount: next };
}

/** Map a web-push error to an outcome. */
export function outcomeOf(error: unknown): PushOutcome {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 404 || status === 410) return { kind: "gone" };
  return { kind: "error", status };
}

export interface PushPayload {
  title: string;
  body: string;
  /** absolute-path URL to open on tap (already locale-prefixed) */
  url: string;
  /** notifications with the same tag replace each other on the device */
  tag: string;
}

/** The text of a push, in the reader's language. Only same-origin paths are ever put in `url`. */
export function buildPushPayload(
  locale: "it" | "en", id: string, type: string, params: Record<string, unknown>, link: string | null,
): PushPayload {
  const { title, body } = renderNotification(locale, type, params);
  const path = link && link.startsWith("/") && !link.startsWith("//") ? link : "/";
  const prefix = locale === "it" ? "" : "/en";
  const url = path === "/" ? prefix || "/" : `${prefix}${path}`;
  return { title, body, url, tag: `hm-${id}` };
}
