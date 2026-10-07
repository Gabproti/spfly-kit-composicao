begin;
alter table public.products
  drop constraint products_description_check,
  alter column description set default '',
  add constraint products_description_check check (char_length(trim(description)) <= 300);
alter table public.components
  drop constraint components_description_check,
  alter column description set default '',
  add constraint components_description_check check (char_length(trim(description)) <= 300);
notify pgrst, 'reload schema';
commit;
