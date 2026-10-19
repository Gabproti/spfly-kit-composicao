begin;
alter table public.components add column allow_bulk boolean not null default false;
-- Server-owned previews also retain a receipt of completed administrative actions.
create table private.bulk_component_previews(
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',
 snapshot jsonb not null,confirmed_at timestamptz,result jsonb
);
alter table private.bulk_component_previews enable row level security;
revoke all on private.bulk_component_previews from public,anon,authenticated;
create index bulk_component_preview_expiry_idx on private.bulk_component_previews(expires_at) where confirmed_at is null;
create function private.bulk_component_snapshot(p_component_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('component',(select jsonb_build_object('id',id,'code',code,'description',description,'active',active,'allow_bulk',allow_bulk,'updated_at',updated_at) from public.components where id=p_component_id),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'active',p.active,'link_id',co.id,'quantity',co.quantity,'position',co.position) order by p.id) from public.products p left join public.compositions co on co.product_id=p.id and co.component_id=p_component_id),'[]'::jsonb));
$$;
revoke all on function private.bulk_component_snapshot(uuid) from public,anon,authenticated;
create function public.admin_preview_component_all(p_component_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; token uuid; total integer; existing integer; inactive integer; adding_inactive integer;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 s:=private.bulk_component_snapshot(p_component_id);
 if s->'component'='null'::jsonb or s->'component' is null then raise exception 'Componente não encontrado.'; end if;
 if not (s->'component'->>'active')::boolean then raise exception 'Selecione um componente ativo.'; end if;
 if not (s->'component'->>'allow_bulk')::boolean then raise exception 'Este componente não está autorizado para adicionar a todos os produtos.'; end if;
 select count(*),count(*) filter(where value->>'link_id' is not null),count(*) filter(where not (value->>'active')::boolean),count(*) filter(where not (value->>'active')::boolean and value->>'link_id' is null) into total,existing,inactive,adding_inactive from jsonb_array_elements(s->'products');
 delete from private.bulk_component_previews where confirmed_at is null and expires_at<now()-interval '1 day';
 insert into private.bulk_component_previews(created_by,snapshot) values(auth.uid(),s) returning id into token;
 return jsonb_build_object('token',token,'component_code',s->'component'->>'code','component_description',s->'component'->>'description','total',total,'existing',existing,'adding',total-existing,'inactive',inactive,'adding_inactive',adding_inactive,'quantity',1,'expires_at',now()+interval '10 minutes');
end; $$;
create function public.admin_apply_component_all(p_token uuid,p_confirmation_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare preview private.bulk_component_previews; cid uuid; current_snapshot jsonb; inserted integer; receipt jsonb;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 select * into preview from private.bulk_component_previews where id=p_token and created_by=auth.uid() for update;
 if not found then raise exception 'Prévia não encontrada. Confira o impacto novamente.'; end if;
 if p_confirmation_code is distinct from preview.snapshot->'component'->>'code' then raise exception 'Digite o código exato do componente para confirmar.'; end if;
 if preview.confirmed_at is not null then return preview.result; end if;
 if preview.expires_at<now() then raise exception 'A prévia expirou. Confira o impacto novamente.'; end if;
 cid:=(preview.snapshot->'component'->>'id')::uuid;
 -- Same ordered product locks as the existing editor/import. Only approved IDs
 -- can be inserted, even if another product is created immediately afterwards.
 perform p.id from public.products p where p.id in(select (value->>'id')::uuid from jsonb_array_elements(preview.snapshot->'products')) order by p.id for update;
 perform 1 from public.components where id=cid for share;
 current_snapshot:=private.bulk_component_snapshot(cid);
 if current_snapshot is distinct from preview.snapshot then raise exception 'Os produtos, o componente ou seus vínculos mudaram. Confira o impacto novamente.'; end if;
 insert into public.compositions(product_id,component_id,quantity,position)
 select p.id,cid,1,coalesce((select max(position)+1 from public.compositions where product_id=p.id),0)
 from public.products p where p.id in(select (value->>'id')::uuid from jsonb_array_elements(preview.snapshot->'products'))
 and not exists(select 1 from public.compositions co where co.product_id=p.id and co.component_id=cid);
 get diagnostics inserted=row_count;
 receipt:=jsonb_build_object('inserted',inserted,'component_code',preview.snapshot->'component'->>'code','quantity',1);
 update private.bulk_component_previews set confirmed_at=now(),result=receipt where id=p_token;
 return receipt;
end; $$;
revoke all on function public.admin_preview_component_all(uuid),public.admin_apply_component_all(uuid,text) from public,anon;
grant execute on function public.admin_preview_component_all(uuid),public.admin_apply_component_all(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
