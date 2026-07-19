# Matriz de aceite — sete fluxos MVP

Esta matriz cobre somente telas e componentes já existentes. Ela não cria novas telas nem libera integração remota por si só.

| Fluxo | Aceite funcional | Permissão | Estados e erro | Teste focado | Dependência obrigatória |
|---|---|---|---|---|---|
| Autenticação/sessão | Login válido entra; inválido pode tentar novamente | Público no login; sessão nas rotas | loading, submitting, authenticated, error | `e2e/auth.spec.ts` + setup local | Auth, `user_profiles`, papel/empresa |
| Paciente | Buscar, abrir, criar e editar dados válidos | admin, recepção, médico, gestor | loading, empty, saving, error/retry | `patientsService.test.ts` | `patients` + RLS tenant |
| Agenda | Consultar, criar, remarcar, confirmar e cancelar | admin, recepção, médico, gestor | loading, empty, saving, transição, error/retry | appointments/status/date tests | `appointments` + lookups + RPCs |
| Call Center | Registrar contato, criar retorno, confirmar e concluir tarefa | admin, recepção | loading, empty, saving, task, error/retry | `callCenterService.test.ts` | tabelas Call Center + RPCs de confirmação |
| Recepção/check-in | Validar prontidão, bloquear pendência, aceitar exceção auditada e gerar senha | admin, recepção | queue, readiness, blocked, checking-in, error | `receptionService.test.ts` + RBAC | tabelas de autorização/elegibilidade + RPCs |
| Atendimento | Abrir, salvar registro, concluir e vincular uma cobrança | admin, médico | in-progress, saving, completed, error/retry | medical records, financial, RBAC | appointments, medical_records, billings, preços |
| Faturamento | Consultar contas, glosa, pendências, reabertura e competência | admin, financeiro, gestor | pending issues, reopening, closing, error/retry | billing accounts, financial, contracts | `billing_accounts`, pendências, competências, views/RPC |

## Baseline/schema local

| Fluxo | Situação contra a baseline local | Evidência | Bloqueio para uso real |
|---|---|---|---|
| Autenticação/sessão | Parcial | `user_profiles`/tenant aparecem localmente; Auth e sessão não são definidas por migration | Validar Auth, claims/sessão e perfil de cada papel no ambiente alvo |
| Paciente | Confirmado local | `patients` e políticas tenant aparecem na baseline | Aplicar/validar RLS no ambiente alvo |
| Agenda | Divergente | Baseline define `create_appointment_secure`, `update_appointment_status_secure` e `reschedule_appointment_secure` | Alinhar o serviço que chama `create_appointment_with_requirements_secure`/`get_scheduling_requirements`, ou fornecer esses RPCs |
| Call Center | Bloqueado | Não foram localizados `scheduling_contact_logs`, `scheduling_call_center_tasks`, `scheduling_confirmation_queue` nem RPCs de confirmação | Schema e RPCs de fila, contato e confirmação |
| Recepção/check-in | Confirmado local | Migration canônica define views, check-in/fila e `get_reception_checkin_readiness`/`perform_reception_checkin_secure` | Aplicar migration e garantir ausência de legado conflitante |
| Atendimento | Parcial | `appointments`, `medical_records`, `billings` e status RPC aparecem localmente | Aplicar constraints tenant de `billings` e confirmar tabelas/preçário usados pelo ambiente |
| Faturamento | Bloqueado | Não foram localizadas definições de `billing_accounts`, pendências, competências, RPC de glosa ou views de receita | Schema/RPC/views de faturamento e RLS |

Os rótulos acima são uma leitura estática do workspace. Não representam confirmação de aplicação no banco remoto.

## Testes locais x PostgreSQL runtime

**Aprovados localmente (mock/local, sem PostgreSQL):** a suíte focada atual tem **92 testes aprovados**. Para esta frente, ela cobre contratos e validações de Agenda (`appointmentsService`, transições e datas), Call Center (`callCenterService`), Atendimento (billing/idempotência e transições) e Faturamento (`billingAccountsService`, financial e contratos). Esses testes confirmam payloads, estados, erros, retry, permissões representadas no frontend e deduplicação na mesma sessão; não comprovam que os objetos existem no banco.

**Ainda exigem PostgreSQL runtime:** nenhum teste desta rodada foi executado contra banco. Permanecem nesta categoria a aplicação/ordenação das migrations, existência real de tabelas/RPCs/views, assinaturas e grants, RLS por `company_id`, resolução de `auth.uid()`/`user_profiles`, constraints, triggers, concorrência entre sessões e dados mínimos de preço/competência.

| Fluxo | Testes locais aprovados | Testes que exigem PostgreSQL runtime |
|---|---|---|
| Agenda | criação/status/remarcação mockados, transições válidas, datas locais e retry | RPCs e assinaturas reais, conflito de horário, grants/RLS tenant, `create_appointment_with_requirements_secure`/`get_scheduling_requirements` após alinhamento |
| Call Center | listagem, validação de contato/tarefa, confirmação mockada e retry | tabelas/FKs/status, RPCs de fila/confirmacão, actor autenticado, RLS e auditoria |
| Atendimento | registro/billing mockados, idempotência concorrente na sessão, transições e erros | medical record/billing persistidos, `find_price`, constraint única cross-session, RLS e rollback/consistência entre conclusão e cobrança |
| Faturamento | filtros, readiness, pendências/erro de schema mockados e contratos | tabelas/views/RPC reais, glosa, reabertura, fechamento de competência, RLS financeiro e bloqueio de competência fechada |

Os testes E2E existentes não são considerados evidência de runtime nesta matriz; nenhum E2E destrutivo foi executado.

## Objetos ausentes por fluxo

| Fluxo | Tabelas ausentes | RPCs ausentes |
|---|---|---|
| Agenda | nenhuma das tabelas declaradas | `create_appointment_with_requirements_secure`, `get_scheduling_requirements` |
| Call Center | `scheduling_contact_logs`, `scheduling_call_center_tasks`, `scheduling_confirmation_queue` | `refresh_confirmation_queue_secure`, `record_confirmation_attempt_secure` |
| Atendimento | nenhuma das tabelas declaradas; a constraint `billings_company_appointment_key` ainda depende de aplicação/runtime | nenhum RPC ausente; `update_appointment_status_secure` e `find_price` estão comprovados na baseline local |
| Faturamento | `billing_accounts`, `billing_pending_issues`, `billing_competencies` | `billing_check_pending` |

Views ausentes que também bloqueiam o painel de Faturamento: `v_billing_receita_convenio`, `v_billing_receita_mensal` e `v_billing_indicadores`.

## Dependências que ainda bloqueiam uso real

1. Resolver a divergência de RPC da Agenda antes de liberar criação com requisitos.
2. Entregar o schema/RPCs do Call Center ou retirar temporariamente o fluxo da integração real.
3. Entregar o schema de contas, pendências, competências, views e RPCs do Faturamento.
4. Aplicar e validar as constraints tenant de `billings`; o guard local de idempotência não substitui unicidade no banco.
5. Validar Auth, `user_profiles`, papel e `company_id` no ambiente alvo, além das políticas RLS dos fluxos confirmados.

## Critérios de liberação por fluxo

**Agenda**: liberar somente após alinhar o serviço aos RPCs existentes ou disponibilizar os dois RPCs ausentes, confirmar assinaturas/grants para `authenticated`, validar conflito de horário e transições em PostgreSQL, e passar leitura/criação/remarcação/cancelamento em dois tenants de teste.

**Call Center**: liberar somente após criar/confirmar as três tabelas com FKs, estados e índices necessários, disponibilizar os dois RPCs de fila/confirmacão, validar `auth.uid()` -> `user_profiles` -> `company_id`, RLS de leitura/escrita e auditoria de contato/tarefa.

**Atendimento**: liberar somente após confirmar `medical_records`, `billings` e `price_tables` com RLS aplicada, `find_price` e status RPC executáveis, constraint `billings_company_appointment_key` ativa sem duplicidades, e teste runtime que repita a conclusão em sessões distintas sem duplicar registro/cobrança.

**Faturamento**: liberar somente após disponibilizar as três tabelas, `billing_check_pending` e as três views, validar papéis financeiro/gestor, RLS tenant, estados de pendência/reabertura, fechamento de competência e dados mínimos que produzam indicadores não nulos.

## Resultado desta rodada

- O contrato executável está em `src/config/mvpFlowContracts.ts` e exige os seis campos operacionais de cada fluxo.
- Os 32 testes independentes do backend permanecem fechados.
- Os contratos dependentes continuam condicionados ao schema baseline; a matriz identifica exatamente o que precisa existir antes da integração.
- Check-in tem contrato local dos RPCs; faturamento tem guarda idempotente por `appointment_id`/empresa, mas ainda requer unicidade persistente no schema autorizado.
- `billing_accounts` possui testes focados de filtros, glosa, erro de schema e status pronto para envio.
- Os contratos agora carregam `baselineStatus` e `baselineEvidence`, evitando classificar como integrado um fluxo cujo objeto de schema/RPC não está presente localmente.

## Critério de aceite global

Cada fluxo só é considerado pronto quando: aceite funcional, permissão, estados de sucesso/vazio/carregamento, erro recuperável, teste focado e dependências obrigatórias estão documentados. Nenhum item desta matriz autoriza alteração de VPS/DataSIGH, publicação ou E2E destrutivo.
