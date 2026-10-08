import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Importação de imagens: RLS, histórico, concorrência, idempotência e preservação de códigos", async () => {
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
      otherAdmin = "00000000-0000-4000-8000-000000000004",
      batch = "00000000-0000-4000-8000-000000000010";
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
    const start = [
      batch,
      "CITIZEN.zip",
      "remove_suffix_N",
      {},
      [
        {
          filename: "AN3666-51AN.jpg",
          code: "AN3666-51A",
          product_code: "AN3666-51A",
          rule: "remove_suffix_N",
          outcome: "pending",
        },
        {
          filename: "missing.jpg",
          code: "missing",
          rule: "exact",
          outcome: "not_found",
        },
        {
          filename: "amb.jpg",
          code: "amb",
          rule: "normalize",
          outcome: "ambiguous",
        },
      ],
    ];
    for (const id of [operator, inactive, null])
      await assert.rejects(
        as(id, "select start_image_import($1,$2,$3,$4,$5)", start),
      );
    await as(admin, "select start_image_import($1,$2,$3,$4,$5)", start);
    await as(admin, "select start_image_import($1,$2,$3,$4,$5)", start);
    assert.equal(
      (await pg.query("select count(*)::integer n from image_import_entries"))
        .rows[0].n,
      3,
    );
    assert.equal(
      (await as(operator, "select * from image_import_entries")).rows.length,
      0,
    );
    await assert.rejects(
      as(
        admin,
        "insert into image_imports(id,created_by,source,rule) values(gen_random_uuid(),$1,'x','exact')",
        [admin],
      ),
    );
    const p = (
      await pg.query(
        "insert into products(code,image_url) values('AN3666-51A','old.png') returning id",
      )
    ).rows[0].id;
    await pg.exec(
      "insert into components(code,image_url) values('SHARED','old.png');insert into storage.objects(bucket_id,name) values('product-images','new.png'),('product-images','old.png'),('product-images','newer.png')",
    );
    const params = [batch, 0, p, "old.png", "new.png", "remove_suffix_N"];
    for (const id of [operator, inactive, otherAdmin, null])
      await assert.rejects(
        as(id, "select commit_import_image($1,$2,$3,$4,$5,$6)", params),
      );
    await assert.rejects(
      as(admin, "select commit_import_image($1,$2,$3,$4,$5,$6)", [
        batch,
        0,
        p,
        null,
        "new.png",
        "manual",
      ]),
      /mudou/,
    );
    await assert.rejects(
      as(admin, "select commit_import_image($1,$2,$3,$4,$5,$6)", [
        batch,
        0,
        p,
        "old.png",
        "missing.png",
        "manual",
      ]),
      /upload/,
    );
    await as(admin, "select commit_import_image($1,$2,$3,$4,$5,$6)", params);
    assert.equal(
      (
        await as(admin, "select commit_import_image($1,$2,$3,$4,$5,$6)", [
          batch,
          0,
          p,
          "old.png",
          "newer.png",
          "manual",
        ])
      ).rows[0].commit_import_image,
      "new.png",
    );
    await as(
      admin,
      "select record_image_import_result($1,0,'error','timeout')",
      [batch],
    );
    await as(admin, "select finish_image_import($1,'completed')", [batch]);
    const stored = (
      await pg.query("select code,image_url from products where id=$1", [p])
    ).rows[0];
    assert.deepEqual(stored, { code: "AN3666-51A", image_url: "new.png" });
    assert.equal(
      (await pg.query("select * from private.image_cleanup_queue")).rows.length,
      0,
    );
    const h = (await as(admin, "select admin_image_import_history()")).rows[0]
      .admin_image_import_history[0];
    assert.equal(h.total, 3);
    assert.equal(h.linked, 1);
    assert.equal(h.not_found, 1);
    assert.equal(h.ambiguous, 1);
    assert.equal(h.status, "completed");
    await as(
      admin,
      "select admin_delete_product($1,(select updated_at from products where id=$1),0)",
      [p],
    );
    const entry = (
      await pg.query("select * from image_import_entries where position=0")
    ).rows[0];
    assert.equal(entry.product_id, null);
    assert.equal(entry.product_code, "AN3666-51A");
    assert.equal(entry.outcome, "linked");
  } finally {
    await pg.close();
  }
});
