#!/usr/bin/env node
// Secure administrator provisioning. There is no public registration; admins are created here only.
//
//   node --env-file=.env.local scripts/provision-admin.mjs stefano@example.com Stefano
//   node --env-file=.env.local scripts/provision-admin.mjs tessa@example.com Tessa
//
// No password is ever stored or printed: Supabase emails an invitation link and the admin
// chooses their own password. Requires SUPABASE_SERVICE_ROLE_KEY (run locally, never in the browser).
import { createClient } from "@supabase/supabase-js";

const [email, firstName] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !firstName) {
  console.error("Usage: provision-admin.mjs <email> <firstName>");
  process.exit(1);
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (load .env.local).");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
  data: { first_name: firstName, preferred_language: "it" },
  redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/confirm`,
});
if (inviteError) {
  console.error("Invitation failed:", inviteError.message);
  process.exit(1);
}

// The sign-up trigger always creates an 'employee'; promote explicitly with the service role.
const { error: roleError } = await supabase
  .from("profiles")
  .update({ role: "admin" })
  .eq("id", invited.user.id);
if (roleError) {
  console.error("User invited but promotion to admin failed:", roleError.message);
  process.exit(1);
}

await supabase.from("audit_logs").insert({
  actor_id: null,
  action: "admin.provisioned",
  entity_type: "profile",
  entity_id: invited.user.id,
  changes: { email, via: "scripts/provision-admin.mjs" },
});

console.log(`Admin invitation sent to ${email}.`);
