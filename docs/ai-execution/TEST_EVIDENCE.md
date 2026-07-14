# Evidencias de Teste

## Ultima evidencia local registrada

- Testes: 32 arquivos, 447 testes aprovados.
- Build: aprovado pelo `tsc -b` e `vite build`.
- Lint: 0 erros e 430 warnings.
- Sintaxe do backend: `node --check local-auth-server.mjs` aprovado.
- Testes de invariantes de seguranca: 5 aprovados.
- Healthcheck local: PostgreSQL respondeu; auth em `127.0.0.1:8000` indisponivel. A execucao direta do Node retornou `EPERM` no caminho Windows com espaco dentro deste sandbox.

## Evidencia da rodada atual

- Guard de isolamento do proxy: 4 testes aprovados (`npm run test:security`).
- Suíte unitária: 32 arquivos, 476 testes aprovados (`npm run test`).
- Cobertura: 32 arquivos, 476 testes aprovados; todos os thresholds por serviço atendidos (`npm run test:unit:coverage`).
- Cobertura dirigida adicionada para pacientes, tabelas de preço, convênios, LGPD, e-mail e DICOM.
- Type-check: aprovado (`npm run type-check`).
- Build: aprovado (`npm run build`); permanecem apenas avisos de chunk dinâmico já existentes.
- Lint: concluído sem erros; 485 warnings históricos permanecem registrados.
- Commit funcional mais recente: `086c120` na branch `codex/tenant-scope-hardening-d551c8e`.
- Correção aplicada: `PATCH` não pode alterar `company_id`; inserções continuam derivando o tenant do perfil autenticado.
- Correção do CI: a etapa de migração agora usa diretamente `DATABASE_URL`, incluindo a porta publicada `54322` do serviço PostgreSQL; antes, o comando ignorava essa variável e tentava conectar em `localhost:5432`.

## Evidencia VPS somente leitura

- Data da verificação: 2026-07-13.
- PostgreSQL escutando em `127.0.0.1:5432`.
- Backend `prontomedic-auth` online no PM2 e escutando em `0.0.0.0:8000`.
- `GET /auth/v1/settings`: HTTP 200.
- Frontend via Nginx: HTTP 200.
- `nginx -t`: sintaxe válida.

Essa evidencia confirma disponibilidade da infraestrutura, mas nao substitui login real, teste negativo entre dois tenants ou rollback reproduzivel.

- Runner P0 adicionado em `scripts/tenant-isolation-integration.mjs`; execucao contra dois usuarios reais ainda pendente de credenciais autorizadas para tenants distintos.

## Evidencia VPS registrada pelo usuario

- SSH funcional com a chave de reset.
- Release `37199ee` criada.
- Build concluido.
- Migracoes executadas.
- Contagens observadas: 992 convenios, 395 planos, 313 XML TISS, 6 protocolos, 3 glosas.
- Nginx validado e recarregado.
- Wrapper apresentou erro posterior de CRLF; o shell de deploy foi corrigido localmente.

## Evidencia ausente

- Healthcheck final do backend apos a ultima publicacao.
- Login real com perfil operacional.
- Teste negativo de isolamento entre empresas.
- Dry-run real de reconciliacao DataSIGH.
- CI verde no commit mais recente (a execução ainda não foi associada pelo GitHub ao SHA `fef2264`).
- O replay do CI confirmou a correção da porta, da ordem das tabelas e das roles, e encontrou `auth.uid()` ausente no PostgreSQL limpo. A compatibilidade agora cria a função inerte apenas quando ela não existe, preservando a implementação Supabase; novo CI ainda pendente.
- O replay seguinte chegou ao módulo de agendamento e encontrou `professional_schedules` referenciada sem migration de criação; foi adicionada uma fundação idempotente para as janelas de disponibilidade.
- O replay seguinte chegou à recepção e encontrou as tabelas operacionais de autorização/elegibilidade ausentes; foi adicionada a fundação idempotente que alimenta o registro central de convênios.
- O replay seguinte chegou ao ledger oficial de Convênios e identificou `quantity_used` ausente no registro operacional; a coluna foi adicionada para controlar autorizado versus utilizado.
- A execução GitHub `29218077341` observada no navegador pertence ao PR #1 (`pull/1/merge`, head `2652fad`), não ao PR #2 atual; sua falha E2E financeira não deve ser atribuída ao head `eb793a6`.
- A auditoria do branch atual confirma migrations para `price_tables`, `professional_payments`, `exames_lab_catalogo`, `scheduling_waitlist`, `scheduling_blocks`, `reception_authorizations`, `reception_eligibility_checks` e compatibilidade operacional de TISS.
- O workflow `.github/workflows/ci.yml` permite `workflow_dispatch`, mas ainda não há execução verde associada ao head `c873dac`.
- O status Vercel do head está em falha por limite de build (`build-rate-limit`); esse bloqueio externo não foi tratado como aprovação ou falha do gate de testes.
- O workflow manual `F1 runtime gate` foi adicionado em `.github/workflows/f1-runtime-gate.yml`; ele falha explicitamente quando algum Secret obrigatório estiver ausente e não imprime valores sensíveis.
- Hardening estático adicionado em `scripts/bootstrap-base-tables.sql` e coberto por `bootstrap-security.test.mjs`: ausência de claim não escolhe usuário e não assume `service_role`; `anon` não recebe `GRANT ALL`.
- `npm run test:security` foi tentado nesta rodada, mas o runtime Node falhou antes de carregar os testes com `EPERM` ao resolver `C:\Users\Meu Computador`; resultado não foi contado como aprovação.
- A migration `20251231000050_auth_compatibility.sql` foi reforçada para replay limpo; a tabela compatível agora cobre todos os campos consumidos por `scripts/seed-e2e-users.sql` e `local-auth-server.mjs`.
- O workflow `CI` recebeu uma etapa explícita de seed E2E e verificação das colunas críticas de `auth.users` no PostgreSQL efêmero; essa evidência ainda aguarda execução no GitHub.
- O backend passou a usar `databaseFailure()` para não devolver mensagens SQL ao cliente; o novo `auth-server-security.test.mjs` cobre esse contrato. A execução ainda aguarda o runner GitHub devido ao bloqueio local do Node.
- Commit desta rodada: `10e8d47`.
- Correção funcional: Empresas & Unidades agora gravam empresa/unidade de verdade; a migration `20260713000000_companies_legal_name.sql` preserva a razão social e a tela resolve o nome da empresa vinculada à unidade.
- Validação desta rodada: `git diff --check` aprovado. `npm run type-check` não iniciou o TypeScript por `EPERM: lstat 'C:\\Users\\Meu Computador'`; não registrar como aprovação de compilação.
- Commit seguinte: `a822a7c`; os botões Editar de Empresas/Unidades passaram a persistir atualizações, com escopo de tenant na unidade. `git diff --check` permaneceu aprovado.
- Commit seguinte: `7eeeb66`; Especialidades agora possuem criação e edição persistentes. `git diff --check` permaneceu aprovado; compilação continua aguardando ambiente Node funcional.
- Commit seguinte: `4657b75`; a ação de perfis em Configurações agora abre o gerenciador real. `git diff --check` aprovado.
- Commit seguinte: `6c11d3a`; a contagem de permissões dos perfis agora vem de `role_permissions`, sem valor estimado fixo. `git diff --check` aprovado.
- Commit seguinte: `163cd47`; o fluxo 2FA passou a falhar fechado e não concede acesso sem validação no servidor. `git diff --check` aprovado.
- Commit de evidência atual: `4ce786f`; documentação sincronizada com o head funcional e a correção 2FA permanece registrada.
- Commit funcional atual: `663be0f`; envio de recurso TISS sem endpoint não simula sucesso. `git diff --check` aprovado.
- Commit funcional atual: `1fdedac`; respostas TISS sem protocolo real não são marcadas como concluídas. `git diff --check` aprovado.
- Commit funcional atual: `086c120`; assinatura de prescrição sem pipeline real de PDF/Storage falha fechado e não persiste assinatura nem receita. `git diff --check` aprovado.
- Commit de teste atual: `d23b8c9`; teste unitário cobre a falha fechada da assinatura e a ausência de efeitos persistidos. `git diff --check` aprovado; execução local do Vitest bloqueada por `EPERM: lstat 'C:\\Users\\Meu Computador'` antes de carregar o runner.
- Commit funcional atual: `d53e5de`; gravação de telemedicina sem integração real falha fechado e não registra consentimento como ativa; teste unitário adicionado. `git diff --check` aprovado; execução local do Vitest permanece bloqueada por `EPERM` do Node.
- Commit funcional atual: `d132b97`; criação de sala exige confirmação do Daily.co e marca falha sem liberar consulta quando o provedor está indisponível. Lint: 0 erros e 490 avisos históricos; `git diff --check` aprovado; Vitest permanece bloqueado por `EPERM` do Node.
- Commit funcional atual: `25d9f49`; chatbot clínico falha fechado sem resposta simulada e possui teste de tentativa registrada sem conteúdo. `git diff --check` aprovado; Vitest permanece bloqueado por `EPERM` do Node.
- CI do commit `124fac1`: migrations, type-check, lint e build aprovados; suíte unitária falhou em 1 teste de Telemedicina (mock não cobria a segunda chamada Supabase). Correção em `241f2fa`; novo CI pendente.
- CI do commit `083bc83`: migrations, type-check, lint e build aprovados; suíte unitária falhou em 1 asserção porque o mock não retornava a URL após o update. Correção em `6c87d4c`; novo CI pendente.
- CI do commit `b780c50`: migrations, type-check, lint, build, 480 testes unitários e segurança aprovados; E2E bloqueado por Secrets ausentes. Correção do workflow em `b83cab2` torna o gate explícito e evita falha de a11y sem relatório.

## Evidencia do head 66edb4b

- CI GitHub run `29288812014` (#406): migrations, type-check, lint, build, testes unitarios, seguranca do proxy e cobertura aprovados.
- O gate de credenciais E2E terminou com sucesso, mas Playwright e a11y foram pulados por ausencia de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nos Secrets do repositorio.
- `npm run secret:scan` local: aprovado, sem segredo conhecido no escopo analisado.
- Senha literal removida de `PRONTOMEDIC_VPS_CRONOGRAMA.md`; senhas devem ser fornecidas fora do repositorio.
- O resultado nao substitui o gate F1 com dois tenants reais.

## Evidencia F1 efemera executavel

- Commit: `d286fbf`.
- Workflow: `F1 ephemeral tenant gate`, run `29295965946` (#4), conclusao `success`.
- Job: `Tenant isolation on clean PostgreSQL`, job `86969419244`, todas as etapas concluídas com sucesso.
- Ambiente: PostgreSQL 18 limpo, migrations do repositorio, fixture sintetica de dois tenants e auth proxy local; nenhum acesso ao DataSIGH ou à VPS.
- Resultado: login dos dois usuarios, perfis em empresas distintas, paciente controlado visivel apenas no tenant A, contagem cross-tenant zerada, insert cross-tenant rejeitado, PATCH cross-tenant sem mutacao e `company_id` cross-tenant rejeitado.
- CI geral do mesmo commit: run `29295965906` (#411), concluido com sucesso.

Essa evidencia prova o comportamento reproduzivel do proxy em banco limpo. O gate de produção permanece aberto para RLS/owner/BYPASSRLS em runtime real, login real, reconciliacao read-only do DataSIGH, integrações externas e rollback.

## Revisao final do gate efemero

- Commit final: `b74f4da`.
- F1 ephemeral tenant gate: run `29296309572` (#8), `success`.
- CI geral: run `29296309584` (#413), `success`.
- A fixture exige flag explicita de banco descartavel, e as credenciais sinteticas sao geradas em runtime do runner.
- `auth.uid()` da compatibilidade de replay agora le o claim transacional quando presente, sem substituir `auth.uid()` de uma instalacao Supabase existente.

### Contrato operacional do gate F1

- Secrets requeridos: `PRONTOMEDIC_E2E_BASE_URL`, `PRONTOMEDIC_ANON_KEY`, `PRONTOMEDIC_TENANT_A_EMAIL`, `PRONTOMEDIC_TENANT_A_PASSWORD`, `PRONTOMEDIC_TENANT_B_EMAIL` e `PRONTOMEDIC_TENANT_B_PASSWORD`.
- Pre-condicao: tenants A e B devem ser empresas distintas.
- Cobertura: login dos dois perfis, leitura de perfil, leitura e contagem de paciente, tentativa de insercao cross-tenant, PATCH cross-tenant e verificacao de imutabilidade do registro original.

## Evidencia RLS do head 3384af4

- F1 ephemeral tenant gate: run `29296848599` (#14), job `86972163361`, `success`.
- CI geral: run `29296848658` (#416), `success`; migrations, type-check, lint, build, testes unitarios, seguranca do proxy e cobertura concluídos.
- A etapa `Verify PostgreSQL RLS with non-bypass role` passou em PostgreSQL 18 limpo. O log registrou `F1_RLS_PASS tenant_visible=1 cross_read=0 cross_update=0`.
- O ator de prova foi criado como `NOSUPERUSER NOBYPASSRLS`, recebeu grants mínimos, não era proprietário de `public.patients`, e foi removido com cleanup explícito.
- A etapa de isolamento HTTP registrou `TENANT_ISOLATION=PASS checks=10 failures=0`.

Esta evidencia fecha o gate efêmero de RLS e isolamento tenant. Não substitui a execução contra o runtime homologado/VPS, nem a validação read-only contra o DataSIGH.

## Evidencia de alinhamento de identidade

- Commit: `e404deb`.
- F1 ephemeral tenant gate: run `29297162975` (#18), `success`.
- CI geral: run `29297162824` (#418), `success`.
- O gate executou `current_company_id()` e `get_my_company_id()` sob o mesmo claim e rejeitaria qualquer divergencia.
- `is_admin()` e `is_staff()` agora usam o mesmo vinculo canonico do perfil, com perfil ativo obrigatorio.

Esta correcao elimina a inconsistencia estatica entre helpers. Ela nao substitui a auditoria do role e do runtime real da VPS.

## Evidencia de fechamento do role de Convênios

- Commit: `76be026`.
- F1 ephemeral tenant gate: run `29297480116` (#22), `success`.
- CI geral: run `29297479988` (#420), `success`.
- A migration remove `SELECT/INSERT/UPDATE/DELETE` de `app_prontomedic` nas 13 tabelas de Convênios e elimina as policies `app_prontomedic_all_*`.
- O gate registra `F1_INSURANCE_ROLE_PASS direct_global_access=closed` quando o role existir.

Esta correção fecha o acesso direto global; ela não simula a integração operacional. O módulo precisa de RPC tenant-aware antes de ser liberado para escrita.

## Evidencia do RPC tenant-aware de Convênios

- Commit: `05d25ee`.
- F1 ephemeral tenant gate: run `29297744350` (#26), `success`.
- CI geral: run `29297744335` (#422), `success`.
- O teste chamou o RPC com `company_id` do tenant B sob identidade do tenant A e recebeu `42501`.
- A mesma identidade chamou o RPC com sua própria empresa e recebeu resultado de validação sem criação de snapshot.

O RPC é somente de validação; não concede CRUD direto nem libera mutações sem autorização específica.

## Evidencia do isolamento do catalogo LIS

- Commit: `c98169f`.
- F1 ephemeral tenant gate: run `29298189099` (#34), `success`.
- CI geral: run `29298189167` (#426), `success`.
- `F1_LIS_CATALOG_PASS tenant_visible=1 cross_read=0` foi confirmado com dois registros e preços diferentes.
- A policy de gerenciamento foi corrigida para usar `get_my_company_id()`; o teste não depende de grant direto em `user_profiles`.

O catálogo LIS agora respeita tenant; valores de referência sem `company_id` continuam tratados como catálogo universal de referência clínica.

## Evidencia operacional e de scripts no head 5c55370

- F1 ephemeral tenant gate: run `29299237276` (#42), `success`.
- CI geral: run `29299237225` (#430), `success`.
- `scripts/vps_backup.sh` agora executa `pg_dump`, exige `PGPASSWORD` fora do Git, usa `umask 077` e mantém retenção explícita.
- `scripts/vps_healthcheck.sh` agora consulta PostgreSQL via `psql`, aplica timeout em HTTP e reinicia `prontomedic-auth` via PM2 quando necessário.
- O CI executa `bash -n` nos scripts operacionais para impedir regressão sintática.
- A VPS foi consultada em modo somente leitura: frontend/auth HTTP 200, PM2 online, PostgreSQL em loopback, RLS habilitado/forçado e `app_prontomedic` sem `rolsuper`/`rolbypassrls`.

Essa evidencia fecha a correção dos scripts e a saúde básica da infraestrutura. Ainda exige segundo tenant homologado, login operacional, reconciliação read-only do DataSIGH e restore de backup para liberar produção.

## Evidencia do gate de backup e restore PostgreSQL 18 no head ca7cc62

- F1 ephemeral tenant gate: run `29299733394` (#48), `success`.
- CI geral: run `29299733405` (#433), `success`.
- O gate usa `postgres:18` para `pg_dump` e `pg_restore`, compatível com o serviço PostgreSQL 18.4 do CI.
- O job `test` passou por validação dos scripts VPS, migrações, replay de auth, backup/restore efêmero, lint, build, testes unitários e segurança do auth proxy.
- O E2E permaneceu explicitamente `skipped` porque os secrets de runtime não estão configurados.

Esta evidencia comprova o backup/restore em banco efêmero. O restore real na VPS, o segundo tenant operacional, o login homologado e a reconciliação somente leitura do DataSIGH continuam gates externos e não foram falsamente marcados como concluídos.

## Evidencia do healthcheck local endurecido no head 5768273

- `scripts/health-local.ps1` deixou de tratar uma porta TCP aberta como prova de banco operacional.
- O healthcheck agora exige `psql` e executa `SELECT 1` com os parametros PostgreSQL do ambiente.
- O smoke de login exige credenciais efemeras por ambiente quando `PRONTOMEDIC_REQUIRE_AUTH_SMOKE=1`; sem isso, permanece explicitamente `WARN` e nao declara login validado.
- A sintaxe do PowerShell foi validada localmente sem inserir credenciais no repositorio.
- F1 ephemeral tenant gate: run `29300026276` (#52), `success`.
- CI geral: run `29300026284` (#435), `success`.

Esta alteracao melhora o gate local, mas nao substitui a execucao E2E real nem a homologacao operacional com usuarios, tenants e secrets protegidos.

## Evidencia da propagacao de falha do healthcheck VPS no head d02e105

- `scripts/vps_healthcheck.sh` agora atualiza o estado de auth e frontend apos as tentativas de restart.
- O script retorna `exit 0` somente quando os checks terminam saudaveis e `exit 1` quando qualquer dependencia permanece indisponivel.
- A sintaxe foi coberta pelo passo `Validate VPS shell scripts` do CI.
- F1 ephemeral tenant gate: run `29300332802` (#56), `success`.
- CI geral: run `29300332885` (#437), `success`.

Esta correcao permite que cron/systemd/monitoramento detectem indisponibilidade persistente. Nao substitui observabilidade completa com request id, metricas, latencia e alertas ativos.

## Evidencia de observabilidade HTTP no head d1183d7

- O auth server agora gera um `X-Request-Id` por requisicao e o expoe ao cliente via CORS.
- Cada requisicao registra log JSON com evento, request_id, metodo, rota sem query string, status HTTP e duracao em milissegundos.
- Nenhum token, senha ou query string e incluido no evento de observabilidade.
- F1 ephemeral tenant gate: run `29300648693` (#60), `success`.
- CI geral: run `29300648691` (#439), `success`.

Esta melhoria cobre correlacao e latencia no backend local. Alertas ativos, agregacao de logs e metricas de infraestrutura ainda dependem da configuracao operacional da VPS.

## Evidencia do contrato seguro da RPC de auditoria no head 8948abc

- F1 ephemeral tenant gate: run `29301250787` (#68), `success`.
- CI geral: run `29301250773` (#443), `success`.
- A migration `20260101000008_harden_audit_access_rpc.sql` corrige o retorno da RPC para o `BIGINT` real de `audit_logs`, limita as ações aceitas e valida o registro dentro da empresa do usuário autenticado.
- O teste efêmero confirma que um usuário não acessa registro de outro tenant, não registra ação de escrita via RPC e recebe o identificador do log realmente inserido.
- O mesmo gate confirmou migrations, RLS com role sem bypass, proxy de autenticação, restore PostgreSQL 18, lint, build, testes unitários e segurança do auth proxy.

Esta evidencia fecha o contrato executável da RPC e o gate efêmero de isolamento. Ainda não comprova homologacao com dois usuarios reais na VPS, imutabilidade contra owner/service_role, restore real, reconciliacao somente leitura do DataSIGH ou alertas ativos.

## Evidencia da trilha append-only no head 8c08ff4

- F1 ephemeral tenant gate: run `29301566667` (#72), `success`.
- CI geral: run `29301567219` (#445), `success`.
- A migration `20260714005000_audit_logs_append_only.sql` instala trigger que rejeita UPDATE/DELETE na trilha e permite exclusao somente durante a purga de retencao autorizada.
- O gate confirma a presenca do trigger no catalogo PostgreSQL 18, alem de repetir RLS, RPC tenant-aware, restore, lint, build e testes de seguranca.

O controle cobre usuarios e operacoes normais da aplicacao. O dono/superuser do banco continua sendo um limite administrativo inevitavel e requer controle de acesso, backup e monitoramento da infraestrutura.

## Evidencia de hardening dos segredos do auth no head d9db88b

- O backend aceita `JWT_SECRET_FILE` e `PGPASSWORD_FILE`, lendo os valores somente de arquivos protegidos.
- O manifesto PM2 `scripts/prontomedic-auth.ecosystem.config.cjs` passa apenas caminhos de arquivos, nunca valores de segredo.
- `scripts/activate-vps-auth-secret-files.sh` exige arquivos `600`, valida o tamanho mínimo do JWT, reinicia o processo e falha se os nomes `JWT_SECRET` ou `PGPASSWORD` permanecerem no ambiente.
- F1 ephemeral tenant gate: run `29301924929` (#76), `success`.
- CI geral: run `29301924919` (#447), `success`.

O código está validado. O cutover na VPS ainda é um gate operacional separado: o administrador precisa criar os dois arquivos de segredo fora do GitHub e executar o script no servidor. Não se deve extrair segredos de `/proc` nem registrá-los em terminal/log.
