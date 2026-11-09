import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";

// The app embeds related tables through the API (PostgREST), which needs a DIRECT foreign key for each embed.
// These are the embeds the pages rely on; a missing one makes a page silently show no data.
const EMBEDS: [string, string, string][] = [
  ["availability_submissions", "availability_time_windows", "submission_id"],
  ["availability_submissions", "availability_days", "submission_id"],
  ["availability_requests", "availability_submissions", "request_id"],
  ["weekly_schedules", "shifts", "schedule_id"],
  ["profiles", "shifts", "employee_id"],
  ["profiles", "shift_requests", "employee_id"],
  ["profiles", "whatsapp_shares", "confirmed_by"],
  ["profiles", "schedule_versions", "published_by"],
];

let db: PGlite;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("foreign keys behind API embeds", () => {
  for (const [parent, child, column] of EMBEDS) {
    it(`${child}.${column} references ${parent}`, async () => {
      const { rows } = await db.query(
        `select 1 from pg_constraint c
           join pg_class t on t.oid = c.conrelid join pg_class p on p.oid = c.confrelid
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and t.relname = $1 and p.relname = $2 and a.attname = $3 and array_length(c.conkey, 1) = 1`,
        [child, parent, column],
      );
      expect(rows).toHaveLength(1);
    });
  }
});
