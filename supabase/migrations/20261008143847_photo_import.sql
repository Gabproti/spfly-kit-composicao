begin;
create table public.image_imports(
 id uuid primary key,created_by uuid not null references public.profiles(id),
 source text not null check(length(source) between 1 and 300),
 rule text not null check(rule in ('exact','remove_suffix_N','remove_last_character','remove_first_character','normalize','custom')),
 options jsonb not null default '{}' check(pg_column_size(options)<2048),
 status text not null default 'running' check(status in ('running','completed','stopped')),
 created_at timestamptz not null default now(),finished_at timestamptz
);
create table public.image_import_entries(
 import_id uuid not null references public.image_imports(id) on delete cascade,
 position integer not null check(position between 0 and 4999),
 filename text not null check(length(filename) between 1 and 300),identified_code text not null,
 product_id uuid references public.products(id) on delete set null,product_code text,
 rule text not null,outcome text not null check(outcome in ('pending','linked','kept','skipped','not_found','ambiguous','invalid','error')),
 message text not null default '',image_path text,
 primary key(import_id,position)
);
create index image_imports_created_idx on public.image_imports(created_at desc);
create index image_import_entries_product_idx on public.image_import_entries(product_id);
alter table public.image_imports enable row level security;
alter table public.image_import_entries enable row level security;
revoke all on public.image_imports,public.image_import_entries from public,anon,authenticated;
grant select on public.image_imports,public.image_import_entries to authenticated;
create policy image_import_admin_read on public.image_imports for select to authenticated using((select private.is_admin()));
create policy image_entry_admin_read on public.image_import_entries for select to authenticated using((select private.is_admin()));
create function public.start_image_import(p_id uuid,p_source text,p_rule text,p_options jsonb,p_entries jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 5000 then raise exception 'Lote inválido: até 5.000 arquivos.'; end if;
 if exists(select 1 from public.image_imports where id=p_id) then
  if not exists(select 1 from public.image_imports where id=p_id and created_by=auth.uid() and source=p_source and rule=p_rule and options=p_options) then raise exception 'Lote incompatível.'; end if;
  return p_id;
 end if;
 insert into public.image_imports(id,created_by,source,rule,options) values(p_id,auth.uid(),p_source,p_rule,p_options);
 insert into public.image_import_entries(import_id,position,filename,identified_code,product_code,rule,outcome)
 select p_id,(n-1)::integer,left(e->>'filename',300),left(coalesce(e->>'code',''),300),left(e->>'product_code',80),left(coalesce(e->>'rule',p_rule),60),e->>'outcome'
 from jsonb_array_elements(p_entries) with ordinality as x(e,n);
 return p_id;
end; $$;
create function public.commit_import_image(p_import_id uuid,p_position integer,p_product_id uuid,p_expected_image text,p_image_path text,p_rule text) returns text language plpgsql security definer set search_path='' as $$
declare old_path text; item public.image_import_entries;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 perform 1 from public.image_imports where id=p_import_id and created_by=auth.uid() for update;
 if not found then raise exception 'Lote não encontrado.'; end if;
 select * into item from public.image_import_entries where import_id=p_import_id and position=p_position for update;
 if not found then raise exception 'Arquivo não encontrado no lote.'; end if;
 if item.outcome='linked' then
  if item.product_id is distinct from p_product_id then raise exception 'Arquivo já vinculado a outro produto.'; end if;
  return item.image_path;
 end if;
 if item.outcome not in ('pending','error') then raise exception 'Arquivo não está disponível para envio.'; end if;
 if p_rule not in ('exact','remove_suffix_N','remove_last_character','remove_first_character','normalize','custom','manual') or p_rule is null then raise exception 'Regra inválida.'; end if;
 select image_url into old_path from public.products where id=p_product_id for update;
 if not found then raise exception 'Produto não encontrado. Analise novamente.'; end if;
 if old_path is distinct from p_expected_image then raise exception 'A foto do produto mudou. Analise novamente antes de substituir.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='product-images' and name=p_image_path) then raise exception 'O upload da imagem não foi concluído.'; end if;
 update public.products set image_url=p_image_path where id=p_product_id;
 update public.image_import_entries set product_id=p_product_id,product_code=(select code from public.products where id=p_product_id),rule=p_rule,outcome='linked',message='',image_path=p_image_path where import_id=p_import_id and position=p_position;
 if old_path is not null and old_path<>p_image_path and not exists(select 1 from public.products where image_url=old_path) and not exists(select 1 from public.components where image_url=old_path) then insert into private.image_cleanup_queue(path) values(old_path) on conflict do nothing; end if;
 return p_image_path;
end; $$;
create function public.record_image_import_result(p_import_id uuid,p_position integer,p_outcome text,p_message text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 perform 1 from public.image_imports where id=p_import_id and created_by=auth.uid() for update;
 if not found then raise exception 'Lote não encontrado.'; end if;
 if p_outcome not in ('kept','skipped','not_found','ambiguous','invalid','error') or p_outcome is null then raise exception 'Resultado inválido.'; end if;
 update public.image_import_entries set outcome=p_outcome,message=left(coalesce(p_message,''),300) where import_id=p_import_id and position=p_position and outcome<>'linked';
end; $$;
create function public.finish_image_import(p_import_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if p_status not in ('completed','stopped') or p_status is null then raise exception 'Status inválido.'; end if;
 update public.image_imports set status=p_status,finished_at=now() where id=p_import_id and created_by=auth.uid();
 if not found then raise exception 'Lote não encontrado.'; end if;
end; $$;
create function public.admin_image_import_history() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (
 select i.*,count(e.*)::integer as total,count(*) filter(where e.outcome='linked')::integer as linked,
 count(*) filter(where e.outcome='not_found')::integer as not_found,count(*) filter(where e.outcome='ambiguous')::integer as ambiguous,
 count(*) filter(where e.outcome='invalid')::integer as invalid,count(*) filter(where e.outcome='error')::integer as errors,
 count(*) filter(where e.outcome='kept')::integer as kept,count(*) filter(where e.outcome='skipped')::integer as skipped,
 count(*) filter(where e.outcome='pending')::integer as pending
 from (select * from public.image_imports order by created_at desc limit 20) i join public.image_import_entries e on e.import_id=i.id group by i.id,i.created_by,i.source,i.rule,i.options,i.status,i.created_at,i.finished_at
 ) h),'[]'::jsonb);
end; $$;
revoke all on function public.start_image_import(uuid,text,text,jsonb,jsonb),public.commit_import_image(uuid,integer,uuid,text,text,text),public.record_image_import_result(uuid,integer,text,text),public.finish_image_import(uuid,text),public.admin_image_import_history() from public,anon;
grant execute on function public.start_image_import(uuid,text,text,jsonb,jsonb),public.commit_import_image(uuid,integer,uuid,text,text,text),public.record_image_import_result(uuid,integer,text,text),public.finish_image_import(uuid,text),public.admin_image_import_history() to authenticated;
notify pgrst,'reload schema';
commit;
