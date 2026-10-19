begin;
-- Preserve the existing RPC signature: old clients default to exact matching.
create or replace function public.admin_import_product_eans(p_rows jsonb,p_apply boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 or p_apply is null then raise exception 'Lote inválido: de 1 a 5.000 linhas.'; end if;
 if p_apply then
  perform pg_advisory_xact_lock(193746,302);
  perform p.id from public.products p where p.code in(select trim(value->>'product') from jsonb_array_elements(p_rows))
   or p.code in(select left(trim(value->>'product'),greatest(length(trim(value->>'product'))-1,0)) from jsonb_array_elements(p_rows) where value->>'rule'='remove_suffix_N' and right(trim(value->>'product'),1)='N') order by p.id for share;
 end if;
 with input as materialized(
  select (n-1)::integer as idx,e,trim(e->>'ean') as ean,trim(e->>'product') as product,private.gtin_key(trim(e->>'ean')) as key,coalesce(e->>'rule','exact') as rule
  from jsonb_array_elements(p_rows) with ordinality as t(e,n)
 ), resolved as materialized(
  select i.*,coalesce(ex.id,alt.id) as pid,coalesce(ex.code,alt.code) as matched_code,
   case when ex.id is not null then 'exact' when alt.id is not null then 'remove_suffix_N' else i.rule end as applied_rule
  from input i left join public.products ex on ex.code=i.product
  left join public.products alt on ex.id is null and i.rule='remove_suffix_N' and right(i.product,1)='N' and alt.code=left(i.product,greatest(length(i.product)-1,0))
 ), matched as materialized(
  select i.*,b.product_id as existing_pid,row_number() over(partition by i.key order by i.idx) as duplicate_rank,
  case when i.key is null or jsonb_typeof(i.e->'ean') is distinct from 'string' or jsonb_typeof(i.e->'product') is distinct from 'string' or coalesce(length(i.product),0) not between 1 and 80 or i.rule not in ('exact','remove_suffix_N') then 'invalid'
   when exists(select 1 from resolved other where other.key=i.key and coalesce(other.pid::text,other.product) is distinct from coalesce(i.pid::text,i.product)) then 'file_conflict'
   when i.pid is null then 'product_missing'
   when p_apply and i.e->>'expected_product_id' is not null and i.e->>'expected_product_id'<>i.pid::text then 'changed'
   when exists(select 1 from public.products other where other.id<>i.pid and (other.code=i.ean or private.gtin_key(other.code)=i.key)) then 'code_conflict'
   when b.product_id is not null and b.product_id<>i.pid then 'conflict'
   when b.product_id=i.pid then 'existing'
   else 'new' end as status
  from resolved i left join public.product_eans b on b.ean_key=i.key
 ), inserted as(
  insert into public.product_eans(ean,product_id,created_by)
  select ean,pid,auth.uid() from matched where p_apply and status='new' and duplicate_rank=1 returning ean_key
 )
 select jsonb_agg(jsonb_build_object('index',m.idx,'status',case when m.status='new' and m.duplicate_rank>1 then 'duplicate' when ins.ean_key is not null and m.duplicate_rank=1 then 'inserted' else m.status end,'product_code',m.matched_code,'product_id',m.pid,'rule_applied',m.applied_rule) order by m.idx) into result
 from matched m left join inserted ins on ins.ean_key=m.key;
 return coalesce(result,'[]'::jsonb);
end; $$;
revoke all on function public.admin_import_product_eans(jsonb,boolean) from public,anon;
grant execute on function public.admin_import_product_eans(jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
