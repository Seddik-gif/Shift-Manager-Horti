import { describe, expect, it } from "vitest";
import it_ from "../messages/it.json";
import en from "../messages/en.json";
import { loginSchema, setPasswordSchema } from "@/lib/validation/auth";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("translations", () => {
  it("Italian and English define exactly the same keys", () => {
    expect(keys(it_).sort()).toEqual(keys(en).sort());
  });

  it("has no empty strings", () => {
    for (const messages of [it_, en]) {
      const flat = keys(messages);
      expect(flat.length).toBeGreaterThan(0);
    }
    const values = (o: Record<string, unknown>): string[] =>
      Object.values(o).flatMap((v) => (v && typeof v === "object" ? values(v as Record<string, unknown>) : [String(v)]));
    expect(values(it_).every((s) => s.trim().length > 0)).toBe(true);
    expect(values(en).every((s) => s.trim().length > 0)).toBe(true);
  });

  it("every validation message emitted by the schemas exists in both languages", () => {
    const emitted = new Set<string>();
    for (const r of [
      loginSchema.safeParse({ email: "", password: "" }),
      loginSchema.safeParse({ email: "nope", password: "x" }),
      setPasswordSchema.safeParse({ password: "short", confirm: "other" }),
    ]) {
      if (!r.success) r.error.issues.forEach((i) => emitted.add(i.message));
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const key of emitted) {
      expect(it_.validation).toHaveProperty(key);
      expect(en.validation).toHaveProperty(key);
    }
  });
});
