# Ciclo 1 - Consolidacao RLS e Inventario Frontend/QA

Data: 2026-07-11
Escopo: workspace local de revisao do ProntoMedic

## Registro da decisao

### Fato

Foram comparadas as migrations produzidas por Rawls/Mencius:

- `supabase/migrations/20260711000000_rls_base_tables_company.sql`
- `supabase/migrations/20260711090000_base_tables_rls_tenant_hardening.sql`

### Decisao

Manter somente:

`supabase/migrations/20260711090000_base_tables_rls_tenant_hardening.sql`

Descartar a duplicada:

`supabase/migrations/20260711000000_rls_base_tables_company.sql`

A migration mantida foi revisada localmente. Nenhum SQL remoto foi aplicado, nenhuma VPS foi escrita e nenhum dado DataSIGH foi acessado ou alterado.

## Consolidacao tecnica

### Tabelas cobertas

`companies`, `user_profiles`, `patients`, `professionals`, `units`, `appointments`, `appointment_types`, `services_catalog`, `tiss_xml`, `paciente_consentimentos`, `paciente_anonimizacao_log`, `medical_records` e `billings`.

### Funcoes usadas

- `public.get_scheduling_actor()`, criada por `20260708090000_scheduling_phase1.sql`.
- `public.get_my_company_id()`, criada por `20260101000012_critical_fixes.sql`.

O tenant efetivo usa `get_scheduling_actor()` com fallback para `get_my_company_id()`.

### Policies

A migration consolidada cria 17 policies nomeadas:

- empresas: leitura tenant-aware e escrita administrativa;
- perfis: leitura tenant-aware e insert/update/delete somente administrativo;
- tabelas operacionais: acesso completo limitado ao tenant;
- TISS e consentimentos: leitura tenant-aware, preservando policies de papel das migrations de dominio;
- log LGPD: leitura tenant-aware, com INSERT-only preservado.

Também remove os nomes `base_tenant_select`, `base_tenant_insert`, `base_tenant_update` e `base_tenant_delete` da migration duplicada. Isso evita combinacao permissiva por OR em aplicacoes incrementais.

### Conflitos encontrados

1. As duas migrations habilitavam RLS nas mesmas tabelas e criavam policies diferentes para leitura/escrita.
2. Policies permissivas de mesmo escopo poderiam combinar por OR no PostgreSQL.
3. A migration Mencius concedia `UPDATE/DELETE` ao log LGPD apesar de declarar o log imutavel.
4. A migration Mencius referenciava nomes fixos de sequences, fragilizando bootstraps com `SERIAL/BIGSERIAL` divergentes.
5. A migration Rawls usava policies genericas com `get_my_company_id()` e nao incorporava o ator de agenda.

## Inventario para integracao posterior

### Frontend e operacao

- `work/patch-active-ui.cjs`
- `work/patch-active-scheduling.cjs`
- `work/patch-active-schedule-handler.cjs`
- `work/patch-active-patients.cjs`
- `work/patch-active-appointments.cjs`
- Alteracoes locais em `src/pages/`, `src/components/`, `src/services/`, `src/hooks/`, `src/types/` e `src/config/routePermissions.ts`.
- Novos arquivos locais: `src/ErrorBoundary.tsx`, `src/hooks/useConfirm.tsx`, `src/components/schedule/SchedulingOperationsPanel.tsx`, paginas de billing/encounters/nursing/credentialing/laudos e respectivos services.

### QA, auth e release safety

- `e2e-auth-health-url.patch`
- `security-hardening-local-auth.patch`
- `security-hardening-local-auth-relative.patch`
- `scripts/e2e-safety.mjs`
- `scripts/validate-release-safety.mjs`
- `localAuthSecurity.test.ts`
- E2E alterados em `e2e/` para auth, agenda, recepcao, pacientes, financeiro, LGPD, notificacoes, prontuario, DICOM, pre-cadastro, acessibilidade e performance.
- Pacotes QA arquivados: `prontomedic-qa-fix4.tar.gz` a `prontomedic-qa-fix9-login.tar.gz`.

Esses arquivos permanecem catalogados, sem aplicacao automatica, porque o working tree contem alteracoes amplas preexistentes e a integracao precisa ser feita em lotes disjuntos com diff e testes por lote.

## Testes e bloqueios

### Passaram

- Checagem estrutural independente da migration: 13 tabelas com RLS, 17 `CREATE POLICY`, as duas funcoes requeridas e `COMMIT` presentes.
- Confirmado que a migration antiga nao existe mais no workspace de revisao e a consolidada existe.
- Confirmado que o arquivo consolidado nao contem referencias a VPS, DataSIGH ou endpoints remotos.

### Bloqueados

- `scripts/validate-migrations-v2.py`: dependência `sqlparse` ausente.
- `scripts/validate-release-safety.mjs`: falha `EPERM` ao resolver o caminho protegido do workspace.
- PostgreSQL efemero: cliente 15 instalado em `C:\PostgreSQL\15\bin`, mas a sandbox bloqueou a criação do diretório de dados e a inicialização na porta local `55433`.
- Docker não está disponível.

### Risco residual

A migration ainda precisa de execução em PostgreSQL local/efêmero funcional, incluindo consultas de catálogo e testes negativos entre dois tenants. Essa validação não foi simulada com dados aproximados e não deve ser substituída por backfill.

## Proxima acao segura

Validar a migration consolidada em um banco local/efêmero autorizado e então integrar frontend/QA em lotes separados, começando pelos patches de auth/safety e agenda. Não executar deploy, SSH, escrita em VPS, migration remota, DataSIGH ou publicação sem aprovação explícita.
