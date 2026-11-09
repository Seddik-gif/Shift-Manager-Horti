#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY: creates test accounts in the local Supabase stack so the app can be tried by hand.
//   node --env-file=.env.local scripts/seed-local.mjs
// Passwords are random and written to .local-test-accounts.json (git-ignored), never printed.
// Refuses to run against anything that is not localhost.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Load .env.local first (node --env-file=.env.local ...)");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) throw new Error(`Refusing to seed a non-local project: ${url}`);

const FILE = ".local-test-accounts.json";
const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};

const people = [
  { first: "Stefano", last: "Admin", role: "admin", color: "#234A49" },
  { first: "Tessa", last: "Admin", role: "admin", color: "#7A3E65" },
  { first: "Marco", last: "Rossi", role: "employee", color: "#B5651D", position: "Barista" },
  { first: "Giulia", last: "Bianchi", role: "employee", color: "#2F6DB5", position: "Sala" },
  { first: "Luca", last: "Verdi", role: "employee", color: "#6B8E23", position: "Barista" },
];

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 });

for (const p of people) {
  const email = `${p.first.toLowerCase()}@horti.test`;
  let user = existing?.users.find((u) => u.email === email);
  if (!user) {
    const password = saved[email]?.password ?? randomBytes(12).toString("base64url");
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name: p.first, last_name: p.last, color: p.color, job_position: p.position ?? "", preferred_language: "it" },
    });
    if (error) throw error;
    user = data.user;
    saved[email] = { role: p.role, password };
  }
  if (p.role === "admin") {
    const { error } = await supabase.from("profiles").update({ role: "admin" }).eq("id", user.id);
    if (error) throw error;
  }
  saved[email] ??= { role: p.role, password: "(existing account – password unchanged)" };
}
writeFileSync(FILE, JSON.stringify(saved, null, 2));
console.log(`Seeded ${people.length} local test accounts. Credentials are in ${FILE}`);
