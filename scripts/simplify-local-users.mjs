#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY: gives every account in the local Supabase stack a short login ("marco" -> marco@horti.test)
// and the test password "horti" (written directly into the local database). Refuses to run against anything that is not local/private.
//   node --env-file=.env.local scripts/simplify-local-users.mjs
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isLocalSupabaseUrl } from "../src/lib/auth/login-id.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.LOGIN_ID_DOMAIN || "horti.test";
const PASSWORD = "horti";
if (!url || !key) throw new Error("Load .env.local first (node --env-file=.env.local ...)");
if (!isLocalSupabaseUrl(url)) throw new Error(`Refusing to change accounts on a non-local project: ${url}`);

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: profiles, error } = await supabase.from("profiles").select("id, first_name, role");
if (error) throw error;

const seen = new Set();
const accounts = {};
for (const p of profiles) {
  let id = p.first_name.toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "");
  if (!id || seen.has(id)) id = `${id || "user"}${seen.size + 1}`; // two people with the same first name stay distinct
  seen.add(id);
  const email = `${id}@${DOMAIN}`;
  const { error: e } = await supabase.auth.admin.updateUserById(p.id, { email, email_confirm: true });
  if (e) throw new Error(`${id}: ${e.message}`);
  const { error: e2 } = await supabase.from("profiles").update({ email }).eq("id", p.id);
  if (e2) throw new Error(`${id} (profile): ${e2.message}`);
  accounts[email] = { role: p.role, id, password: PASSWORD };
}
// Supabase Auth refuses passwords under 6 characters through its API, so the test password is written straight into
// the local database (bcrypt, same as Auth does). Sign-in itself has no length rule.
const container = process.env.SUPABASE_DB_CONTAINER || "supabase_db_horti-magici";
const sql = `update auth.users set encrypted_password = crypt('${PASSWORD}', gen_salt('bf', 10)) where email like '%@${DOMAIN}';`;
const run = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
if (run.status !== 0) throw new Error(`Could not set the test password: ${run.stderr || run.error}`);
writeFileSync(".local-test-accounts.json", JSON.stringify(accounts, null, 2));
console.log(`Updated ${profiles.length} accounts: sign in with the name (e.g. "${Object.values(accounts)[0].id}") and the password "${PASSWORD}".`);
