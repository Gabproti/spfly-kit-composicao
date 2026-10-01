begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 name text not null check (char_length(trim(name)) between 1 and 120),
 email text not null,
 role text not null default 'operator' check (role in ('admin','operator')),
 active boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (char_length(code) between 1 and 80 and code=trim(code)),
 description text not null check (char_length(trim(description)) between 1 and 300),
 image_url text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.components (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (char_length(code) between 1 and 80 and code=trim(code)),
 type text not null check (type in ('Relógio','Caixa','Fecho','Laço','Embalagem','Manual','Acessório','Outros')),
 description text not null check (char_length(trim(description)) between 1 and 300),
 image_url text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.compositions (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 component_id uuid not null references public.components(id) on delete restrict,
 quantity integer not null check (quantity between 1 and 9999),
 position integer not null default 0 check (position>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(product_id,component_id)
);
create index compositions_component_idx on public.compositions(component_id);
create table public.consultation_history (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 product_code text not null, created_at timestamptz not null default now()
);
create index history_date_idx on public.consultation_history(created_at desc);
create index history_code_date_idx on public.consultation_history(product_code,created_at desc);
create index history_user_date_idx on public.consultation_history(user_id,created_at desc);
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create function private.is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and active);
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and active and role='admin');
$$;
revoke all on function private.is_member(),private.is_admin() from public;
grant execute on function private.is_member(),private.is_admin() to authenticated;
create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end; $$;
create trigger touch_products before update on public.products for each row execute function private.touch_updated_at();
create trigger touch_components before update on public.components for each row execute function private.touch_updated_at();
create trigger touch_compositions before update on public.compositions for each row execute function private.touch_updated_at();
create trigger touch_profiles before update on public.profiles for each row execute function private.touch_updated_at();
-- Os metadados enviados pelo cliente nunca determinam o papel ou a ativação.
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
 begin insert into public.profiles(id,name,email,role,active) values(new.id,left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),split_part(new.email,'@',1),'Usuário'),120),coalesce(new.email,''),'operator',false); return new;end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
create function private.sync_user_email() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.profiles set email=coalesce(new.email,'') where id=new.id;return new;end; $$;
create trigger on_auth_email_changed after update of email on auth.users for each row execute function private.sync_user_email();
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.components enable row level security;
alter table public.compositions enable row level security;
alter table public.consultation_history enable row level security;
revoke all on public.profiles,public.products,public.components,public.compositions,public.consultation_history from anon,authenticated;
grant select on public.profiles,public.products,public.components,public.compositions,public.consultation_history to authenticated;
grant insert,update on public.products,public.components to authenticated;
-- Não há DELETE direto; composição e perfis são alterados apenas via RPC autorizada.
create policy profiles_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (select private.is_admin()));
create policy products_read on public.products for select to authenticated using ((select private.is_admin()) or (active and (select private.is_member())));
create policy products_insert on public.products for insert to authenticated with check ((select private.is_admin()));
create policy products_update on public.products for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy components_read on public.components for select to authenticated using ((select private.is_admin()) or (active and (select private.is_member()) and exists(select 1 from public.compositions c join public.products p on p.id=c.product_id where c.component_id=components.id and p.active)));
create policy components_insert on public.components for insert to authenticated with check ((select private.is_admin()));
create policy components_update on public.components for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy compositions_read on public.compositions for select to authenticated using ((select private.is_admin()) or ((select private.is_member()) and exists(select 1 from public.products p where p.id=compositions.product_id and p.active)));
create policy history_admin_read on public.consultation_history for select to authenticated using ((select private.is_admin()));

create function public.admin_set_profile(p_id uuid,p_name text,p_role text,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(8137001);
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 if p_role is null or p_role not in ('admin','operator') or p_active is null or p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'Dados de usuário inválidos.';end if;
 if p_id=auth.uid() and (p_role<>'admin' or not p_active) then raise exception 'Não é permitido desativar ou rebaixar seu próprio acesso administrativo.';end if;
 update public.profiles set name=trim(p_name),role=p_role,active=p_active where id=p_id;
 if not found then raise exception 'Usuário não encontrado.';end if;
 if not exists(select 1 from public.profiles where role='admin' and active) then raise exception 'Mantenha pelo menos um administrador ativo.';end if;
end;$$;

create function public.save_composition(p_product_id uuid,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; total integer;
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Composição inválida.';end if;
 if jsonb_array_length(p_items)>300 then raise exception 'Limite de 300 componentes por composição.';end if;
 perform 1 from public.products where id=p_product_id for update;
 if not found then raise exception 'Produto não encontrado.';end if;
 for item in select value from jsonb_array_elements(p_items) loop
   if item->>'component_id' is null or item->>'quantity' is null or (item->>'quantity') !~ '^[0-9]+$' then raise exception 'Informe componente e quantidade inteira.';end if;
   if (item->>'quantity')::numeric not between 1 and 9999 then raise exception 'A quantidade deve ser inteira, entre 1 e 9999.';end if;
   perform 1 from public.components where id=(item->>'component_id')::uuid and active for share;
   if not found then raise exception 'Selecione apenas componentes ativos.';end if;
 end loop;
 select count(distinct (value->>'component_id')::uuid) into total from jsonb_array_elements(p_items);
 if total<>jsonb_array_length(p_items) then raise exception 'Não é permitido repetir componente na mesma composição.';end if;
 delete from public.compositions where product_id=p_product_id;
 insert into public.compositions(product_id,component_id,quantity,position)
 select p_product_id,(value->>'component_id')::uuid,(value->>'quantity')::integer,(ordinality-1)::integer from jsonb_array_elements(p_items) with ordinality;
end;$$;

create function public.consult_kit(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare product public.products; items jsonb;
begin
 if not private.is_member() then raise exception 'Acesso indisponível.' using errcode='42501';end if;
 if p_code is null or char_length(trim(p_code)) not between 1 and 80 then return null;end if;
 select * into product from public.products where code=trim(p_code) and active for share;
 if not found then return null;end if;
 -- Não apresentar kits incompletos: um item desativado torna a composição indisponível.
 perform 1 from public.components c join public.compositions co on co.component_id=c.id where co.product_id=product.id for share of c;
 if exists(select 1 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id and not c.active) then return null;end if;
 select jsonb_agg(jsonb_build_object('code',c.code,'type',c.type,'description',c.description,'quantity',co.quantity) order by co.position,c.code) into items
 from public.compositions co join public.components c on c.id=co.component_id where co.product_id=product.id;
 if items is null then return null;end if;
 insert into public.consultation_history(user_id,product_id,product_code) values(auth.uid(),product.id,product.code);
 return jsonb_build_object('product',to_jsonb(product),'items',items);
end;$$;

create function public.dashboard_stats() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 return jsonb_build_object('products',(select count(*) from public.products where active),'components',(select count(*) from public.components where active),'compositions',(select count(distinct product_id) from public.compositions),'today',(select count(*) from public.consultation_history where created_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') and created_at < ((date_trunc('day',now() at time zone 'America/Sao_Paulo')+interval '1 day') at time zone 'America/Sao_Paulo')));
end;$$;
revoke all on function public.admin_set_profile(uuid,text,text,boolean), public.save_composition(uuid,jsonb),public.consult_kit(text),public.dashboard_stats() from public,anon;
grant execute on function public.admin_set_profile(uuid,text,text,boolean),public.save_composition(uuid,jsonb),public.consult_kit(text),public.dashboard_stats() to authenticated;

-- Bucket privado: a interface gera URLs assinadas para os usuários autorizados.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='product-images' and public) then
  raise exception 'O bucket product-images existente é público. Utilize um bucket privado antes de aplicar esta migração.';
 end if;
end;$$;
create policy images_read on storage.objects for select to authenticated using (bucket_id='product-images' and ((select private.is_admin()) or ((select private.is_member()) and (exists(select 1 from public.products p where p.active and p.image_url=name) or exists(select 1 from public.components c where c.active and c.image_url=name)))));
create policy images_insert on storage.objects for insert to authenticated with check (bucket_id='product-images' and (select private.is_admin()));
create policy images_update on storage.objects for update to authenticated using (bucket_id='product-images' and (select private.is_admin())) with check (bucket_id='product-images' and (select private.is_admin()));
create policy images_delete_orphan on storage.objects for delete to authenticated using (bucket_id='product-images' and (select private.is_admin()) and not exists(select 1 from public.products where image_url=name) and not exists(select 1 from public.components where image_url=name));
commit;
