begin;
-- Incremental, idempotent batches. Direct composition writes remain forbidden.
create or replace function public.import_kit_links(p_links jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if p_links is null or jsonb_typeof(p_links)<>'array' then raise exception 'Lote inválido.'; end if;
 if jsonb_array_length(p_links)>1000 then raise exception 'Limite de 1.000 relações por lote.'; end if;
 -- Same product lock used by the manual composition editor. Stable ordering
 -- also prevents conflicting imports from taking locks in opposite orders.
 perform p.id from public.products p where p.code in
   (select trim(value->>'product') from jsonb_array_elements(p_links)) order by p.id for update;
 perform c.id from public.components c where c.code in
   (select trim(value->>'component') from jsonb_array_elements(p_links)) order by c.id for share;
 with input as materialized (
   select (ordinality-1)::integer as idx, trim(value->>'product') as product,
     trim(value->>'component') as component from jsonb_array_elements(p_links) with ordinality
 ), matched as materialized (
   select i.*, p.id as pid, c.id as cid, p.active as pa, c.active as ca,
     row_number() over(partition by i.product,i.component order by i.idx) as duplicate_rank
   from input i left join public.products p on p.code=i.product left join public.components c on c.code=i.component
 ), eligible as (
   select m.*, coalesce((select max(position)+1 from public.compositions where product_id=m.pid),0)
     + (row_number() over(partition by m.pid order by m.idx)-1)::integer as new_position
   from matched m where m.pid is not null and m.cid is not null and m.pa and m.ca and m.duplicate_rank=1
     and char_length(m.product) between 1 and 80 and char_length(m.component) between 1 and 80
     and not exists(select 1 from public.compositions co where co.product_id=m.pid and co.component_id=m.cid)
 ), inserted as (
   insert into public.compositions(product_id,component_id,quantity,position)
   select pid,cid,1,new_position from eligible
   on conflict(product_id,component_id) do nothing returning product_id,component_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('index',m.idx,'status',case
   when coalesce(char_length(m.product),0) not between 1 and 80 or coalesce(char_length(m.component),0) not between 1 and 80 then 'invalid'
   when m.duplicate_rank>1 then 'duplicate'
   when m.pid is null then 'product_missing'
   when m.cid is null then 'component_missing'
   when not m.pa or not m.ca then 'inactive'
   when ins.product_id is not null then 'inserted'
   else 'existing' end) order by m.idx),'[]'::jsonb) into result
 from matched m left join inserted ins on ins.product_id=m.pid and ins.component_id=m.cid;
 return result;
end; $$;
revoke all on function public.import_kit_links(jsonb) from public,anon;
grant execute on function public.import_kit_links(jsonb) to authenticated;

-- Include each component image in the already authorized consultation result.
create or replace function public.consult_kit(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare product public.products; items jsonb;
begin
 if not private.is_member() then raise exception 'Acesso indisponível.' using errcode='42501';end if;
 if p_code is null or char_length(trim(p_code)) not between 1 and 80 then return null;end if;
 select * into product from public.products where code=trim(p_code) and active for share;
 if not found then return null;end if;
 perform 1 from public.components c join public.compositions co on co.component_id=c.id where co.product_id=product.id for share of c;
 if exists(select 1 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id and not c.active) then return null;end if;
 select jsonb_agg(jsonb_build_object('code',c.code,'type',c.type,'description',c.description,'quantity',co.quantity,'image_url',c.image_url) order by co.position,c.code) into items
 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id;
 if items is null then return null;end if;
 insert into public.consultation_history(user_id,product_id,product_code) values(auth.uid(),product.id,product.code);
 return jsonb_build_object('product',to_jsonb(product),'items',items);
end; $$;
revoke all on function public.consult_kit(text) from public,anon;
grant execute on function public.consult_kit(text) to authenticated;
notify pgrst, 'reload schema';
commit;
