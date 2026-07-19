# Próxima Rodada - ProntoMedic

## Diretriz obrigatória

Consultar integralmente [PRONTOMEDIC_DIRETRIZ_MESTRE.md](docs/PRONTOMEDIC_DIRETRIZ_MESTRE.md) antes de qualquer alteração.

## Estado atual

- Módulo atual: 2 - Usuários, Perfis e Permissões.
- Implementação local: concluída e validada pelos gates locais.
- Módulo seguinte: 3 - Unidades, Setores e Recursos.
- Avanço bloqueado: sim, até fechar os gates remotos do Módulo 2.
- DataSIGH: intocado; não alterar em nenhuma hipótese.
- Relatório de produto final: `docs/PRONTOMEDIC_RELATORIO_PRODUTO_FINAL.md`.
- Catálogo de agentes/MCPs: `docs/AGENTES_E_MCPS_AVALIADOS.md`.

## Gates locais registrados

- Type-check: aprovado.
- Testes: 43 arquivos, 493 aprovados, 1 ignorado.
- Lint: 0 erros; warnings existentes no repositório.
- Build: aprovado.
- Revalidação focada do Módulo 2 em 2026-07-19: autenticação, permissões, rotas e segurança passaram; 10 testes focados aprovados e gate local de segurança 7/7.
- Type-check revalidado sem erros; lint revalidado com 0 erros e 436 avisos já existentes.

## Correção de CI preparada

- Falha remota identificada: o E2E abortava no `global-setup` por ausência de variáveis Supabase e usuários de teste.
- Correção local preparada em `.github/workflows/ci.yml` e `scripts/e2e/seed-local-users.sql`.
- O CI agora usa PostgreSQL descartável, usuários sintéticos e `local-auth-server.mjs` em loopback, sem secrets remotos.
- Validação local da correção: segurança `7/7`, type-check aprovado, testes `493 passed / 1 skipped`, lint sem erros e build aprovado.
- Reexecução remota: patch publicado no PR #11 (`1fa8474d4c56088da3eca76238570b6d904eb2c0`) e push autenticado `039de9821cb22ae2f7e7a60f22fbf98870a1b595`; como o Actions não registrou execução, foi aberta a PR de validação #14. Até esta verificação, o GitHub não exibiu contexto de CI para o commit; apenas Vercel ficou `pending`.
- Supabase remoto consultado somente em leitura: projeto `prontoclinic-hub-prod` está `ACTIVE_HEALTHY`, mas a conexão/listagem de migrations continua indisponível, alternando entre `57P03` e `ECONNREFUSED`. Nenhuma migration, backup, rollback ou deploy foi executado.

## Auditoria da infraestrutura de banco (2026-07-19)

- Banco operacional do ProntoMedic confirmado na VPS por SSH somente leitura: PostgreSQL nativo ativo, escutando apenas em `127.0.0.1:5432`, e `pg_isready` retornou `accepting connections`.
- O banco local `prontoclinic` existe na VPS. O processo `prontomedic-auth` permaneceu online e o endpoint local de autenticação respondeu HTTP 200.
- Isto é separado do projeto Supabase `prontoclinic-hub-prod`, usado pelo CI/migrations. O erro `57P03` afeta o plano remoto Supabase/CI e não prova ausência do banco operacional na VPS.
- A auditoria não consultou tabelas clínicas, não executou SQL de escrita e não acessou o DataSIGH.

## Sincronização de estado (2026-07-19)

- `HEAD` local e `origin/main` estão no mesmo commit `3dfaa56a050374ba45e55d52d028483ddfefdbb7`.
- O working tree permanece deliberadamente sujo, com alterações locais de vários escopos e migrations ainda não publicadas. Elas não foram agrupadas nem enviadas automaticamente para evitar misturar mudanças não revisadas.
- A PR remota de validação contém somente o ajuste descartável de CI; não representa deploy do código local completo para a VPS.
- Runtime da VPS foi revalidado em leitura: PostgreSQL aceitando conexões, banco `prontoclinic` presente, `prontomedic-auth` online e endpoint de autenticação HTTP 200.
- Nenhuma alteração de código foi necessária nesta revalidação; apenas os artefatos de estado foram atualizados.

## Paridade local x VPS (2026-07-19)

- O checkout local está em `3dfaa56a050374ba45e55d52d028483ddfefdbb7`; o checkout existente na VPS está em `d8a70ade58e6b166e57a1b4c3376ebbc53aa3588`, portanto as melhorias locais não estão publicadas integralmente.
- No banco operacional da VPS, a leitura de metadados encontrou apenas `user_profiles`, `roles` e `user_permissions` entre as estruturas principais do Módulo 2.
- Não foram encontradas `user_roles`, `permissions`, `unit_access`, `sector_access`, `delegations` ou `access_expirations`; também não foi identificado ledger de migrations nesse banco.
- Conclusão: o banco da VPS não está atualizado com o Módulo 2 completo. Não aplicar a migration diretamente sem backup verificável, plano de rollback e confirmação do alvo correto (VPS nativo versus Supabase remoto).

## Sincronização do release (2026-07-19)

- As melhorias locais auditadas dos Módulos 1 e 2 foram publicadas na branch `codex/module-1-2-sync-20260719`, commit `9c2052a065f55029966a5ac887026c827f484698`.
- PR draft criado: [#15](https://github.com/luizjuniormedi-ship-it/prontoclinic-hub/pull/15), contra `main` em `f1cd2ce46a10da718de5e53b29e90adc276d091f`.
- O pacote excluiu `.env.production.local`, arquivos `tar.gz`, `__pycache__` e `scripts/reconcile_datasigh_readonly.py`; DataSIGH permanece fora do release.
- Gates locais do commit: type-check, testes `493 passed / 1 skipped`, safety `7/7`, lint `0 erros`, build, release-safety e secret scan aprovados.
- O Actions não registrou workflow para o commit do PR #15; o status Vercel permanece `pending`.
- Supabase está `ACTIVE_HEALTHY`, mas o banco remoto segue em recuperação (`redo in progress`), recusando migrations com `57P03`; nenhuma escrita foi executada.

## Pendências reais antes de avançar

1. Confirmar a execução do CI no commit publicado; se o workflow não iniciar, acionar o rerun pelo GitHub sem alterar o código.
2. Resolver o gatilho externo do Actions no PR #15 e recuperar a conectividade do banco Supabase remoto que retorna `57P03`/`ECONNREFUSED`, sem confundir esse bloqueio com o PostgreSQL operacional já existente na VPS.
3. Aplicar a migration `20260719090000_users_profiles_permissions.sql` somente no ambiente Supabase autorizado e após o banco aceitar conexões.
4. Publicar a Edge Function `admin-user-invite` somente com secrets configurados no ambiente correto.
5. Executar replay de migration, RLS/RBAC, isolamento entre empresas/unidades e fluxo de convite no ambiente remoto.
6. Confirmar o alvo correto da migration, registrar backup, rollback e evidência ponta a ponta antes de atualizar a VPS.

Sincronização automática do working tree não é permitida enquanto houver alterações de múltiplos escopos sem uma unidade de revisão definida.

Não executar essas ações neste arquivo. Ele é o registro de coordenação; a execução exige a autorização operacional e os gates definidos na diretriz mestre.
