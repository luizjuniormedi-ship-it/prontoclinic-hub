# Pacote MVP — integração controlada ao repositório oficial

Documento de preparação para uma futura branch/PR. O workspace atual está em `main`, com alterações paralelas não isoladas. Nenhuma cópia, checkout, commit, push ou publicação foi executada nesta rodada.

## Regra de escopo

O pacote abaixo contém somente correções locais dos fluxos existentes: Agenda, Call Center, Recepção/check-in, Atendimento, Faturamento e contratos/testes associados. Não inclui telas novas, migrations, `supabase/release-mvp`, DataSIGH, VPS, workflows de deploy ou E2E destrutivo.

`BillingAccountsPage.tsx` é aplicável somente se o repositório oficial já possuir a tela equivalente. Se não possuir, o arquivo fica fora deste pacote: esta operação não cria tela nova.

## Revisão de dependências dos sete fluxos

| Fluxo | Frontend aplicável | Backend/schema necessário | Situação para PR |
|---|---|---|---|
| Autenticação/sessão | `useAuth`, login, guards de rota | Supabase Auth, `user_profiles`, `company_id`, `role_name` | local parcial; runtime obrigatório |
| Paciente | `patientsService`, páginas de pacientes, estados/retry | `patients`, RLS tenant | local preparado; validar runtime |
| Agenda | `SchedulePage`, `appointmentsService`, transições, datas | appointments/lookups; RPCs `create_appointment_secure`, `update_appointment_status_secure`, `reschedule_appointment_secure` | RPCs de requisitos chamados pelo frontend ainda divergentes/ausentes |
| Call Center | `CallCenterPage`, `callCenterService`, tarefas/retry | `scheduling_contact_logs`, `scheduling_call_center_tasks`, `scheduling_confirmation_queue`; RPCs de confirmação | bloqueado por schema/RPC ausente |
| Recepção/check-in | `ReceptionPage`, `receptionService`, readiness/RBAC | views de autorização/elegibilidade, check-in/fila; RPCs canônicos de readiness/check-in | local confirmado; aplicar/validar runtime |
| Atendimento | `AttendancePage`, `medicalRecordsService`, `financialService`, `priceTableService` | `appointments`, `patients`, `medical_records`, `billings`, `price_tables`; status/preço RPC; constraint tenant | parcial; constraint e RLS exigem runtime |
| Faturamento | `BillingAccountsPage` apenas se já existente, `billingAccountsService`, estados/retry | `billing_accounts`, `billing_pending_issues`, `billing_competencies`, RPC de glosa e views | bloqueado por schema/RPC/view ausente |

Regra de integração: dependência frontend pode entrar no PR apenas com fallback/erro explícito quando o backend estiver bloqueado; não se deve mascarar ausência de tabela/RPC como sucesso local.

## Arquivos aplicáveis

### Contratos, estados e documentação

| Ordem | Arquivo | Ação | Conflito esperado |
|---:|---|---|---|
| 1 | `src/config/mvpFlowContracts.ts` | copiar/patch | médio: arquivo novo, mas pode conflitar se o oficial já tiver contratos MVP |
| 1 | `src/config/__tests__/mvpFlowContracts.test.ts` | copiar/patch | médio: diretório de testes já está não rastreado |
| 1 | `src/services/integrationContracts.ts` | copiar/patch | médio: contrato novo; preservar qualquer contrato oficial adicional |
| 1 | `src/services/__tests__/integrationContracts.test.ts` | copiar/patch | médio: teste novo |
| 1 | `src/utils/formatters.ts` | aplicar apenas o diff MVP | alto: arquivo rastreado e já modificado no workspace |
| 1 | `src/services/statusTransitions.ts` | aplicar apenas o diff MVP | alto: arquivo rastreado e já modificado no workspace |
| 1 | `src/config/routePermissions.ts` | aplicar apenas o diff MVP | alto: arquivo rastreado e já modificado no workspace |
| 1 | `docs/MATRIZ_ACEITE_7_FLUXOS_MVP.md` | copiar/patch | baixo: documentação nova |
| 1 | `docs/MAPEAMENTO_CONTRATOS_MVP_BASELINE.md` | copiar/patch | baixo: documentação nova |
| 1 | `docs/OPERACAO_FLUXOS_ACEITE_LOCAL.md` | copiar/patch | baixo: documentação nova |

### Serviços e páginas operacionais

| Ordem | Arquivo | Fluxo | Conflito esperado |
|---:|---|---|---|
| 2 | `src/services/appointmentsService.ts` | Agenda | alto: serviço rastreado e com divergência de RPC a resolver |
| 2 | `src/services/callCenterService.ts` | Call Center | médio: serviço novo; depende de schema ausente |
| 2 | `src/services/receptionService.ts` | Recepção/check-in | médio: serviço novo; contrato canônico local |
| 2 | `src/services/financialService.ts` | Atendimento/Faturamento | alto: serviço rastreado, idempotência de billing |
| 2 | `src/services/billingAccountsService.ts` | Faturamento | médio: serviço novo; depende de schema ausente |
| 2 | `src/services/__tests__/appointmentsService.test.ts` | Agenda | alto: teste rastreado e deve ser rebaseado junto do serviço |
| 2 | `src/services/__tests__/financialService.test.ts` | Atendimento/Faturamento | alto: teste rastreado e deve ser rebaseado junto do serviço |
| 2 | `src/services/__tests__/callCenterService.test.ts` | Call Center | médio: teste novo |
| 2 | `src/services/__tests__/receptionService.test.ts` | Recepção/check-in | médio: teste novo |
| 2 | `src/services/__tests__/billingAccountsService.test.ts` | Faturamento | médio: teste novo |
| 2 | `src/utils/__tests__/formatters.test.ts` | Agenda/data | médio: teste novo |
| 3 | `src/pages/SchedulePage.tsx` | Agenda | alto: página rastreada |
| 3 | `src/pages/CallCenterPage.tsx` | Call Center | alto: página rastreada |
| 3 | `src/pages/ReceptionPage.tsx` | Recepção/check-in | alto: página rastreada |
| 3 | `src/pages/AttendancePage.tsx` | Atendimento | alto: página rastreada |
| 3 | `src/pages/BillingAccountsPage.tsx` | Faturamento | alto: incluir somente se já houver tela equivalente no oficial; caso contrário, excluir para não criar tela nova |
| 3 | `src/components/schedule/QuickActionsMenu.tsx` | Agenda | alto: componente rastreado |

## Fora do pacote frontend/MVP

Não copiar automaticamente: `.github/workflows/*`, `package.json`/lock, `vite.config.ts`, `playwright.config.ts`, todos os E2E, páginas não operacionais, scripts de deploy/validação, `supabase/migrations/*`, `supabase/release-mvp/*` e `supabase/tests/*`. Migrations e contratos PostgreSQL devem ser tratados em PR backend/schema separado, após resolver os objetos ausentes.

## Ordem de cópia/patch

1. Criar branch a partir do `main` oficial atualizado, com worktree limpo.
2. Aplicar contratos, testes de contrato e documentação; confirmar que os sete fluxos continuam presentes.
3. Aplicar utilitários, transições e permissões; resolver conflitos manualmente preservando a regra oficial de RBAC.
4. Aplicar serviços e seus testes em pares: Agenda, Call Center, Recepção, Atendimento e Faturamento.
5. Aplicar páginas/componentes já existentes, mantendo o layout oficial e sem criar rotas/telas novas.
6. Rodar testes locais focados, build e lint; separar explicitamente resultado mock/local de validação PostgreSQL.
7. Abrir PR draft sem merge; anexar matriz, diff de arquivos, bloqueios de schema e evidências de teste.
8. Somente após aprovação do contrato backend, abrir PR separado para migrations/RPCs. Não incorporar schema ausente por cópia silenciosa no PR frontend.

## Estado atual dos sete fluxos contra a baseline

| Fluxo | Estado | Baseline apontada | Liberação |
|---|---|---|---|
| Autenticação/sessão | parcial-local | `user_profiles`/tenant local; Auth depende de runtime | validar sessão, papel e `company_id` |
| Paciente | confirmado-local | `patients` e RLS local | validar RLS em PostgreSQL |
| Agenda | divergente | baseline tem `create_appointment_secure`; serviço chama também RPCs ausentes | alinhar `create_appointment_with_requirements_secure`/`get_scheduling_requirements` |
| Call Center | bloqueado | tabelas/RPCs operacionais não localizados | fornecer schema e RPCs |
| Recepção/check-in | confirmado-local | views/tabelas canônicas e RPCs de check-in | aplicar migration e validar legado/RLS |
| Atendimento | parcial-local | appointments, prontuário, billing, preços e status local | ativar constraint tenant e testar concorrência real |
| Faturamento | bloqueado | contas, pendências, competências, RPC e views não localizados | fornecer schema/RPCs/views/RLS |

## Checklist de branch/PR

- [ ] Branch criada a partir de `main` atualizado, sem trabalhar diretamente em `main`.
- [ ] Worktree limpo ou alterações paralelas identificadas e excluídas do patch.
- [ ] Lista de arquivos aplicáveis revisada contra o diff do repositório oficial.
- [ ] Conflitos de `appointmentsService`, `financialService`, páginas e permissões resolvidos manualmente.
- [ ] Nenhum workflow de deploy, E2E, migration, VPS ou DataSIGH incluído por acidente.
- [ ] Os sete contratos apontam para a baseline e preservam estados, permissões, erro e retry.
- [ ] Testes locais focados aprovados; runtime PostgreSQL listado como pendente, não mascarado.
- [ ] Testes de contrato dos 7 fluxos executados; nenhum teste mockado é contado como prova de PostgreSQL.
- [ ] Agenda: divergência de RPC registrada como bloqueio ou resolvida em contrato aprovado.
- [ ] Call Center/Faturamento: objetos ausentes registrados como dependência de PR backend separado.
- [ ] Atendimento: constraint tenant, RLS e idempotência entre sessões incluídas no plano de runtime.
- [ ] Build/lint executados e warnings conhecidos registrados.
- [ ] PR aberta como draft, com critérios de aceite e bloqueios de schema no corpo.
- [ ] Sem merge para `main`, sem push/publicação nesta etapa.

## Evidência desta preparação

Os contratos e a classificação de baseline estão em `src/services/integrationContracts.ts`, `src/config/mvpFlowContracts.ts`, `docs/MAPEAMENTO_CONTRATOS_MVP_BASELINE.md` e `docs/MATRIZ_ACEITE_7_FLUXOS_MVP.md`. A suíte local focada anterior foi validada com 92 testes aprovados; nenhum PostgreSQL remoto, VPS, DataSIGH ou E2E destrutivo foi usado.

Auditoria complementar dos cinco arquivos de fronteira assumidos: `docs/AUDITORIA_PACOTE_MVP_ARQUIVOS_RESTRITOS.md`. A lista nominal oficial dos arquivos restritos ainda precisa ser confirmada antes da PR.
