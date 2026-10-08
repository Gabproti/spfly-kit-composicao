# SPFLY — Consulta e composição de kits

V1 em React, TypeScript, Vite e Supabase, para tablets e desktop. Não usa Firebase.

## Entrega e estado atual

Implementados: login/logout, perfis admin/operator, painel, produtos e componentes com imagem e ativação, editor transacional de composição, administração de usuários, consulta de kit com foto, nova consulta e histórico com filtros/paginação.

O código compila localmente e os 13 testes SQL passaram em PostgreSQL local via PGlite. O código foi enviado ao repositório informado pelo proprietário, que autorizou torná-lo público para usar GitHub Pages. A migração, as policies RLS e o bucket privado foram aplicados ao projeto Supabase zhkxasnyqpccabaharas. A Edge Function admin-users foi publicada com validação explícita do token e origens autorizadas. Chamadas anônimas às cinco tabelas e chamadas sem token ou com token inválido à função foram bloqueadas com HTTP 401. Login por e-mail está habilitado; cadastro público e login anônimo estão desabilitados. O usuário gabriel.ferreira@spfly.com.br foi criado pelo proprietário e seu perfil foi confirmado como admin ativo. O proprietário confirmou o primeiro login e a presença do menu Importações. **Os testes integrados de gravação, fotos e criação de operadores ainda estão pendentes de um lote real.** Não há senha padrão nem dados de demonstração inseridos.

## 1. Estrutura

```text
spfly-kits/
├── src/
│   ├── App.tsx               # sessão, perfil e navegação
│   ├── main.tsx
│   ├── styles.css            # tablet/desktop, identidade SPFLY
│   ├── components/UI.tsx     # modal, imagens privadas, status
│   ├── lib/                  # Supabase, tipos, datas
│   └── pages/
│       ├── Login.tsx
│       ├── Consult.tsx
│       ├── Dashboard.tsx
│       ├── Catalog.tsx       # produtos e componentes
│       ├── Compositions.tsx
│       ├── Users.tsx
│       └── History.tsx
├── supabase/
│   ├── migrations/202610010001_initial.sql
│   ├── functions/admin-users/index.ts
│   ├── config.toml
│   ├── bootstrap-admin.sql
│   └── seed.example.sql      # exemplo opcional
├── tests/database.test.mjs
├── public/favicon.svg
├── .env.example
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── package.json
```

## 2. Execução local

Use Node.js 22.12+ e pnpm 11.19+ (o lockfile da entrega usa pnpm).

```sh
pnpm install
cp .env.example .env
pnpm dev
```

No PowerShell, substitua `cp` por `Copy-Item .env.example .env`. Preencha `.env` antes de iniciar; reinicie o servidor após alterar variáveis.

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICAVEL_OU_ANON
```

Essas duas variáveis são públicas e entram no JavaScript compilado. **Nunca use service_role, secret key, senha do banco ou access token em variáveis VITE\_.** A autorização depende de RLS e funções no Supabase, não da confidencialidade da chave pública. Sem configuração, a aplicação apresenta uma tela de instrução em vez de simular dados.

```sh
pnpm test
pnpm build
pnpm preview
```

## 3. Banco e SQL

Confira se o projeto é o correto e se não existem tabelas conflitantes antes de executar a primeira migração. Ela é destinada a um schema novo; não substitui nem apaga tabelas preexistentes. Execute o conteúdo de `supabase/migrations/202610010001_initial.sql` no SQL Editor do Supabase, uma única vez, ou use a CLI vinculada ao projeto:

```sh
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

| Tabela               | Campos principais                                                        | Regras                                                  |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| products             | id, code, description, image_url, active, created_at, updated_at         | Código único textual; zeros preservados                 |
| components           | id, code, type, description, image_url, active, created_at, updated_at   | Código único, tipo validado                             |
| compositions         | id, product_id, component_id, quantity, position, created_at, updated_at | Par produto/componente único; quantidade inteira 1–9999 |
| profiles             | id, name, email, role, active, created_at, updated_at                    | id referencia Auth; papel admin/operator                |
| consultation_history | id, user_id, product_id, product_code, created_at                        | Apenas consultas válidas via RPC                        |

Relacionamento: `products → compositions → components`. Histórico referencia produto e perfil. FKs usam RESTRICT para evitar perda de registros relacionados. Campos `image_url` contêm o **caminho no bucket privado**, não uma URL pública permanente.

Regras adicionais: produtos sem composição não aparecem na consulta; produto inativo ou qualquer componente inativo torna o kit indisponível, para impedir conferência de um kit incompleto. O relógio principal só aparece entre os itens quando cadastrado como componente, como no exemplo da especificação. Composições preservam a ordem em `position`. Consulta e registro do histórico ocorrem na mesma transação. Data/hora e indicadores do dia usam America/Sao_Paulo.

## 4. Policies RLS e funções

RLS está ativada nas cinco tabelas. Nenhuma tabela é acessível ao papel anon. Administradores e operadores precisam de perfil ativo. Os helpers de autorização consultam a tabela de perfis no banco, com search_path fixado; alterações de papel são consideradas na próxima operação, sem esperar um novo JWT.

| Recurso     | Admin ativo                                 | Operador ativo                                     |
| ----------- | ------------------------------------------- | -------------------------------------------------- |
| Produtos    | Ler, inserir, editar/inativar               | Ler ativos                                         |
| Componentes | Ler, inserir, editar/inativar               | Ler ativos associados aos produtos ativos          |
| Composições | Ler e substituir via save_composition       | Ler composições de produtos ativos                 |
| Perfis      | Ler todos; editar via admin_set_profile     | Ler apenas o próprio perfil                        |
| Histórico   | Ler                                         | Sem SELECT/INSERT direto; registro via consult_kit |
| Fotos       | Upload, leitura, atualização, excluir órfãs | Ler fotos autorizadas com URL assinada             |

Não existem grants de DELETE para cadastros nem INSERT/UPDATE direto de perfis/composições pelo cliente. Operações administrativas são verificadas nas RPCs. Novos usuários do Auth recebem perfil **operator inativo**, mesmo quando metadados enviados pelo cliente dizem `admin`. O fluxo administrativo ativa o perfil depois de validar o administrador. O administrador não pode desativar ou rebaixar seu próprio acesso. A alteração de perfis usa um lock transacional e mantém pelo menos um admin ativo.

RPCs: `consult_kit(p_code)`, `save_composition(p_product_id,p_items)`, `admin_set_profile(p_id,p_name,p_role,p_active)`, `dashboard_stats()`. Todos os detalhes, grants e nomes das policies estão na migração entregue. `save_composition` valida os itens antes de substituir a composição e reverte tudo se houver erro.

## 5. Auth e administrador inicial

1. Em Authentication → Providers, habilite login por e-mail/senha.
2. Desabilite cadastro público em Authentication para manter criação de contas exclusiva do administrador. Mesmo que fique habilitado, o trigger deixa novos perfis inativos e sem acesso aos kits.
3. No painel Authentication → Users, crie o usuário inicial com seu e-mail real e uma senha forte. Não existe senha padrão.
4. Substitua o e-mail indicado em `supabase/bootstrap-admin.sql` pelo e-mail desse usuário e execute no SQL Editor como proprietário.
5. Faça login na aplicação. O perfil admin abre o painel; operator abre a consulta.

O e-mail inicial deve ser informado pelo proprietário. Não publique credenciais no repositório. O bootstrap é uma ação de proprietário, fora da API pública; não existe endpoint aberto para criar o primeiro administrador.

## 6. Cadastro administrativo de usuários

A função `admin-users` roda no Supabase e utiliza a service_role apenas no servidor. Ela verifica o token via `auth.getUser`, valida perfil admin ativo e ativa o novo perfil via RPC como o próprio administrador. Nenhuma chave secreta é enviada ao browser. Se a ativação falhar, a conta permanece sem acesso e a função tenta limpar o cadastro incompleto.

Publique após definir as origens autorizadas:

```sh
supabase secrets set ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173,https://SEU-DOMINIO"
supabase functions deploy admin-users
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente das Edge Functions. `ALLOWED_ORIGINS` é uma lista sem barras finais, separada por vírgulas. Acrescente a origem da hospedagem real. O config define `verify_jwt=false` porque a função faz validação explícita pelo Auth, compatível com as chaves atuais; **isso não torna a função anônima**, pois o handler exige e valida Bearer token antes de qualquer ação.

Novos usuários são confirmados pelo administrador e recebem a senha inicial definida por ele (mínimo 12 caracteres). Entregue-a por canal privado. Não há envio automático de e-mail ou fluxo adicional de recuperação nesta V1.

## 7. Supabase Storage

A migração cria o bucket `product-images` **privado**, com limite de 5 MB e MIME JPG/PNG/WebP. Não o torne público. O formulário gera um nome UUID, valida o arquivo, faz upload e salva o caminho no cadastro. Fotos são exibidas por URLs assinadas de uma hora. A consulta pode ser refeita para renovar a referência. Remover imagem desvincula-a do cadastro; arquivos antigos ficam como órfãos e podem ser removidos pelo administrador quando não forem usados por outro registro. A policy bloqueia exclusão de imagens ainda referenciadas.

## 8. GitHub e hospedagem

Repositório: https://github.com/Gabproti/spfly-kit-composicao (código enviado à branch main).

Endereço do GitHub Pages: https://gabproti.github.io/spfly-kit-composicao/ . O workflow .github/workflows/pages.yml testa, compila e publica a branch main. A página de login é pública; somente contas com perfil ativo conseguem acessar dados e fotos no Supabase. Cadastre cada pessoa em Usuários antes de compartilhar o acesso. A origem https://gabproti.github.io foi autorizada em ALLOWED_ORIGINS; Site URL e retorno permitido do Auth apontam para o endereço acima. A prévia privada anterior em Sites foi substituída por essa publicação para uso entre máquinas.

Antes de enviar, autentique o GitHub por Git Credential Manager, GitHub CLI (`gh auth login`) ou pelo conector GitHub. Não inclua tokens em URLs nem no código. Se o repositório já tiver arquivos, clone-o e preserve esses arquivos antes de incorporar o projeto. Não use force push.

Para um repositório vazio, no diretório deste projeto:

```sh
git init -b main
git add .
git commit -m "feat: sistema SPFLY de consulta e composição de kits"
git remote add origin https://github.com/Gabproti/spfly-kit-composicao.git
git push -u origin main
```

Para hospedagem estática com Vite, configure instalação `pnpm install --frozen-lockfile`, build `pnpm build` e pasta de saída `dist`. Defina as duas variáveis VITE_ na plataforma **antes do build**. Acrescente a URL real em ALLOWED_ORIGINS da função. Configure Site URL e URLs permitidas no Supabase Auth para a origem publicada. A aplicação usa navegação interna sem rotas de caminho, por isso não requer regras especiais de rewrite. Use HTTPS para o tablet.

## 9. Checklist de teste integrado

- [x] Configurar Supabase, aplicar migração e publicar admin-users.
- [x] Criar primeiro admin no Auth e executar bootstrap com e-mail real.
- [ ] Login inválido apresenta mensagem amigável; logout encerra a sessão.
- [ ] Admin vê as seis seções administrativas e a consulta.
- [ ] Cadastrar produto 123 com foto; editar, inativar e ativar.
- [ ] Cadastrar relógio 123, caixa 1234, fecho 111 e laço 1489 como componentes.
- [ ] Criar composição; duplicação bloqueada; quantidade 0 ou fracionária rejeitada.
- [ ] Remover componente e salvar; confirmar persistência ao selecionar de novo.
- [ ] Criar operador no painel; perfil operator ativo é salvo.
- [ ] Operador vê apenas consulta; não vê dashboard nem cadastros.
- [ ] Consultar 123; conferir foto, códigos, descrições, ordem e quantidades.
- [ ] Nova consulta limpa resultado e devolve foco ao campo.
- [ ] Código inexistente, sem composição, produto inativo e componente inativo não retornam kit.
- [ ] Consulta válida aparece no histórico; filtros código/usuário/data funcionam.
- [ ] Painel conta produtos ativos, componentes ativos, kits distintos e consultas do dia.
- [ ] Inativar operador; a próxima consulta/ação é negada pelo banco.
- [ ] Tentar RPC administrativa e alterações diretas como operador: nenhuma alteração permitida.
- [ ] Foto não pode ser acessada anonimamente; upload do operador é negado.
- [ ] Cadastro de usuário pela Edge Function sem token/com operator recebe 401/403.
- [ ] Verificar toque, tabulação, mensagens e ausência de rolagem horizontal de página em tablet 768×1024 e desktop.

## Importação de dados e fotos

A área **Importações** está disponível apenas para administradores. Ela usa as permissões RLS existentes, sem chaves de serviço no navegador. Para importação incremental de kits e imagens dos componentes na consulta, aplique `supabase/migrations/202610070001_kit_import.sql` após a migração inicial. Essa atualização não exclui dados.

1. Selecione Produtos, Componentes ou Composições e baixe o modelo Excel na tela.
2. Preencha os códigos como texto, preservando zeros à esquerda. Use a primeira aba do Excel (.xlsx) ou CSV UTF-8 com cabeçalho, até 10 MB e 5.000 linhas.
3. Importe produtos e componentes antes das composições. Confira a prévia; erros e duplicidades precisam ser corrigidos antes da gravação.
4. Confirme a importação. Por padrão, códigos já cadastrados são ignorados; marque a opção de atualização para alterar descrição, tipo e status. Fotos são preservadas. Status vazio mantém o cadastro existente e cria registros novos ativos.
5. Para composições, a primeira coluna contém o código do produto; todas as demais contêm códigos de componentes, com quantidade variável de colunas. Células vazias são ignoradas; produtos podem aparecer em várias linhas. Apenas pares produto/componente repetidos são duplicidades. A prévia identifica novos vínculos, existentes, códigos ausentes e inativos. Confirme para adicionar somente os vínculos válidos, com quantidade 1, sem alterar relações ou quantidades existentes. O editor manual em Composições continua sendo a ação explícita para editar/remover itens.
6. Para fotos, use **Produtos → Importar imagens** ou a seção de fotos em Importações. Selecione um ZIP ou arquivos JPG/PNG/WebP. Veja as regras e limites na seção “Importação flexível de imagens” abaixo.
7. Baixe o relatório CSV com o resultado de todas as linhas ou fotos. A prévia de cadastros mostra as primeiras 100 entradas; a prévia de imagens permite navegar por todas em páginas de 100. Cada cadastro/foto é gravado separadamente e cada composição é salva em transação própria; uma falha não desfaz gravações anteriores. Não feche a página durante o processamento.

Cabeçalhos: produtos `codigo, descricao, ativo`; componentes `codigo, tipo, descricao, ativo`; kits, por exemplo, `CODIGO_PRODUTO, COMPONENTE_1, COMPONENTE_2, ...`. Nos kits a posição das colunas determina a interpretação, independente do nome do cabeçalho. O campo ativo dos cadastros aceita sim/não, true/false, 1/0 ou ativo/inativo. Fórmulas em XLSX são rejeitadas; converta-as em valores antes de importar.

Kits: até 10 MB, 50.000 linhas e 100.000 relações por arquivo. A prévia exibe 200 relações e o relatório CSV inclui todas. Cadastros e relações existentes são lidos em páginas, validados em memória e gravados em lotes de 500 por `import_kit_links`. O servidor verifica novamente existência, atividade e permissão administrativa; a restrição única existente impede duplicação. Cada lote é uma transação. Em caso de falha, os lotes concluídos são preservados e repetir a importação é seguro. Produtos e componentes não são criados nem alterados pela importação de kits. A consulta retorna todas as relações e a imagem de cada componente, mantendo imagens privadas com URLs assinadas.

Validação da atualização: compilação passou e 18 testes passaram, incluindo CSV com BOM/acentos/aspas, preservação de zeros, duplicidades, quantidades, tipos e leitura de Excel. O envio autenticado de dados/fotos ainda precisa ser validado com um lote real fornecido pelo proprietário. A publicação pelo GitHub Pages inclui a área de importações. O workflow utiliza somente URL e chave pública do Supabase; credenciais secretas permanecem no servidor.

## 10. Validação e limites

Os testes executam a migração SQL real em PGlite com roles anon/authenticated, um schema Auth/Storage mínimo e identidades simuladas. Cobrem RLS, rollback, duplicação, quantidades, consultas, histórico e acesso a arquivos. Isso valida a lógica SQL; não substitui os testes no Auth, Storage e Edge Functions do Supabase hospedado nem ensaios de concorrência reais. A conexão com o Auth e a recusa de chamadas não autenticadas na API e na Edge Function foram validadas no projeto hospedado. A conta inicial está ativa. O proprietário confirmou o login e o menu administrativo. Os testes autenticados de Storage e criação de usuários continuam pendentes.

Não há dados de demonstração misturados com produção. `seed.example.sql` é opcional e serve apenas para testar a composição de exemplo; cadastre uma foto real do produto para conferência física. A arquitetura recebe código textual e Enter, permitindo futura integração com leitores que emulam teclado, sem adicionar uma função de leitura não solicitada.

Referências técnicas: https://supabase.com/docs/guides/database/postgres/row-level-security, https://supabase.com/docs/guides/functions/auth-legacy-jwt, https://vite.dev/guide/env-and-mode.

### Descrição opcional
Aplique `supabase/migrations/202610070002_optional_description.sql` para permitir descrições vazias em produtos e componentes. O cadastro manual e a importação aceitam descrição vazia; a coluna `descricao` pode ser omitida. Ao atualizar por uma planilha sem essa coluna, a descrição existente é preservada. O limite de 300 caracteres permanece.

### Tipos de componentes
Aplique `supabase/migrations/202610070003_component_types.sql` após as anteriores. A lista fixa foi migrada para `component_types`, mantendo os oito tipos existentes. Administradores criam tipos em **Tipos de componentes**. Componentes aceitam tipo em branco/nulo, inclusive importação sem coluna `tipo`; a classificação pode ser feita depois em **Componentes → Editar → Tipo**. Tipos informados na planilha precisam estar cadastrados. Omitir a coluna ao atualizar preserva a classificação existente; uma célula vazia explícita remove a classificação. RLS bloqueia criação por operadores/inativos/anônimos, e a FK impede tipos inexistentes. Tipos sem classificação aparecem como “Sem tipo” e continuam disponíveis na consulta de kits.

### Exclusões administrativas

Aplicar a migração `202610080001_product_deletion.sql` antes de publicar esta atualização.

- Em Produtos, Excluir abre uma confirmação com o código, o total de vínculos e o impacto na foto. Excluir definitivamente remove apenas o produto e seus vínculos; componentes e histórico de consultas são preservados.
- Em Composições, a lixeira confirma e exclui somente o vínculo selecionado. Salve alterações pendentes antes de excluir vínculos existentes. Itens ainda não salvos são removidos apenas da edição.
- Fotos compartilhadas são preservadas. Fotos exclusivas são removidas pela API do Storage; falhas ficam registradas numa fila privada e podem ser tentadas novamente ao abrir Produtos ou pelo botão de nova tentativa.
- As funções conferem o acesso administrativo no servidor. A exclusão de produto é rejeitada se o cadastro ou o total de vínculos mudou após a prévia. Exclusões diretas nas tabelas continuam bloqueadas.
- A exclusão preserva os históricos, inclusive a referência textual de produtos excluídos nas importações de imagens.

### Importação flexível de imagens

Aplicar `supabase/migrations/20261008143847_photo_import.sql` após as migrações anteriores e antes de publicar o frontend.

- **Produtos → Importar imagens** aceita um ZIP de até 100 MB ou imagens avulsas; até 5.000 arquivos, 5 MB por foto e 200 MB extraídos. Arquivos ocultos e metadados do macOS são ignorados. Formatos inválidos aparecem no relatório. A extração limita os bytes descomprimidos efetivamente lidos, sem extrair para o disco.
- Correspondência exata sempre vence. As regras selecionáveis são: exata, remover N final da imagem, remover último caractere, remover primeiro caractere, normalização controlada e personalizada. Normalização testa as transformações separadamente e exige um único produto distinto. Personalizada remove a quantidade explicitamente escolhida no início e/ou final. Maiúsculas, minúsculas e zeros são preservados; códigos oficiais não são modificados.
- A prévia mostra arquivo, código identificado, produto, regra realmente aplicada e status. “Escolher produto” permite vínculo manual por busca. Produtos já fotografados exigem manter, substituir ou cancelar esse arquivo. Fotos concorrentes para o mesmo produto precisam ser resolvidas antes de confirmar.
- Produtos são lidos em páginas uma única vez por análise. O envio sequencial limita memória e carga; pode ser interrompido após o arquivo em andamento. Repetir arquivos pendentes usa recibos idempotentes; para modificar uma prévia já iniciada, use “Analisar novamente”. Uma mudança na foto do produto após a prévia impede a substituição.
- As tabelas de histórico têm RLS, leitura apenas administrativa e mutações por funções com autorização própria e search_path fixo. O vínculo e seu recibo são gravados na mesma transação. Fotos antigas exclusivas entram na fila de limpeza já existente; fotos compartilhadas são preservadas. O bucket privado product-images e suas políticas são reutilizados.
- “Histórico de imagens” mostra as últimas 20 importações com contagens por resultado e CSV de todas as entradas, incluindo a regra efetivamente usada. Vínculos manuais aparecem como manual. Não encontrados, ambíguos e inválidos não são vinculados automaticamente.
- Validação: 58 testes automatizados e compilação aprovados. Inclui os quatro exemplos de N adicional, exata prioritária, ambiguidade, regras sem encadeamento, ZIP com expansão acima do limite, RLS, conflito de prévia, recibos idempotentes e preservação do código/histórico. O upload autenticado de um ZIP real ainda deve ser conferido no ambiente publicado.

### Recuperação e redefinição de senha

- Login: Esqueci minha senha envia o link de recuperação para o e-mail informado. A resposta não confirma se a conta existe.
- O link abre a tela Redefinir senha; a senha deve ter entre 12 e 128 caracteres e a confirmação deve coincidir. Links inválidos ou expirados não habilitam a alteração. Ao concluir, o usuário volta ao login.
- Usuários → Redefinir senha permite solicitar o link por e-mail ou definir uma nova senha diretamente, com confirmação. A alteração direta usa a função admin-users, que valida a sessão e o perfil administrativo ativo antes de chamar a API administrativa do Auth. Não modifica perfil, e-mail ou status de ativação.
- Publicar novamente `supabase/functions/admin-users/index.ts`. A chave de serviço permanece apenas no servidor; manter os segredos e a configuração de CORS existentes. A função continua aceitando o cadastro de novos usuários.
- Em Supabase Auth → URL Configuration, manter a Site URL `https://gabproti.github.io/spfly-kit-composicao/` e permitir essa URL de retorno (também `http://127.0.0.1:5173/` para desenvolvimento).
- Validar a entrega de e-mails de recuperação no ambiente publicado. Se o projeto estiver usando o serviço padrão do Supabase com restrição de destinatários ou limite de envio, configurar SMTP próprio no painel antes de oferecer recuperação para todos os usuários. Não incluir credenciais SMTP no frontend ou neste repositório.
- Referência do fluxo Auth: [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).
- Os testes automatizados simulam a função administrativa e validam os bloqueios de acesso; não enviam e-mails nem alteram senhas de contas reais.
