import { describe, expect, it } from "vitest";
import * as b from "../scripts/lib/backup-utils.mjs";
import { AREAS, actionKey, areaOf, detailParts, patternsFor, personIds, type Resolvers } from "@/lib/audit/format";
import itMessages from "../messages/it.json";
import enMessages from "../messages/en.json";

describe("backup file handling", () => {
  it("names files by UTC time so they sort chronologically", () => {
    expect(b.backupFileName(new Date("2026-11-09T23:14:59Z"))).toBe("horti-20261109-2314.dump");
    expect(b.backupFileName(new Date("2027-01-02T03:04:00Z")) > b.backupFileName(new Date("2026-12-31T23:59:00Z"))).toBe(true);
  });

  it("keeps the newest N and never touches files it did not create", () => {
    const files = ["horti-20261101-0200.dump", "horti-20261103-0200.dump", "horti-20261102-0200.dump", "notes.txt", "horti-bad.dump", "family-photo.dump"];
    expect(b.selectToDelete(files, 2)).toEqual(["horti-20261101-0200.dump"]);
    expect(b.selectToDelete(files, 10)).toEqual([]);
    expect(b.selectToDelete(files, 0)).toHaveLength(2); // never deletes the last remaining backup
  });
});

describe("connection strings", () => {
  const url = "postgresql://postgres:p%40ss%3Aw0rd@db.abc.supabase.co:5432/postgres";
  it("hides the password when printing", () => {
    expect(b.maskUrl(url)).not.toContain("w0rd");
    expect(b.maskUrl(url)).toContain("****");
    expect(b.maskUrl("not a url")).toBe("(invalid connection string)");
  });

  it("moves the password out of the URL so it never appears on a command line", () => {
    const s = b.splitUrl(url);
    expect(s.password).toBe("p@ss:w0rd");
    expect(s.url).not.toContain("w0rd");
    expect(s.url).toContain("postgres@db.abc.supabase.co");
    expect(() => b.splitUrl("mysql://x:y@h/db")).toThrow(/postgres/);
  });

  it("points at another database on the same server", () => {
    expect(b.withDatabase("postgresql://u@localhost:5432/postgres", "horti_restore_x")).toBe("postgresql://u@localhost:5432/horti_restore_x");
  });

  it("only lets plain identifiers into SQL", () => {
    expect(b.safeDbName("horti_restore_1a2b")).toBe("horti_restore_1a2b");
    for (const bad of ["x; drop database postgres", "Robert'); --", "UPPER", "1abc", "", "a b"]) expect(() => b.safeDbName(bad)).toThrow();
    expect(b.tempDbName()).toMatch(/^horti_restore_[a-z0-9]+$/);
  });
});

describe("restore verdict", () => {
  const full = b.KEY_TABLES.map((table: string) => ({ table, rows: 3 }));
  it("passes when the key tables are there with people", () => {
    expect(b.judgeRestore(full, 0)).toMatchObject({ ok: true, problems: [] });
    expect(b.judgeRestore(full, 12).ok).toBe(true); // harmless Supabase-specific noise does not fail it
  });

  it("fails when a table is missing or nobody was restored", () => {
    const noShifts = full.map((c: { table: string; rows: number }) => (c.table === "shifts" ? { ...c, rows: null } : c));
    expect(b.judgeRestore(noShifts, 0).problems.join()).toContain("shifts");
    const noPeople = full.map((c: { table: string; rows: number }) => (c.table === "profiles" ? { ...c, rows: 0 } : c));
    expect(b.judgeRestore(noPeople, 0)).toMatchObject({ ok: false });
    expect(b.judgeRestore([], 0).ok).toBe(false);
  });
});

describe("activity log helpers", () => {
  const r: Resolvers = {
    person: (id) => ({ m: "Marco", g: "Giulia" })[id] ?? "?",
    location: (id) => (id === "l1" ? "Lido" : "?"),
    range: (a, b) => `${a.slice(11, 16)}–${b.slice(11, 16)}`,
    date: (d) => d,
  };
  const U = "00000000-0000-4000-8000-0000000000";

  it("groups actions into areas", () => {
    expect(areaOf("shift.created")).toBe("shifts");
    expect(areaOf("swap.rejected")).toBe("shifts");
    expect(areaOf("schedule.published")).toBe("schedule");
    expect(areaOf("absence.approved")).toBe("requests");
    expect(areaOf("availability.confirmed")).toBe("requests");
    expect(areaOf("location.created")).toBe("people");
    expect(areaOf("settings.rules_changed")).toBe("settings");
    expect(areaOf("chat.purged")).toBe("chat");
    expect(areaOf("something.new")).toBe("other");
  });

  it("filters by pattern, and 'all' means no filter", () => {
    expect(patternsFor("all")).toEqual([]);
    expect(patternsFor("shifts")).toEqual(["shift.%", "open_shift.%", "swap.%"]);
  });

  it("describes entries in one readable line without throwing on odd data", () => {
    expect(detailParts("shift.created", { employee_id: "m", starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T14:00:00Z", location_id: "l1" }, r))
      .toEqual(["Marco", "10:00–14:00", "Lido"]);
    expect(detailParts("shift.swapped", { from: "m", to: "g", starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T14:00:00Z" }, r)).toEqual(["Marco → Giulia", "10:00–14:00"]);
    expect(detailParts("shift.updated", { from: { employee_id: "m" }, to: { employee_id: "g", starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T11:00:00Z" } }, r)).toEqual(["Marco → Giulia", "10:00–11:00"]);
    expect(detailParts("schedule.published", { week_start: "2030-01-07", version: 2, shifts: 14 }, r)).toEqual(["2030-01-07", "v2", "14"]);
    expect(detailParts("absence.approved", { employee_id: "g", start_date: "2030-02-01", end_date: "2030-02-05", conflicting_shifts: 2 }, r)).toEqual(["Giulia", "2030-02-01 – 2030-02-05", "⚠ 2"]);
    expect(detailParts("x.y", { note: "ok", reason: "absence" }, r)).toEqual(["absence", "“ok”"]);
    expect(detailParts("x.y", {}, r)).toEqual([]);
    expect(detailParts("shift.updated", { from: 5, to: "bad" } as never, r)).toEqual([]);
  });

  it("collects every person to look up, once", () => {
    expect(personIds({ employee_id: `${U}01`, from: `${U}02`, to: `${U}01`, note: "x" }).sort()).toEqual([`${U}01`, `${U}02`]);
    expect(personIds({ from: { employee_id: `${U}03` }, to: { employee_id: "not-a-uuid" } })).toEqual([`${U}03`]);
  });

  it("has a label in both languages for every action the database writes", () => {
    const actions = ["absence.approved", "absence.rejected", "availability.changes_requested", "availability.confirmed", "availability_request.closed", "availability_request.created",
      "availability_request.opened", "chat.purged", "employee.locations_changed", "location.archived", "location.created", "location.deleted", "location.restored", "location.updated",
      "open_shift.cancelled", "open_shift.created", "schedule.published", "schedule.republished", "settings.chat_options_changed", "settings.rules_changed",
      "settings.swap_options_changed", "shift.availability_override", "shift.created", "shift.deleted", "shift.swapped", "shift.updated", "shift_request.approved",
      "shift_request.rejected", "swap.rejected", "whatsapp.share_confirmed"];
    for (const a of actions) {
      expect((itMessages.audit.actions as Record<string, string>)[actionKey(a)], `it:${a}`).toBeTruthy();
      expect((enMessages.audit.actions as Record<string, string>)[actionKey(a)], `en:${a}`).toBeTruthy();
    }
    for (const a of AREAS) {
      expect((itMessages.audit.area as Record<string, string>)[a]).toBeTruthy();
      expect((enMessages.audit.area as Record<string, string>)[a]).toBeTruthy();
    }
  });
});
