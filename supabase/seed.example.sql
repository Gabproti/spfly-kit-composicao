-- EXEMPLO OPCIONAL. Não cadastrar dados ilustrativos em produção sem necessidade.
begin;
insert into public.products(code,description) values('123','Relógio Modelo 123') on conflict(code) do nothing;
insert into public.components(code,type,description) values
 ('123','Relógio','Relógio Modelo 123'),('1234','Caixa','Caixa Relógio 123'),('111','Fecho','Fecho Padrão'),('1489','Laço','Laço Vermelho') on conflict(code) do nothing;
insert into public.compositions(product_id,component_id,quantity,position)
select p.id,c.id,1,case c.code when '123' then 0 when '1234' then 1 when '111' then 2 else 3 end from public.products p cross join public.components c
where p.code='123' and c.code in ('123','1234','111','1489') on conflict(product_id,component_id) do nothing;
commit;
