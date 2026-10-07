import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Fluxo de kits e segurança RLS em PostgreSQL local", async (t) => {
  const pg = new PGlite();
  const admin = "00000000-0000-4000-8000-000000000001";
  const operator = "00000000-0000-4000-8000-000000000002";
  const disabled = "00000000-0000-4000-8000-000000000003";
  const outsider = "00000000-0000-4000-8000-000000000004";
  const product = "00000000-0000-4000-8000-000000000010";
  const component = "00000000-0000-4000-8000-000000000020";
  const idleComponent = "00000000-0000-4000-8000-000000000021";
  await pg.exec(`create role anon;create role authenticated;
 create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
  await pg.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610010001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.query(
    `insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@example.test','{"name":"Admin"}'),($2,'operator@example.test','{"name":"Operador"}'),($3,'disabled@example.test','{}'),($4,'outsider@example.test','{"role":"admin","active":true}')`,
    [admin, operator, disabled, outsider],
  );
  await pg.query(
    `update public.profiles set role='admin',active=true where id=$1;`,
    [admin],
  );
  await pg.query(`update public.profiles set active=true where id=$1`, [
    operator,
  ]);
  await pg.query(
    `insert into public.products(id,code,description,image_url) values($1,'00123','Relógio de teste','product.webp')`,
    [product],
  );
  await pg.query(
    `insert into public.components(id,code,type,description) values($1,'0001','Caixa','Caixa teste'),($2,'0002','Fecho','Componente fora do kit')`,
    [component, idleComponent],
  );
  await pg.exec(
    `insert into storage.objects(bucket_id,name) values('product-images','product.webp'),('product-images','orphan.webp');`,
  );
  async function as(id, action) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? "",
    ]);
    await pg.exec(id ? "set role authenticated" : "set role anon");
    try {
      return await action();
    } finally {
      await pg.exec("reset role");
    }
  }
  await t.test(
    "Trigger ignora role/admin em metadados não confiáveis",
    async () => {
      const r = await pg.query(
        "select role,active from public.profiles where id=$1",
        [outsider],
      );
      assert.deepEqual(r.rows[0], { role: "operator", active: false });
    },
  );
  await t.test(
    "Admin salva composição e rejeita duplicados com rollback",
    async () => {
      await as(admin, () =>
        pg.query("select public.save_composition($1,$2::jsonb)", [
          product,
          JSON.stringify([{ component_id: component, quantity: 2 }]),
        ]),
      );
      await assert.rejects(
        as(admin, () =>
          pg.query("select public.save_composition($1,$2::jsonb)", [
            product,
            JSON.stringify([
              { component_id: component, quantity: 1 },
              { component_id: component, quantity: 3 },
            ]),
          ]),
        ),
      );
      const r = await pg.query(
        "select quantity from public.compositions where product_id=$1",
        [product],
      );
      assert.equal(r.rows[0].quantity, 2);
    },
  );
  await t.test(
    "Quantidades zero, fracionárias e nulas são rejeitadas",
    async () => {
      for (const quantity of [0, 1.5, null, 10000])
        await assert.rejects(
          as(admin, () =>
            pg.query("select public.save_composition($1,$2::jsonb)", [
              product,
              JSON.stringify([{ component_id: component, quantity }]),
            ]),
          ),
        );
    },
  );
  await t.test(
    "Operador consulta código com zeros e registra histórico atômico",
    async () => {
      const r = await as(operator, () =>
        pg.query("select public.consult_kit($1) as kit", ["00123"]),
      );
      assert.equal(r.rows[0].kit.product.code, "00123");
      assert.equal(r.rows[0].kit.items[0].quantity, 2);
      const h = await pg.query("select * from public.consultation_history");
      assert.equal(h.rows.length, 1);
      assert.equal(h.rows[0].user_id, operator);
    },
  );
  await t.test("Consulta inexistente não registra histórico", async () => {
    const r = await as(operator, () =>
      pg.query("select public.consult_kit('123') as kit"),
    );
    assert.equal(r.rows[0].kit, null);
    const h = await pg.query(
      "select count(*)::int as n from public.consultation_history",
    );
    assert.equal(h.rows[0].n, 1);
  });
  await t.test(
    "Operador não altera cadastros, perfis, composição ou histórico",
    async () => {
      for (const sql of [
        "insert into public.products(code,description) values('attack','Ataque')",
        "update public.profiles set role='admin'",
        "delete from public.compositions",
        "insert into public.consultation_history(user_id,product_id,product_code) values(auth.uid(),'00000000-0000-4000-8000-000000000010','forjado')",
        "delete from public.products",
      ])
        await assert.rejects(as(operator, () => pg.exec(sql)));
      // UPDATE possui grant, mas RLS restringe todas as linhas: nenhuma alteração ocorre.
      await as(operator, () =>
        pg.exec("update public.products set description='forjado'"),
      );
      await as(operator, () =>
        pg.exec("update public.components set active=false"),
      );
      const c = await pg.query(
        "select active from public.components where id=$1",
        [component],
      );
      assert.equal(c.rows[0].active, true);
      const p = await pg.query("select description from public.products");
      assert.equal(p.rows[0].description, "Relógio de teste");
      await assert.rejects(
        as(operator, () =>
          pg.query("select public.admin_set_profile($1,$2,$3,$4)", [
            operator,
            "Operador",
            "admin",
            true,
          ]),
        ),
      );
      await assert.rejects(
        as(operator, () =>
          pg.query("select public.save_composition($1,$2::jsonb)", [
            product,
            "[]",
          ]),
        ),
      );
      await assert.rejects(
        as(operator, () => pg.query("select public.dashboard_stats()")),
      );
    },
  );
  await t.test(
    "Operador vê apenas componentes relacionados, seu perfil e nenhum histórico",
    async () => {
      const c = await as(operator, () =>
        pg.query("select id from public.components"),
      );
      assert.deepEqual(c.rows, [{ id: component }]);
      const p = await as(operator, () =>
        pg.query("select id from public.profiles"),
      );
      assert.deepEqual(p.rows, [{ id: operator }]);
      const h = await as(operator, () =>
        pg.query("select * from public.consultation_history"),
      );
      assert.equal(h.rows.length, 0);
    },
  );
  await t.test(
    "Storage permite leitura autorizada e bloqueia upload e remoção pelo operador",
    async () => {
      const images = await as(operator, () =>
        pg.query("select name from storage.objects"),
      );
      assert.deepEqual(images.rows, [{ name: "product.webp" }]);
      await assert.rejects(
        as(operator, () =>
          pg.exec(
            "insert into storage.objects(bucket_id,name) values('product-images','attack.webp')",
          ),
        ),
      );
      await as(operator, () => pg.exec("delete from storage.objects"));
      const imagesAfter = await pg.query(
        "select count(*)::int as n from storage.objects",
      );
      assert.equal(imagesAfter.rows[0].n, 2);
    },
  );
  await t.test(
    "Inativo e anônimo não consultam nem leem produtos",
    async () => {
      const p = await as(disabled, () =>
        pg.query("select * from public.products"),
      );
      assert.equal(p.rows.length, 0);
      await assert.rejects(
        as(disabled, () => pg.query("select public.consult_kit('00123')")),
      );
      await assert.rejects(
        as(null, () => pg.query("select * from public.products")),
      );
      await assert.rejects(
        as(null, () => pg.query("select public.consult_kit('00123')")),
      );
    },
  );
  await t.test("Kit com componente inativo fica indisponível", async () => {
    await pg.query("update public.components set active=false where id=$1", [
      component,
    ]);
    const r = await as(operator, () =>
      pg.query("select public.consult_kit('00123') as kit"),
    );
    assert.equal(r.rows[0].kit, null);
    await pg.query("update public.components set active=true where id=$1", [
      component,
    ]);
  });
  await t.test(
    "Admin não remove seu próprio acesso nem apaga produto diretamente",
    async () => {
      await assert.rejects(
        as(admin, () =>
          pg.query("select public.admin_set_profile($1,$2,$3,$4)", [
            admin,
            "Admin",
            "operator",
            true,
          ]),
        ),
      );
      await assert.rejects(
        as(admin, () => pg.exec("delete from public.products")),
      );
      const r = await as(admin, () =>
        pg.query("select public.dashboard_stats() as stats"),
      );
      assert.equal(r.rows[0].stats.products, 1);
      assert.equal(r.rows[0].stats.compositions, 1);
    },
  );
  await t.test("Sem itens ou produto inativo não retorna kit", async () => {
    await as(admin, () =>
      pg.query("select public.save_composition($1,$2::jsonb)", [product, "[]"]),
    );
    let r = await as(operator, () =>
      pg.query("select public.consult_kit('00123') as kit"),
    );
    assert.equal(r.rows[0].kit, null);
    await pg.query("update public.products set active=false where id=$1", [
      product,
    ]);
    r = await as(operator, () => pg.query("select * from public.products"));
    assert.equal(r.rows.length, 0);
  });
  await pg.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610070001_kit_import.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.query("update public.products set active=true where id=$1", [
    product,
  ]);
  await t.test(
    "Importação incremental preserva quantidade, ordem e dados do cadastro",
    async () => {
      await as(admin, () =>
        pg.query("select public.save_composition($1,$2::jsonb)", [
          product,
          JSON.stringify([{ component_id: component, quantity: 7 }]),
        ]),
      );
      const before = await pg.query(
        "select * from public.products order by id",
      );
      const batch = [
        { product: " 00123 ", component: " 0001 " },
        { product: "00123", component: "0002" },
        { product: "00123", component: "0002" },
        { product: "ausente", component: "0001" },
        { product: "00123", component: "ausente" },
        { product: "", component: "0001" },
      ];
      const r = await as(admin, () =>
        pg.query("select public.import_kit_links($1::jsonb) as result", [
          JSON.stringify(batch),
        ]),
      );
      assert.deepEqual(
        r.rows[0].result.map((row) => row.status),
        [
          "existing",
          "inserted",
          "duplicate",
          "product_missing",
          "component_missing",
          "invalid",
        ],
      );
      const stored = await pg.query(
        "select component_id,quantity,position from public.compositions where product_id=$1 order by position",
        [product],
      );
      assert.deepEqual(stored.rows, [
        { component_id: component, quantity: 7, position: 0 },
        { component_id: idleComponent, quantity: 1, position: 1 },
      ]);
      const again = await as(admin, () =>
        pg.query("select public.import_kit_links($1::jsonb) as result", [
          JSON.stringify(batch),
        ]),
      );
      assert.equal(
        again.rows[0].result.filter((row) => row.status === "inserted").length,
        0,
      );
      assert.deepEqual(
        (await pg.query("select * from public.products order by id")).rows,
        before.rows,
      );
    },
  );
  await t.test(
    "Importação rejeita operador, inativo e anônimo, inclusive chamadas diretas",
    async () => {
      for (const id of [operator, disabled, null])
        await assert.rejects(
          as(id, () =>
            pg.query("select public.import_kit_links($1::jsonb)", ["[]"]),
          ),
        );
      await assert.rejects(
        as(admin, () =>
          pg.query("select public.import_kit_links($1::jsonb)", [
            JSON.stringify(
              Array(1001).fill({ product: "00123", component: "0001" }),
            ),
          ]),
        ),
      );
    },
  );
  await t.test(
    "Cadastro desativado após prévia é rejeitado no servidor",
    async () => {
      await pg.query("update public.components set active=false where id=$1", [
        idleComponent,
      ]);
      const r = await as(admin, () =>
        pg.query("select public.import_kit_links($1::jsonb) as result", [
          JSON.stringify([{ product: "00123", component: "0002" }]),
        ]),
      );
      assert.equal(r.rows[0].result[0].status, "inactive");
      await pg.query(
        "update public.components set active=true,image_url='component.webp' where id=$1",
        [idleComponent],
      );
      const kit = await as(operator, () =>
        pg.query("select public.consult_kit('00123') as kit"),
      );
      assert.equal(kit.rows[0].kit.items.length, 2);
      assert.equal(
        kit.rows[0].kit.items.find((item) => item.code === "0002").image_url,
        "component.webp",
      );
    },
  );
  await t.test(
    "Importação e consulta suportam mais de 300 componentes",
    async () => {
      await pg.exec(
        "insert into public.components(code,type,description) select 'LARGE-'||n,'Outros','Volume '||n from generate_series(1,350) n",
      );
      const payload = Array.from({ length: 350 }, (_, n) => ({
        product: "00123",
        component: `LARGE-${n + 1}`,
      }));
      const r = await as(admin, () =>
        pg.query("select public.import_kit_links($1::jsonb) as result", [
          JSON.stringify(payload),
        ]),
      );
      assert.equal(
        r.rows[0].result.filter((row) => row.status === "inserted").length,
        350,
      );
      const kit = await as(operator, () =>
        pg.query("select public.consult_kit('00123') as kit"),
      );
      assert.equal(kit.rows[0].kit.items.length, 352);
    },
  );
  await pg.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610070002_optional_description.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await t.test(
    "Produtos e componentes aceitam descrição vazia ou omitida, preservando o limite",
    async () => {
      await as(admin, () =>
        pg.exec(
          "insert into public.products(code) values('SEM-DESC'); insert into public.components(code,type,description) values('SEM-DESC','Outros','');",
        ),
      );
      assert.equal(
        (
          await pg.query(
            "select description from public.products where code='SEM-DESC'",
          )
        ).rows[0].description,
        "",
      );
      assert.equal(
        (
          await pg.query(
            "select description from public.components where code='SEM-DESC'",
          )
        ).rows[0].description,
        "",
      );
      await assert.rejects(
        as(admin, () =>
          pg.query(
            "insert into public.products(code,description) values('LONG',$1)",
            ["a".repeat(301)],
          ),
        ),
      );
      await assert.rejects(
        as(operator, () =>
          pg.exec("insert into public.products(code) values('FORBIDDEN')"),
        ),
      );
    },
  );
  await pg.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610070003_component_types.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await t.test(
    "Tipos cadastráveis preservam existentes e permitem vincular componentes sem tipo",
    async () => {
      assert.equal(
        (
          await pg.query(
            "select count(*)::integer as n from public.component_types",
          )
        ).rows[0].n,
        8,
      );
      await as(admin, () =>
        pg.exec(
          "insert into public.components(code) values('TIPO-PENDENTE'); insert into public.components(code,type) values('TIPO-VAZIO','   ');",
        ),
      );
      assert.equal(
        (
          await pg.query(
            "select type from public.components where code='TIPO-PENDENTE'",
          )
        ).rows[0].type,
        null,
      );
      assert.equal(
        (
          await pg.query(
            "select type from public.components where code='TIPO-VAZIO'",
          )
        ).rows[0].type,
        null,
      );
      await as(admin, () =>
        pg.exec(
          "insert into public.component_types(name) values('Certificado'); update public.components set type='Certificado' where code='TIPO-PENDENTE';",
        ),
      );
      assert.equal(
        (
          await pg.query(
            "select type from public.components where code='TIPO-PENDENTE'",
          )
        ).rows[0].type,
        "Certificado",
      );
      assert.equal(
        (
          await pg.query("select type from public.components where id=$1", [
            component,
          ])
        ).rows[0].type,
        "Caixa",
      );
      await assert.rejects(
        as(admin, () =>
          pg.exec(
            "insert into public.component_types(name) values('certificado')",
          ),
        ),
      );
      await assert.rejects(
        as(admin, () =>
          pg.exec("insert into public.component_types(name) values('Relogio')"),
        ),
      );
      await assert.rejects(
        as(admin, () =>
          pg.exec(
            "update public.components set type='NAO-CADASTRADO' where code='TIPO-PENDENTE'",
          ),
        ),
      );
    },
  );
  await t.test(
    "Operadores não cadastram tipos nem classificam componentes; tipos nulos não bloqueiam kits",
    async () => {
      await assert.rejects(
        as(operator, () =>
          pg.exec(
            "insert into public.component_types(name) values('INDEVIDO')",
          ),
        ),
      );
      const deniedUpdate = await as(operator, () => pg.query("update public.components set type=null returning id"));
      assert.equal(deniedUpdate.rows.length, 0);
      assert.equal((await pg.query("select type from public.components where id=$1", [component])).rows[0].type, "Caixa");
      await assert.rejects(
        as(disabled, () =>
          pg.exec("insert into public.component_types(name) values('INATIVO')"),
        ),
      );
      await assert.rejects(
        as(null, () => pg.exec("select * from public.component_types")),
      );
      await as(admin, () =>
        pg.query("update public.components set type=null where id=$1", [
          component,
        ]),
      );
      const kit = await as(operator, () =>
        pg.query("select public.consult_kit('00123') as kit"),
      );
      assert.equal(
        kit.rows[0].kit.items.find((item) => item.code === "0001").type,
        null,
      );
      await as(admin, () =>
        pg.query("update public.components set type=$1 where id=$2", [
          "Caixa",
          component,
        ]),
      );
    },
  );
  await pg.close();
});
