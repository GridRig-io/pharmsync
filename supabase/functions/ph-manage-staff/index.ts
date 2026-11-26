// PharmSync · ph-manage-staff
// Lets the pharmacy admin create staff accounts, add an existing login (for
// example someone who already uses LabSync) and reset passwords, without
// exposing the service-role key to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "pharmacist", "inventory_officer", "sales"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from("ph_staff").select("pharmacy_id, role, is_active").eq("id", user.id).single();
  if (!me || !me.is_active || me.role !== "admin") {
    return json({ error: "Only the pharmacy admin can manage staff accounts" }, 403);
  }

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const role = ROLES.includes(body.role) ? body.role : "sales";

  const addToPharmacy = async (id: string, email: string, fullName: string) => {
    const { data: existing } = await admin.from("ph_staff").select("pharmacy_id").eq("id", id).maybeSingle();
    if (existing) {
      return existing.pharmacy_id === me.pharmacy_id
        ? json({ error: "This person is already on your staff" }, 400)
        : json({ error: "This login belongs to another pharmacy" }, 400);
    }
    const { error } = await admin.from("ph_staff").insert({
      id, pharmacy_id: me.pharmacy_id, email, full_name: fullName, role,
      pcn_reg_no: body.pcn_reg_no || null,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ id });
  };

  if (body.action === "create") {
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const fullName = (body.full_name || email.split("@")[0]).trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);

    // The login may already exist (e.g. someone who uses LabSync): add it to this pharmacy
    for (let page = 1; page <= 20; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const found = list?.users.find((u) => u.email?.toLowerCase() === email);
      if (found) return addToPharmacy(found.id, email, fullName);
      if (!list || list.users.length < 200) break;
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error) return json({ error: error.message }, 400);
    return addToPharmacy(data.user.id, email, fullName);
  }

  if (body.action === "reset_password") {
    const password = body.password ?? "";
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { data: target } = await admin.from("ph_staff").select("pharmacy_id").eq("id", body.user_id).single();
    if (!target || target.pharmacy_id !== me.pharmacy_id) return json({ error: "Not on your staff" }, 404);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
