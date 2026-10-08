import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Exclusões administrativas preservam referências e respeitam RLS", async (t) => {
  const pg = new PGlite();
  const admin = "00000000-0000-4000-8000-000000000001",
    operator = "00000000-0000-4000-8000-000000000002",
    disabled = "00000000-0000-4000-8000-000000000003";
  await pg.exec(`create role anon;create role authenticated;
 create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const name of [
    "202610010001_initial.sql",
    "202610070001_kit_import.sql",
    "202610070002_optional_description.sql",
    "202610070003_component_types.sql",
    "202610080001_product_deletion.sql",
  ])
    await pg.exec(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  await pg.query(
    "insert into auth.users(id,email) values($1,'admin@test'),($2,'operator@test'),($3,'disabled@test')",
    [admin, operator, disabled],
  );
  await pg.query(
    "update public.profiles set role='admin',active=true where id=$1",
    [admin],
  );
  await pg.query("update public.profiles set active=true where id=$1", [
    operator,
  ]);
  async function as(id, sql, params = []) {
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? "",
    ]);
    await pg.exec(id ? "set role authenticated" : "set role anon");
    try {
      return await pg.query(sql, params);
    } finally {
      await pg.exec("reset role");
    }
  }
  const product = (
    await pg.query(
      "insert into public.products(code,image_url) values('AT8020-03LN','exclusive.webp') returning id",
    )
  ).rows[0].id;
  const other = (
    await pg.query(
      "insert into public.products(code) values('OTHER') returning id",
    )
  ).rows[0].id;
  const components = (
    await pg.query(
      "insert into public.components(code) values('CAIXA'),('MANUAL'),('PULSEIRA') returning id",
    )
  ).rows;
  await as(admin, "select public.save_composition($1,$2::jsonb)", [
    product,
    JSON.stringify(
      components.map((c) => ({ component_id: c.id, quantity: 2 })),
    ),
  ]);
  await as(admin, "select public.save_composition($1,$2::jsonb)", [
    other,
    JSON.stringify([{ component_id: components[0].id, quantity: 5 }]),
  ]);
  await pg.exec(
    "insert into storage.objects(bucket_id,name) values('product-images','exclusive.webp')",
  );
  await as(operator, "select public.consult_kit('AT8020-03LN')");
  await t.test(
    "Operador, inativo e anônimo não podem excluir nem acessar a fila",
    async () => {
      for (const id of [operator, disabled, null])
        for (const [sql, params] of [
          ["select public.admin_product_delete_preview($1)", [product]],
          ["select public.admin_delete_product($1,now(),3)", [product]],
          [
            "select public.admin_delete_kit_link($1,$2)",
            [product, components[0].id],
          ],
          ["select public.admin_pending_image_cleanup()", []],
          ["select public.admin_finish_image_cleanup('exclusive.webp')", []],
        ])
          await assert.rejects(as(id, sql, params));
      await assert.rejects(
        as(admin, "delete from public.products where id=$1", [product]),
      );
      await assert.rejects(
        as(admin, "select * from private.image_cleanup_queue"),
      );
    },
  );
  await t.test(
    "Exclui apenas o vínculo escolhido; componente pode continuar em outro kit",
    async () => {
      await as(admin, "select public.admin_delete_kit_link($1,$2)", [
        product,
        components[0].id,
      ]);
      assert.equal(
        (
          await pg.query(
            "select count(*)::int n from public.compositions where product_id=$1",
            [product],
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await pg.query(
            "select quantity from public.compositions where product_id=$1",
            [other],
          )
        ).rows[0].quantity,
        5,
      );
      assert.equal(
        (await pg.query("select count(*)::int n from public.components"))
          .rows[0].n,
        3,
      );
      await assert.rejects(
        as(admin, "select public.admin_delete_kit_link($1,$2)", [
          product,
          components[0].id,
        ]),
      );
      await assert.rejects(
        pg.query("delete from public.components where id=$1", [
          components[1].id,
        ]),
      );
    },
  );
  const preview = async (id) =>
    (
      await as(admin, "select public.admin_product_delete_preview($1) as p", [
        id,
      ])
    ).rows[0].p;
  await t.test(
    "Prévia alterada impede exclusão; exclusão preserva componentes e histórico",
    async () => {
      const old = await preview(product);
      assert.equal(old.links, 2);
      assert.equal(old.image_shared, false);
      await assert.rejects(
        as(admin, "select public.admin_delete_product($1,$2,$3)", [
          product,
          old.updated_at,
          3,
        ]),
      );
      await pg.query(
        "update public.products set description='mudou' where id=$1",
        [product],
      );
      await assert.rejects(
        as(admin, "select public.admin_delete_product($1,$2,$3)", [
          product,
          old.updated_at,
          2,
        ]),
      );
      const current = await preview(product);
      await as(admin, "select public.admin_delete_product($1,$2,$3)", [
        product,
        current.updated_at,
        current.links,
      ]);
      assert.equal(
        (
          await pg.query("select id from public.products where id=$1", [
            product,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await pg.query(
            "select id from public.compositions where product_id=$1",
            [product],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await pg.query("select count(*)::int n from public.components"))
          .rows[0].n,
        3,
      );
      assert.equal(
        (
          await pg.query(
            "select quantity from public.compositions where product_id=$1",
            [other],
          )
        ).rows[0].quantity,
        5,
      );
      assert.deepEqual(
        (
          await pg.query(
            "select product_id,product_code from public.consultation_history",
          )
        ).rows,
        [{ product_id: null, product_code: "AT8020-03LN" }],
      );
    },
  );
  await t.test(
    "Fila persiste até remover a foto com as permissões do Storage",
    async () => {
      assert.deepEqual(
        (await as(admin, "select public.admin_pending_image_cleanup() as p"))
          .rows[0].p,
        ["exclusive.webp"],
      );
      assert.equal(
        (
          await as(
            admin,
            "select public.admin_finish_image_cleanup('exclusive.webp') as done",
          )
        ).rows[0].done,
        false,
      );
      await as(
        operator,
        "delete from storage.objects where name='exclusive.webp'",
      );
      assert.equal(
        (
          await pg.query(
            "select name from storage.objects where name='exclusive.webp'",
          )
        ).rows.length,
        1,
      );
      // Simulate the Storage API's DELETE under the same RLS permissions.
      await as(
        admin,
        "delete from storage.objects where name='exclusive.webp'",
      );
      assert.equal(
        (
          await as(
            admin,
            "select public.admin_finish_image_cleanup('exclusive.webp') as done",
          )
        ).rows[0].done,
        true,
      );
      assert.deepEqual(
        (await as(admin, "select public.admin_pending_image_cleanup() as p"))
          .rows[0].p,
        [],
      );
    },
  );
  await t.test(
    "Imagem compartilhada com componente ou outro produto é preservada",
    async () => {
      await pg.query(
        "update public.products set image_url='shared.webp' where id=$1",
        [other],
      );
      await pg.query(
        "update public.components set image_url='shared.webp' where id=$1",
        [components[0].id],
      );
      await pg.exec(
        "insert into storage.objects(bucket_id,name) values('product-images','shared.webp')",
      );
      const p = await preview(other);
      assert.equal(p.image_shared, true);
      await as(admin, "select public.admin_delete_product($1,$2,$3)", [
        other,
        p.updated_at,
        p.links,
      ]);
      await as(admin, "delete from storage.objects where name='shared.webp'");
      assert.equal(
        (
          await pg.query(
            "select name from storage.objects where name='shared.webp'",
          )
        ).rows.length,
        1,
      );
      assert.deepEqual(
        (await as(admin, "select public.admin_pending_image_cleanup() as p"))
          .rows[0].p,
        [],
      );
      await pg.exec(
        "insert into private.image_cleanup_queue(path) values('shared.webp')",
      );
      assert.equal(
        (
          await as(
            admin,
            "select public.admin_finish_image_cleanup('shared.webp') as done",
          )
        ).rows[0].done,
        true,
      );
      assert.equal(
        (
          await pg.query(
            "select name from storage.objects where name='shared.webp'",
          )
        ).rows.length,
        1,
      );
    },
  );
  await pg.close();
});
