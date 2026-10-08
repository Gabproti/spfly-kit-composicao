import { createClient } from "npm:@supabase/supabase-js@2.117.2";
const url = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.includes(origin))
    return new Response("Origem não permitida", { status: 403 });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return reply({ error: "Método não permitido." }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer "))
    return reply({ error: "Autenticação necessária." }, 401);
  const token = auth.slice(7);
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(token);
  if (authError || !user) return reply({ error: "Sessão inválida." }, 401);
  const { data: profile, error: profileError } = await caller
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .single();
  if (profileError || !profile?.active || profile.role !== "admin")
    return reply({ error: "Acesso administrativo necessário." }, 403);
  try {
    const body = await req.json();
    if (body.action === "reset-password") {
      if (
        typeof body.user_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.user_id,
        ) ||
        typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128
      )
        return reply(
          {
            error:
              "Informe um usuário válido e uma senha entre 12 e 128 caracteres.",
          },
          400,
        );
      const target = await caller
        .from("profiles")
        .select("id")
        .eq("id", body.user_id)
        .single();
      if (target.error || !target.data)
        return reply({ error: "Usuário não encontrado." }, 404);
      const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const updated = await admin.auth.admin.updateUserById(body.user_id, {
        password: body.password,
      });
      if (updated.error || !updated.data.user)
        return reply(
          {
            error:
              "Não foi possível redefinir a senha. Confira os requisitos da senha.",
          },
          400,
        );
      return reply({ success: true });
    }
    if (body.action && body.action !== "create-user")
      return reply({ error: "Operação inválida." }, 400);
    if (
      typeof body.name !== "string" ||
      body.name.trim().length < 1 ||
      body.name.trim().length > 120 ||
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128 ||
      !["admin", "operator"].includes(body.role)
    )
      return reply(
        {
          error:
            "Revise nome, e-mail, perfil e senha de pelo menos 12 caracteres.",
        },
        400,
      );
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email.trim(),
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.name.trim() },
    });
    if (error || !data.user)
      return reply(
        {
          error:
            "Não foi possível criar o usuário. Confira o e-mail e os requisitos de senha.",
        },
        400,
      );
    // Mesmo com a service key disponível, a ativação acontece como o administrador
    // autenticado: a RPC revalida seu perfil e serializa alterações de permissão.
    const { error: activationError } = await caller.rpc("admin_set_profile", {
      p_id: data.user.id,
      p_name: body.name.trim(),
      p_role: body.role,
      p_active: true,
    });
    if (activationError) {
      // O trigger criou o perfil inativo; nenhuma permissão é concedida em caso de erro.
      await admin.from("profiles").delete().eq("id", data.user.id);
      await admin.auth.admin.deleteUser(data.user.id);
      return reply(
        { error: "Não foi possível ativar o usuário. Tente novamente." },
        400,
      );
    }
    return reply({ id: data.user.id }, 201);
  } catch {
    return reply({ error: "Não foi possível processar o cadastro." }, 400);
  }
});
