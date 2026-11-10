import { describe, expect, it } from "vitest";
import { MAX_FAILURES, afterAttempt, buildPushPayload, outcomeOf } from "@/lib/push/policy";
import { isIos, pushState, urlBase64ToUint8Array, type Env } from "@/lib/push/client-utils";

describe("what happens to a device after a delivery attempt", () => {
  it("a success resets the failure counter", () => {
    expect(afterAttempt(2, { kind: "ok" })).toEqual({ action: "keep", failureCount: 0 });
  });

  it("an expired subscription (404/410) is deleted at once", () => {
    expect(afterAttempt(0, outcomeOf({ statusCode: 410 }))).toMatchObject({ action: "delete" });
    expect(afterAttempt(0, outcomeOf({ statusCode: 404 }))).toMatchObject({ action: "delete" });
  });

  it("other errors count up and switch the device off after three in a row", () => {
    let n = 0;
    const actions: string[] = [];
    for (let i = 0; i < MAX_FAILURES; i++) {
      const r = afterAttempt(n, outcomeOf({ statusCode: 500 }));
      actions.push(r.action);
      n = r.failureCount;
    }
    expect(actions).toEqual(["keep", "keep", "disable"]);
  });

  it("network errors without a status are treated as ordinary failures, never as 'gone'", () => {
    expect(outcomeOf(new Error("ETIMEDOUT"))).toEqual({ kind: "error", status: undefined });
    expect(outcomeOf(null)).toEqual({ kind: "error", status: undefined });
  });
});

describe("push payload", () => {
  it("renders in the reader's language with a locale-prefixed link", () => {
    const it = buildPushPayload("it", "n1", "swap_proposed", { employee_name: "Marco" }, "/employee/swaps");
    expect(it.url).toBe("/employee/swaps");
    expect(it.title).toBe("Proposta di scambio");
    const en = buildPushPayload("en", "n1", "swap_proposed", { employee_name: "Marco" }, "/employee/swaps");
    expect(en.url).toBe("/en/employee/swaps");
    expect(en.title).toBe("Swap proposal");
    expect(en.tag).toBe("hm-n1");
  });

  it("falls back to the home page and never emits an external or protocol-relative URL", () => {
    expect(buildPushPayload("it", "a", "absence_approved", {}, null).url).toBe("/");
    expect(buildPushPayload("en", "a", "absence_approved", {}, null).url).toBe("/en");
    expect(buildPushPayload("it", "a", "absence_approved", {}, "//evil.example/x").url).toBe("/");
    expect(buildPushPayload("it", "a", "absence_approved", {}, "https://evil.example").url).toBe("/");
  });
});

describe("browser helpers", () => {
  it("decodes a base64url VAPID key into bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]); // url-safe alphabet, no padding
  });

  const base: Env = {
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120", platform: "Linux armv8l", maxTouchPoints: 5, standalone: false,
    hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default", subscribed: false,
  };
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", platform: "iPhone" };

  it("detects iPhones, iPads and iPadOS posing as a Mac", () => {
    expect(isIos(iphone.userAgent, "iPhone", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIos(base.userAgent, base.platform, 5)).toBe(false);
  });

  it("gates iOS: install first, whatever else is true, until the app runs from the Home Screen", () => {
    expect(pushState({ ...base, ...iphone, hasPushManager: false })).toBe("install_first");
    expect(pushState({ ...base, ...iphone, permission: "granted", subscribed: true })).toBe("install_first");
    expect(pushState({ ...base, ...iphone, standalone: true })).toBe("off");
  });

  it("covers every other state", () => {
    expect(pushState(base)).toBe("off");
    expect(pushState({ ...base, hasPushManager: false })).toBe("unsupported");
    expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
    expect(pushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
    expect(pushState({ ...base, permission: "granted", subscribed: false })).toBe("off"); // permission given, device not registered yet
  });
});
