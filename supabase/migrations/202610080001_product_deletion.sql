begin;
alter table public.consultation_history alter column product_id drop not null;
alter table public.consultation_history drop constraint consultation_history_product_id_fkey;
alter table public.consultation_history add constraint consultation_history_product_id_fkey foreign key(product_id) references public.products(id) on delete set null;
create index if not exists history_product_idx on public.consultation_history(product_id);
-- Retry failed Storage API removals without deleting Storage metadata in SQL.
create table private.image_cleanup_queue(path text primary key,created_at timestamptz not null default now());
alter table private.image_cleanup_queue enable row level security;
revoke all on private.image_cleanup_queue from public,anon,authenticated;
create function public.admin_product_delete_preview(p_product_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products; links integer;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 select * into p from public.products where id=p_product_id for share;
 if not found then raise exception 'Produto não encontrado.'; end if;
 select count(*) into links from public.compositions where product_id=p.id;
 return jsonb_build_object('id',p.id,'code',p.code,'updated_at',p.updated_at,'links',links,'image_path',p.image_url,'image_shared',p.image_url is not null and (exists(select 1 from public.products where id<>p.id and image_url=p.image_url) or exists(select 1 from public.components where image_url=p.image_url)));
end; $$;
create function public.admin_delete_product(p_product_id uuid,p_expected_updated_at timestamptz,p_expected_links integer) returns void language plpgsql security definer set search_path='' as $$
declare p public.products; links integer;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 select * into p from public.products where id=p_product_id for update;
 if not found then raise exception 'Produto não encontrado.'; end if;
 select count(*) into links from public.compositions where product_id=p.id;
 if p_expected_updated_at is distinct from p.updated_at or p_expected_links is distinct from links then raise exception 'O produto ou sua composição mudou. Abra novamente a confirmação de exclusão.'; end if;
 delete from public.compositions where product_id=p.id;
 delete from public.products where id=p.id;
 if p.image_url is not null and not exists(select 1 from public.products where image_url=p.image_url) and not exists(select 1 from public.components where image_url=p.image_url) then insert into private.image_cleanup_queue(path) values(p.image_url) on conflict do nothing; end if;
end; $$;
create function public.admin_delete_kit_link(p_product_id uuid,p_component_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 perform 1 from public.products where id=p_product_id for update;
 if not found then raise exception 'Produto não encontrado.'; end if;
 delete from public.compositions where product_id=p_product_id and component_id=p_component_id;
 if not found then raise exception 'Vínculo não encontrado. Atualize a composição.'; end if;
end; $$;
create function public.admin_pending_image_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(path order by created_at) from (select path,created_at from private.image_cleanup_queue order by created_at limit 100) q),'[]'::jsonb);
end; $$;
create function public.admin_finish_image_cleanup(p_path text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
 if exists(select 1 from public.products where image_url=p_path) or exists(select 1 from public.components where image_url=p_path) or not exists(select 1 from storage.objects where bucket_id='product-images' and name=p_path) then delete from private.image_cleanup_queue where path=p_path; return true; end if;
 return false;
end; $$;
revoke all on function public.admin_product_delete_preview(uuid),public.admin_delete_product(uuid,timestamptz,integer),public.admin_delete_kit_link(uuid,uuid),public.admin_pending_image_cleanup(),public.admin_finish_image_cleanup(text) from public,anon;
grant execute on function public.admin_product_delete_preview(uuid),public.admin_delete_product(uuid,timestamptz,integer),public.admin_delete_kit_link(uuid,uuid),public.admin_pending_image_cleanup(),public.admin_finish_image_cleanup(text) to authenticated;
notify pgrst,'reload schema';
commit;
