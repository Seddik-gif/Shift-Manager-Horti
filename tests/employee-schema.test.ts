import { describe, expect, it } from "vitest";
import { employeeSchema, employeeUpdateSchema } from "@/lib/validation/employee";
import it_ from "../messages/it.json";
import en from "../messages/en.json";

const valid = {
  firstName: "Marco", lastName: "Rossi", email: "marco@example.com", phone: "+39 333 123 4567",
  jobPosition: "Barista", color: "#234A49", preferredLanguage: "it" as const,
};

describe("employee validation", () => {
  it("accepts a complete profile and trims whitespace", () => {
    const r = employeeSchema.parse({ ...valid, firstName: "  Marco " });
    expect(r.firstName).toBe("Marco");
  });

  it("allows empty optional phone and job position", () => {
    expect(employeeSchema.safeParse({ ...valid, phone: "", jobPosition: "" }).success).toBe(true);
  });

  it("rejects bad email, phone, colour and language", () => {
    expect(employeeSchema.safeParse({ ...valid, email: "x" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, phone: "abc" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, color: "red" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, preferredLanguage: "fr" }).success).toBe(false);
  });

  it("requires first and last name", () => {
    expect(employeeSchema.safeParse({ ...valid, firstName: " " }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, lastName: "" }).success).toBe(false);
  });

  it("update schema ignores the email field (cannot be changed)", () => {
    const r = employeeUpdateSchema.parse({ ...valid, email: "other@example.com" });
    expect(r).not.toHaveProperty("email");
  });

  it("every validation message has an Italian and English translation", () => {
    const emitted = new Set<string>();
    for (const bad of [{ ...valid, firstName: "", lastName: "", email: "" }, { ...valid, phone: "abc", color: "x", email: "x", firstName: "a".repeat(80) }]) {
      const r = employeeSchema.safeParse(bad);
      if (!r.success) r.error.issues.forEach((i) => emitted.add(i.message));
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const key of emitted) {
      expect(it_.validation).toHaveProperty(key);
      expect(en.validation).toHaveProperty(key);
    }
  });
});
