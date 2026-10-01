-- 1. Crie o usuário inicial em Authentication > Users (dashboard Supabase).
-- 2. Substitua SOMENTE o e-mail abaixo pelo e-mail real desse usuário.
-- 3. Execute no SQL Editor, com acesso de proprietário ao projeto.
-- Nunca execute automaticamente com um e-mail não confirmado pelo proprietário.
do $$
declare target_id uuid;
begin
 select id into target_id from auth.users where lower(email)=lower('gabriel.ferreira@spfly.com.br');
 if target_id is null then raise exception 'Crie primeiro o usuário no Supabase Auth e confira o e-mail.';end if;
 insert into public.profiles(id,name,email,role,active)
 select id,coalesce(nullif(raw_user_meta_data->>'name',''),'Administrador'),email,'admin',true from auth.users where id=target_id
 on conflict(id) do update set role='admin',active=true;
end;$$;
