import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl, loginIdDomain, resolveLoginId } from "@/lib/auth/login-id";

describe("short-name login (local development only)", () => {
  it("turns a name into the account's email when enabled", () => {
    expect(resolveLoginId("marco", "horti.test")).toBe("marco@horti.test");
    expect(resolveLoginId("  Stefano ", "horti.test")).toBe("stefano@horti.test");
  });

  it("never touches a real email, empty input or odd characters", () => {
    expect(resolveLoginId("giulia@example.com", "horti.test")).toBe("giulia@example.com");
    expect(resolveLoginId("", "horti.test")).toBe("");
    expect(resolveLoginId("a b", "horti.test")).toBe("a b");
    expect(resolveLoginId("x@y", "horti.test")).toBe("x@y");
  });

  it("does nothing when the feature is off", () => {
    expect(resolveLoginId("marco", null)).toBe("marco");
  });

  it("is only on for a local or private Supabase address, so a hosted project can never get it by accident", () => {
    const on = (url: string) => loginIdDomain({ LOGIN_ID_DOMAIN: "horti.test", NEXT_PUBLIC_SUPABASE_URL: url });
    expect(on("http://127.0.0.1:54421")).toBe("horti.test");
    expect(on("http://localhost:54421")).toBe("horti.test");
    expect(on("http://172.20.10.9:54421")).toBe("horti.test");
    expect(on("http://192.168.1.20:54421")).toBe("horti.test");
    expect(on("http://10.5.0.2:54421")).toBe("horti.test");
    expect(on("https://abcdefgh.supabase.co")).toBeNull();
    expect(on("http://172.32.0.1:54421")).toBeNull(); // just outside the private 172.16–31 range
    expect(on("http://8.8.8.8:54421")).toBeNull();
    expect(loginIdDomain({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" })).toBeNull(); // no domain set
    expect(loginIdDomain({ LOGIN_ID_DOMAIN: "not a domain", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" })).toBeNull();
  });

  it("classifies addresses", () => {
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
    expect(isLocalSupabaseUrl("garbage")).toBe(false);
    expect(isLocalSupabaseUrl("https://x.supabase.co")).toBe(false);
  });
});
