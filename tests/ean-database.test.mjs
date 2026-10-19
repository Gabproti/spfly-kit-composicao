import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("EAN: importação incremental, consulta por leitor e permissões", async (t) => {
  const pg = new PGlite();
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`,
    );
    for (const file of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(
        await readFile(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const admin = "00000000-0000-4000-8000-000000000001",
      operator = "00000000-0000-4000-8000-000000000002",
      inactive = "00000000-0000-4000-8000-000000000003";
    await pg.query(
      "insert into auth.users(id,email) values($1,'a@test'),($2,'o@test'),($3,'i@test')",
      [admin, operator, inactive],
    );
    await pg.query("update profiles set role='admin',active=true where id=$1", [
      admin,
    ]);
    await pg.query("update profiles set active=true where id=$1", [operator]);
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
    const products = (
        await pg.query(
          "insert into products(code) values('00123'),('AT8020-03L'),('WITHOUT-KIT') returning id,code",
        )
      ).rows,
      p1 = products.find((p) => p.code === "00123").id,
      p2 = products.find((p) => p.code === "AT8020-03L").id;
    const component = (
      await pg.query(
        "insert into components(code,image_url) values('MANUAL','manual.png') returning id",
      )
    ).rows[0].id;
    await as(admin, "select save_composition($1,$2)", [
      p1,
      [{ component_id: component, quantity: 7 }],
    ]);
    await as(admin, "select save_composition($1,$2)", [
      p2,
      [{ component_id: component, quantity: 3 }],
    ]);
    const input = [
      { ean: "0036000291452", product: "00123" },
      { ean: "4006381333931", product: "AT8020-03L" },
    ];
    const run = async (rows, apply = false, who = admin) =>
      (
        await as(who, "select admin_import_product_eans($1,$2) as value", [
          rows,
          apply,
        ])
      ).rows[0].value;
    const consult = async (code, who = operator) =>
      (await as(who, "select consult_kit($1) as value", [code])).rows[0].value;
    await t.test(
      "Prévia não grava e importação revalidada preserva produto, imagem e composição",
      async () => {
        assert.deepEqual(
          (await run(input)).map((r) => r.status),
          ["new", "new"],
        );
        assert.equal(
          (await pg.query("select count(*)::integer n from product_eans"))
            .rows[0].n,
          0,
        );
        assert.deepEqual(
          (await run(input, true)).map((r) => r.status),
          ["inserted", "inserted"],
        );
        assert.deepEqual(
          (await run(input, true)).map((r) => r.status),
          ["existing", "existing"],
        );
        assert.equal(
          (
            await pg.query(
              "select quantity from compositions where product_id=$1",
              [p1],
            )
          ).rows[0].quantity,
          7,
        );
        assert.equal(
          (await pg.query("select code from products where id=$1", [p1]))
            .rows[0].code,
          "00123",
        );
      },
    );
    await t.test(
      "Consulta original e EAN/UPC equivalentes retornam o mesmo kit e histórico usa código oficial",
      async () => {
        const original = await consult("00123"),
          scanned = await consult("036000291452\r\n");
        assert.equal(scanned.product.id, original.product.id);
        assert.equal(scanned.matched_ean, "0036000291452");
        assert.equal(scanned.items[0].quantity, 7);
        assert.equal(scanned.items[0].image_url, "manual.png");
        assert.deepEqual(
          (
            await pg.query(
              "select distinct product_code from consultation_history",
            )
          ).rows,
          [{ product_code: "00123" }],
        );
        assert.equal((await consult("4006381333931")).product.id, p2);
      },
    );
    await t.test(
      "EAN de outro produto, conflito no arquivo, verificador inválido e produto ausente não alteram vínculos",
      async () => {
        assert.equal(
          (await run([{ ean: "036000291452", product: "AT8020-03L" }], true))[0]
            .status,
          "conflict",
        );
        assert.deepEqual(
          (
            await run(
              [
                { ean: "96385074", product: "00123" },
                { ean: "00000096385074", product: "AT8020-03L" },
              ],
              true,
            )
          ).map((r) => r.status),
          ["file_conflict", "file_conflict"],
        );
        assert.equal(
          (await run([{ ean: "4006381333932", product: "00123" }], true))[0]
            .status,
          "invalid",
        );
        assert.equal(
          (await run([{ ean: "96385074", product: "MISSING" }], true))[0]
            .status,
          "product_missing",
        );
        assert.equal(
          (await pg.query("select count(*)::integer n from product_eans"))
            .rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "Permite vários EANs no mesmo produto e ignora repetições canônicas",
      async () => {
        const result = await run(
          [
            { ean: "96385074", product: "00123" },
            { ean: "00000096385074", product: "00123" },
          ],
          true,
        );
        assert.deepEqual(
          result.map((r) => r.status),
          ["inserted", "duplicate"],
        );
        assert.equal((await consult("96385074")).product.id, p1);
      },
    );
    await t.test(
      "Operador/inativo/anônimo não importam; operador não enumera a tabela e não grava diretamente",
      async () => {
        for (const who of [operator, inactive, null])
          await assert.rejects(run(input, true, who));
        assert.equal(
          (await as(operator, "select * from product_eans")).rows.length,
          0,
        );
        await assert.rejects(
          as(
            admin,
            "insert into product_eans(ean,product_id,created_by) values($1,$2,$3)",
            ["7894900011517", p1, admin],
          ),
        );
        for (const who of [inactive, null])
          await assert.rejects(consult("4006381333931", who));
      },
    );
    await t.test(
      "Colisão com código numérico de outro produto é rejeitada e ambiguidade futura nunca retorna kit incorreto",
      async () => {
        const collision = (
          await pg.query(
            "insert into products(code) values('7894900011517') returning id",
          )
        ).rows[0].id;
        assert.equal(
          (await run([{ ean: "7894900011517", product: "00123" }], true))[0]
            .status,
          "code_conflict",
        );
        assert.ok(collision);
        await pg.exec("insert into products(code) values('4006381333931')");
        assert.equal(await consult("4006381333931"), null);
      },
    );
    await t.test(
      "Produto/itens inativos e kit vazio continuam indisponíveis; excluir produto remove somente seus EANs",
      async () => {
        await pg.query("update products set active=false where id=$1", [p1]);
        assert.equal(await consult("96385074"), null);
        await pg.query("update products set active=true where id=$1", [p1]);
        await pg.query("update components set active=false where id=$1", [
          component,
        ]);
        assert.equal(await consult("96385074"), null);
        await pg.query("update components set active=true where id=$1", [
          component,
        ]);
        await run([{ ean: "7894900011517", product: "7894900011517" }], true);
        assert.equal(await consult("7894900011517"), null);
        await as(
          admin,
          "select admin_delete_product($1,(select updated_at from products where id=$1),1)",
          [p1],
        );
        assert.equal(
          (
            await pg.query(
              "select count(*)::integer n from product_eans where product_id=$1",
              [p1],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "select count(*)::integer n from consultation_history where product_code=$1",
              ["00123"],
            )
          ).rows[0].n > 0,
          true,
        );
      },
    );
    const makeEan = (body) => {
      let sum = 0;
      for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3)
        sum += Number(body[i]) * w;
      return body + String((10 - (sum % 10)) % 10);
    };
    await t.test(
      "N final: quatro exemplos encontram o produto sem alterar EAN ou código oficial",
      async () => {
        const codes = ["AN3666-51A", "AN3700-89Z", "AN8175-55E", "AN8192-56P"];
        for (const code of codes)
          await pg.query("insert into products(code) values($1)", [code]);
        const rows = codes.map((product, i) => ({
          ean: makeEan("12345678901" + i),
          product: product + "N",
          rule: "remove_suffix_N",
        }));
        const checked = await run(rows);
        assert.ok(
          checked.every(
            (r) => r.status === "new" && r.rule_applied === "remove_suffix_N",
          ),
        );
        assert.deepEqual(
          checked.map((r) => r.product_code),
          codes,
        );
        const saved = await run(
          rows.map((r, i) => ({
            ...r,
            expected_product_id: checked[i].product_id,
          })),
          true,
        );
        assert.ok(saved.every((r) => r.status === "inserted"));
        assert.deepEqual(
          (
            await pg.query(
              "select p.code from products p where p.code like 'AN%' order by code",
            )
          ).rows.map((r) => r.code),
          [...codes].sort(),
        );
        for (const [i, row] of rows.entries())
          assert.equal(
            (
              await pg.query(
                "select ean from product_eans where product_id=$1",
                [checked[i].product_id],
              )
            ).rows[0].ean,
            row.ean,
          );
      },
    );
    await t.test(
      "Exata vence a remoção do N; regra é opcional, não encadeia e não remove outro caractere",
      async () => {
        await pg.exec("insert into products(code) values('AN3666-51AN')");
        const exact = await run([
          {
            ean: makeEan("123456789020"),
            product: "AN3666-51AN",
            rule: "remove_suffix_N",
          },
        ]);
        assert.equal(exact[0].product_code, "AN3666-51AN");
        assert.equal(exact[0].rule_applied, "exact");
        for (const row of [
          { ean: makeEan("123456789021"), product: "AN3700-89ZN" },
          {
            ean: makeEan("123456789022"),
            product: "AN3700-89ZNN",
            rule: "remove_suffix_N",
          },
          {
            ean: makeEan("123456789023"),
            product: "AN3700-89ZX",
            rule: "remove_suffix_N",
          },
        ])
          assert.equal((await run([row], true))[0].status, "product_missing");
        assert.equal(
          (
            await run(
              [
                {
                  ean: makeEan("123456789024"),
                  product: "AN3700-89Z",
                  rule: "invalid",
                },
              ],
              true,
            )
          )[0].status,
          "invalid",
        );
      },
    );
    await t.test(
      "Resolução diferente desde a prévia é recusada e variantes do mesmo produto são deduplicadas",
      async () => {
        const input = {
          ean: makeEan("123456789030"),
          product: "AN3700-89ZN",
          rule: "remove_suffix_N",
        };
        const checked = await run([input]);
        await pg.exec("insert into products(code) values('AN3700-89ZN')");
        assert.equal(
          (
            await run(
              [{ ...input, expected_product_id: checked[0].product_id }],
              true,
            )
          )[0].status,
          "changed",
        );
        assert.equal(
          (
            await pg.query(
              "select count(*)::integer n from product_eans where ean=$1",
              [input.ean],
            )
          ).rows[0].n,
          0,
        );
        const ean = makeEan("123456789031");
        const same = await run(
          [
            { ean, product: "AN8175-55E", rule: "remove_suffix_N" },
            { ean, product: "AN8175-55EN", rule: "remove_suffix_N" },
          ],
          true,
        );
        assert.deepEqual(
          same.map((r) => r.status),
          ["inserted", "duplicate"],
        );
        const conflicting = await run(
          [
            {
              ean: makeEan("123456789032"),
              product: "AN8175-55E",
              rule: "remove_suffix_N",
            },
            {
              ean: makeEan("123456789032"),
              product: "AN8192-56PN",
              rule: "remove_suffix_N",
            },
          ],
          true,
        );
        assert.ok(conflicting.every((r) => r.status === "file_conflict"));
      },
    );
  } finally {
    await pg.close();
  }
});
