begin;
create function private.gtin_key(p_value text) returns text language plpgsql immutable set search_path='' as $$
declare total integer:=0; weight integer:=3; i integer;
begin
 if p_value is null or p_value !~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' or p_value ~ '^0+$' then return null; end if;
 for i in reverse length(p_value)-1..1 loop
  total:=total+substring(p_value from i for 1)::integer*weight;weight:=case when weight=3 then 1 else 3 end;
 end loop;
 if (10-total%10)%10<>right(p_value,1)::integer then return null; end if;
 return lpad(p_value,14,'0');
end; $$;
revoke all on function private.gtin_key(text) from public,anon,authenticated;
create table public.product_eans(
 ean text not null check(private.gtin_key(ean) is not null),
 ean_key text generated always as(private.gtin_key(ean)) stored primary key,
 product_id uuid not null references public.products(id) on delete cascade,
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id)
);
create index product_eans_product_idx on public.product_eans(product_id);
alter table public.product_eans enable row level security;
revoke all on public.product_eans from public,anon,authenticated;
grant select on public.product_eans to authenticated;
create policy product_eans_admin_read on public.product_eans for select to authenticated using((select private.is_admin()));
create function public.admin_import_product_eans(p_rows jsonb,p_apply boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 or p_apply is null then raise exception 'Lote inválido: de 1 a 5.000 linhas.'; end if;
 if p_apply then
  -- This endpoint is the only writer: serialize imports to recheck ownership.
  perform pg_advisory_xact_lock(193746,302);
  perform id from public.products where code in(select trim(value->>'product') from jsonb_array_elements(p_rows)) order by id for share;
 end if;
 with input as materialized(
  select (n-1)::integer as idx,e,trim(e->>'ean') as ean,trim(e->>'product') as product,private.gtin_key(trim(e->>'ean')) as key from jsonb_array_elements(p_rows) with ordinality as t(e,n)
 ), matched as materialized(
  select i.*,p.id as pid,b.product_id as existing_pid,row_number() over(partition by i.key order by i.idx) as duplicate_rank,
  case when i.key is null or jsonb_typeof(i.e->'ean') is distinct from 'string' or jsonb_typeof(i.e->'product') is distinct from 'string' or coalesce(length(i.product),0) not between 1 and 80 then 'invalid'
   when exists(select 1 from input other where other.key=i.key and other.product is distinct from i.product) then 'file_conflict'
   when p.id is null then 'product_missing'
   when exists(select 1 from public.products other where other.id<>p.id and (other.code=i.ean or private.gtin_key(other.code)=i.key)) then 'code_conflict'
   when b.product_id is not null and b.product_id<>p.id then 'conflict'
   when b.product_id=p.id then 'existing'
   else 'new' end as status
  from input i left join public.products p on p.code=i.product left join public.product_eans b on b.ean_key=i.key
 ), inserted as(
  insert into public.product_eans(ean,product_id,created_by)
  select ean,pid,auth.uid() from matched where p_apply and status='new' and duplicate_rank=1
  returning ean_key
 )
 select jsonb_agg(jsonb_build_object('index',m.idx,'status',case when m.status='new' and m.duplicate_rank>1 then 'duplicate' when ins.ean_key is not null and m.duplicate_rank=1 then 'inserted' else m.status end,'product_code',m.product) order by m.idx) into result
 from matched m left join inserted ins on ins.ean_key=m.key;
 return coalesce(result,'[]'::jsonb);
end; $$;
revoke all on function public.admin_import_product_eans(jsonb,boolean) from public,anon;
grant execute on function public.admin_import_product_eans(jsonb,boolean) to authenticated;
-- Existing consultation semantics remain: unavailable kits return null and
-- successful searches record the official product code, never the alias.
create or replace function public.consult_kit(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare product public.products; items jsonb; exact_id uuid; barcode_id uuid; alias_ean text; query text;
begin
 if not private.is_member() then raise exception 'Acesso indisponível.' using errcode='42501'; end if;
 if p_code is null or length(trim(p_code)) not between 1 and 80 then return null; end if;
 query:=regexp_replace(p_code,'^[[:space:]]+|[[:space:]]+$','','g');
 select id into exact_id from public.products where code=query;
 select product_id,ean into barcode_id,alias_ean from public.product_eans where ean_key=private.gtin_key(query);
 if exact_id is not null and barcode_id is not null and exact_id<>barcode_id then return null; end if;
 select * into product from public.products where id=coalesce(exact_id,barcode_id) and active for share;
 if not found then return null; end if;
 perform 1 from public.components c join public.compositions co on co.component_id=c.id where co.product_id=product.id for share of c;
 if exists(select 1 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id and not c.active) then return null; end if;
 select jsonb_agg(jsonb_build_object('code',c.code,'type',c.type,'description',c.description,'quantity',co.quantity,'image_url',c.image_url) order by co.position,c.code) into items
 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id;
 if items is null then return null; end if;
 insert into public.consultation_history(user_id,product_id,product_code) values(auth.uid(),product.id,product.code);
 return jsonb_build_object('product',to_jsonb(product),'items',items,'matched_ean',case when exact_id is null then alias_ean else null end);
end; $$;
revoke all on function public.consult_kit(text) from public,anon;
grant execute on function public.consult_kit(text) to authenticated;
notify pgrst,'reload schema';
commit;
