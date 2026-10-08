import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
test("Redefinição administrativa exige autenticação e perfil ativo no servidor", async (t) => {
  let handler;
  const calls = [];
  let role = "admin",
    active = true,
    valid = true,
    targetExists = true;
  const targetId = "00000000-0000-4000-8000-000000000002";
  globalThis.__passwordDeno = {
    env: {
      get: (key) =>
        ({
          SUPABASE_URL: "https://example.test",
          SUPABASE_ANON_KEY: "public-test",
          SUPABASE_SERVICE_ROLE_KEY: "service-test",
          ALLOWED_ORIGINS: "https://gabproti.github.io",
        })[key],
    },
    serve: (fn) => {
      handler = fn;
    },
  };
  globalThis.__passwordCreateClient = (_url, key) => {
    if (key === "service-test")
      return {
        auth: {
          admin: {
            updateUserById: async (id, values) => {
              calls.push({ id, values });
              return { data: { user: { id } }, error: null };
            },
          },
        },
      };
    return {
      auth: {
        getUser: async () =>
          valid
            ? { data: { user: { id: "caller" } }, error: null }
            : { data: { user: null }, error: { message: "invalid" } },
      },
      from: () => ({
        select: (fields) => ({
          eq: () => ({
            single: async () =>
              fields === "role,active"
                ? { data: { role, active }, error: null }
                : targetExists
                  ? { data: { id: targetId }, error: null }
                  : { data: null, error: { message: "missing" } },
          }),
        }),
      }),
    };
  };
  try {
    let source = await readFile(
      new URL("../supabase/functions/admin-users/index.ts", import.meta.url),
      "utf8",
    );
    source = source.replace(
      /^import \{ createClient \} from [^;]+;/,
      "const createClient = globalThis.__passwordCreateClient; const Deno = globalThis.__passwordDeno;",
    );
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    await import(
      "data:text/javascript;base64," + Buffer.from(js).toString("base64")
    );
    const body = {
      action: "reset-password",
      user_id: targetId,
      password: "NovaSenha123456",
      role: "admin",
      active: true,
      email: "ignored@test",
    };
    const invoke = (
      data = body,
      bearer = true,
      origin = "https://gabproti.github.io",
    ) =>
      handler(
        new Request("https://example.test/functions/v1/admin-users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...(bearer ? { Authorization: "Bearer fake-test-session" } : {}),
          },
          body: JSON.stringify(data),
        }),
      );
    await t.test(
      "Bloqueia anônimo, sessão inválida, operador, inativo e origem externa",
      async () => {
        assert.equal((await invoke(body, false)).status, 401);
        valid = false;
        assert.equal((await invoke()).status, 401);
        valid = true;
        role = "operator";
        assert.equal((await invoke()).status, 403);
        role = "admin";
        active = false;
        assert.equal((await invoke()).status, 403);
        active = true;
        assert.equal(
          (await invoke(body, true, "https://outside.test")).status,
          403,
        );
        assert.equal(calls.length, 0);
      },
    );
    await t.test(
      "Rejeita alvo inválido, senha fora dos limites e usuário inexistente",
      async () => {
        for (const data of [
          { ...body, user_id: "invalid" },
          { ...body, password: "curta" },
          { ...body, password: "x".repeat(129) },
          { ...body, action: "unknown" },
        ])
          assert.equal((await invoke(data)).status, 400);
        targetExists = false;
        assert.equal((await invoke()).status, 404);
        targetExists = true;
        assert.equal(calls.length, 0);
      },
    );
    await t.test(
      "Atualiza somente a senha do alvo confirmado, preservando permissões e status",
      async () => {
        const response = await invoke();
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        assert.deepEqual(calls, [
          { id: targetId, values: { password: "NovaSenha123456" } },
        ]);
      },
    );
  } finally {
    delete globalThis.__passwordDeno;
    delete globalThis.__passwordCreateClient;
  }
});
