begin;
create table public.component_types (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check (name=trim(name) and char_length(name) between 1 and 80),
 created_at timestamptz not null default now()
);
create unique index component_types_normalized_name_idx on public.component_types
 (regexp_replace(translate(lower(name),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[[:space:]-]+','_','g'));
insert into public.component_types(name) values
 ('Relógio'),('Caixa'),('Fecho'),('Laço'),('Embalagem'),('Manual'),('Acessório'),('Outros');
alter table public.component_types enable row level security;
revoke all on public.component_types from public,anon,authenticated;
grant select,insert on public.component_types to authenticated;
create policy component_types_read on public.component_types for select to authenticated using ((select private.is_member()));
create policy component_types_insert on public.component_types for insert to authenticated with check ((select private.is_admin()));
alter table public.components
 drop constraint components_type_check,
 alter column type drop not null,
 alter column type set default null,
 add constraint components_type_fkey foreign key(type) references public.component_types(name) on update restrict on delete restrict;
-- Blank cells mean no classification, never an arbitrary type name.
create function private.clean_component_type() returns trigger language plpgsql set search_path='' as $$
begin new.type=nullif(trim(new.type),''); return new; end; $$;
create trigger clean_component_type before insert or update of type on public.components
 for each row execute function private.clean_component_type();
notify pgrst, 'reload schema';
commit;
