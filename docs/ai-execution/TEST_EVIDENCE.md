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

### Contrato operacional do gate F1

- Secrets requeridos: `PRONTOMEDIC_E2E_BASE_URL`, `PRONTOMEDIC_ANON_KEY`, `PRONTOMEDIC_TENANT_A_EMAIL`, `PRONTOMEDIC_TENANT_A_PASSWORD`, `PRONTOMEDIC_TENANT_B_EMAIL` e `PRONTOMEDIC_TENANT_B_PASSWORD`.
- Pre-condicao: tenants A e B devem ser empresas distintas.
- Cobertura: login dos dois perfis, leitura de perfil, leitura e contagem de paciente, tentativa de insercao cross-tenant, PATCH cross-tenant e verificacao de imutabilidade do registro original.
