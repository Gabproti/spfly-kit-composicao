import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Componente em todos os produtos exige prévia confirmada e preserva composições", async (t) => {
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
      inactive = "00000000-0000-4000-8000-000000000003",
      otherAdmin = "00000000-0000-4000-8000-000000000004";
    await pg.query(
      "insert into auth.users(id,email) values($1,'a@test'),($2,'o@test'),($3,'i@test'),($4,'a2@test')",
      [admin, operator, inactive, otherAdmin],
    );
    await pg.query(
      "update profiles set role='admin',active=true where id in($1,$2)",
      [admin, otherAdmin],
    );
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
    const components = (
      await pg.query(
        "insert into components(code) values('MANUAL'),('CAIXA'),('EXTRA') returning id,code",
      )
    ).rows;
    const cid = components.find((c) => c.code === "MANUAL").id,
      box = components.find((c) => c.code === "CAIXA").id,
      extra = components.find((c) => c.code === "EXTRA").id;
    const products = (
      await pg.query(
        "insert into products(code,active) values('P1',true),('P2',true),('P3',false) returning id,code",
      )
    ).rows;
    const p1 = products.find((p) => p.code === "P1").id,
      p2 = products.find((p) => p.code === "P2").id;
    await pg.query(
      "insert into compositions(product_id,component_id,quantity,position) values($1,$2,7,3),($1,$3,2,0),($4,$3,5,8)",
      [p1, cid, box, p2],
    );
    const preview = async (id = cid) =>
      (await as(admin, "select admin_preview_component_all($1) as value", [id]))
        .rows[0].value;
    const apply = async (token, code = "MANUAL", who = admin) =>
      (
        await as(who, "select admin_apply_component_all($1,$2) as value", [
          token,
          code,
        ])
      ).rows[0].value;
    let first;
    await t.test(
      "Somente componentes autorizados no cadastro podem usar a função; permissão começa desmarcada",
      async () => {
        assert.ok(
          (await pg.query("select allow_bulk from components")).rows.every(
            (c) => c.allow_bulk === false,
          ),
        );
        await assert.rejects(preview(), /não está autorizado/);
        await as(
          operator,
          "update components set allow_bulk=true where id=$1",
          [cid],
        );
        assert.equal(
          (
            await pg.query("select allow_bulk from components where id=$1", [
              cid,
            ])
          ).rows[0].allow_bulk,
          false,
        );
        await as(
          admin,
          "update components set allow_bulk=true where id in($1,$2)",
          [cid, extra],
        );
        await assert.rejects(preview(box), /não está autorizado/);
        assert.equal(
          (await pg.query("select count(*)::integer n from compositions"))
            .rows[0].n,
          3,
        );
        const authorized = await preview();
        await as(admin, "update components set allow_bulk=false where id=$1", [
          cid,
        ]);
        await assert.rejects(apply(authorized.token), /mudaram/);
        await as(admin, "update components set allow_bulk=true where id=$1", [
          cid,
        ]);
      },
    );
    await t.test(
      "Prévia não altera vínculos e conta produtos inativos explicitamente",
      async () => {
        first = await preview();
        assert.equal(first.total, 3);
        assert.equal(first.existing, 1);
        assert.equal(first.adding, 2);
        assert.equal(first.inactive, 1);
        assert.equal(first.adding_inactive, 1);
        assert.equal(
          (await pg.query("select count(*)::integer n from compositions"))
            .rows[0].n,
          3,
        );
      },
    );
    await t.test(
      "Operador, inativo, anônimo e outro administrador não podem confirmar a prévia alheia",
      async () => {
        for (const who of [operator, inactive, null]) {
          await assert.rejects(
            as(who, "select admin_preview_component_all($1)", [cid]),
          );
          await assert.rejects(apply(first.token, "MANUAL", who));
        }
        await assert.rejects(apply(first.token, "MANUAL", otherAdmin));
        await assert.rejects(
          as(admin, "select * from private.bulk_component_previews"),
        );
      },
    );
    await t.test(
      "Código ausente/errado e token inventado não permitem gravar",
      async () => {
        await assert.rejects(apply(first.token, ""), /código exato/);
        await assert.rejects(apply(first.token, "manual"), /código exato/);
        await assert.rejects(
          apply("00000000-0000-4000-8000-000000000099"),
          /Prévia não encontrada/,
        );
      },
    );
    await t.test(
      "Prévia expirada ou alteração do conjunto de produtos exige nova conferência",
      async () => {
        const expired = await preview();
        await pg.query(
          "update private.bulk_component_previews set expires_at=now()-interval '1 second' where id=$1",
          [expired.token],
        );
        await assert.rejects(apply(expired.token), /expirou/);
        const changed = await preview();
        await pg.exec("insert into products(code) values('P4')");
        await assert.rejects(apply(changed.token), /mudaram/);
      },
    );
    await t.test(
      "Mudança de quantidade ou componente inativo bloqueia a operação inteira",
      async () => {
        const changed = await preview();
        await pg.query(
          "update compositions set quantity=9 where product_id=$1 and component_id=$2",
          [p1, cid],
        );
        await assert.rejects(apply(changed.token), /mudaram/);
        await pg.query(
          "update compositions set quantity=7 where product_id=$1 and component_id=$2",
          [p1, cid],
        );
        const stale = await preview();
        await pg.query("update components set active=false where id=$1", [cid]);
        await assert.rejects(apply(stale.token), /mudaram/);
        await assert.rejects(preview(), /ativo/);
        await pg.query("update components set active=true where id=$1", [cid]);
      },
    );
    await t.test(
      "Acrescenta no final com quantidade 1 e preserva todos os itens/quantidades/posições anteriores",
      async () => {
        const fresh = await preview();
        const before = (
          await pg.query(
            "select id,quantity,position from compositions order by id",
          )
        ).rows;
        const saved = await apply(fresh.token);
        assert.equal(saved.inserted, 3);
        for (const entry of before) {
          const after = (
            await pg.query(
              "select id,quantity,position from compositions where id=$1",
              [entry.id],
            )
          ).rows[0];
          assert.deepEqual(after, entry);
        }
        const inserted = (
          await pg.query(
            "select quantity,position from compositions where product_id=$1 and component_id=$2",
            [p2, cid],
          )
        ).rows[0];
        assert.deepEqual(inserted, { quantity: 1, position: 9 });
        assert.equal(
          (
            await pg.query(
              "select count(*)::integer n from compositions where component_id=$1",
              [cid],
            )
          ).rows[0].n,
          4,
        );
        assert.deepEqual(await apply(fresh.token), saved);
        assert.equal((await preview()).adding, 0);
      },
    );
    await t.test(
      "Produto futuro não é incluído; falha durante inserção desfaz todo o lote e mantém prévia sem confirmar",
      async () => {
        await pg.exec(
          "insert into products(code) values('FUTURO');create function private.fail_bulk_test() returns trigger language plpgsql as $$begin if new.quantity=1 then raise exception 'forced failure';end if;return new;end;$$;create trigger fail_bulk_test before insert on compositions for each row execute function private.fail_bulk_test()",
        );
        const fresh = await preview(extra);
        assert.equal(fresh.adding, 5);
        await assert.rejects(apply(fresh.token, "EXTRA"), /forced failure/);
        assert.equal(
          (
            await pg.query(
              "select count(*)::integer n from compositions where component_id=$1",
              [extra],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "select confirmed_at from private.bulk_component_previews where id=$1",
              [fresh.token],
            )
          ).rows[0].confirmed_at,
          null,
        );
        await pg.exec("drop trigger fail_bulk_test on compositions");
        assert.equal((await apply(fresh.token, "EXTRA")).inserted, 5);
        assert.equal((await preview()).adding, 1);
      },
    );
  } finally {
    await pg.close();
  }
});
