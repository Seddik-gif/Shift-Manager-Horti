import { describe, expect, it } from "vitest";
import { newForToast } from "@/lib/notifications/ingest";

const NOW = Date.parse("2026-11-09T14:00:00Z");
const n = (id: string, ageSec: number, read = false) => ({
  id, read_at: read ? "x" : null, created_at: new Date(NOW - ageSec * 1000).toISOString(),
});

describe("which notifications pop up", () => {
  it("never pops up for what was already there on the first load", () => {
    const seen = new Set<string>();
    expect(newForToast([n("a", 5), n("b", 3600)], seen, true, NOW)).toEqual([]);
    expect([...seen].sort()).toEqual(["a", "b"]);
  });

  it("pops up for new unread notifications found later (a missed realtime event or a poll)", () => {
    const seen = new Set(["a"]);
    const out = newForToast([n("c", 2), n("b", 10), n("a", 100)], seen, false, NOW);
    expect(out.map((x) => x.id)).toEqual(["b", "c"]); // oldest first
  });

  it("does not pop up twice for the same notification", () => {
    const seen = new Set<string>();
    newForToast([n("a", 1)], seen, true, NOW);
    const list = [n("a", 1), n("b", 1)];
    expect(newForToast(list, seen, false, NOW).map((x) => x.id)).toEqual(["b"]);
    expect(newForToast(list, seen, false, NOW)).toEqual([]);
  });

  it("ignores read and old notifications (e.g. after the laptop slept)", () => {
    const seen = new Set<string>();
    expect(newForToast([n("old", 3600), n("read", 5, true)], seen, false, NOW)).toEqual([]);
  });
});
