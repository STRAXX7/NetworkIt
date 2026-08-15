// supabase/functions/delete-account/index.ts
//
// Why this exists: the anon/publishable key a browser holds can
// never be trusted to delete an auth.users row (that's the entire
// account, not just a profile row) — that requires the service_role
// key, which must never reach the client. This Edge Function is the
// only place that key is used, and it does exactly one thing: verify
// the caller's own JWT, then delete that same user's auth account.
//
// Deleting auth.users cascades to public.profiles (FK ON DELETE
// CASCADE), which cascades to privacy_settings, saved_profiles,
// conversations, messages, reports — the whole graph is cleaned up
// in one call.
//
// Deploy: supabase functions deploy delete-account
// Call from client: supabase.functions.invoke('delete-account')
//   (the user's session JWT is sent automatically as the
//   Authorization header by supabase-js)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

  // Client authenticated as the calling user — used ONLY to verify
  // who they are, never to perform the delete.
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401 });
  }

  // Admin client — service_role, never exposed to the browser.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteErr) {
    console.error("delete-account failed", deleteErr);
    return new Response(JSON.stringify({ error: "Failed to delete account" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
