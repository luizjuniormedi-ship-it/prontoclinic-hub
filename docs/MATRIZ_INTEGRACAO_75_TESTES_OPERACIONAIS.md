# Matriz de integração — 75 testes operacionais

## Escopo e leitura

Baseline executado localmente em `src/`:

| Suíte | Testes | Prontos sem backend | Dependentes de schema/RPC |
|---|---:|---:|---:|
| `appointmentsService.test.ts` | 26 | 5 | 21 |
| `callCenterService.test.ts` | 4 | 0 | 4 |
| `financialService.test.ts` | 18 | 0 | 18 |
| `statusTransitions.test.ts` | 22 | 22 | 0 |
| `routePermissions.test.ts` | 3 | 3 | 0 |
| `formatters.test.ts` | 2 | 2 | 0 |
| **Total** | **75** | **32** | **43** |

`Passou` significa que a regra local foi exercitada com mocks. `Schema/RPC bloqueado` significa que o teste ainda não prova o contrato de um banco local autorizado: nomes de tabelas, colunas, RPCs, tipos, permissões e RLS permanecem dependências de integração.

## Matriz por teste

### Agenda / appointments — 26

| IDs | Cobertura | Classificação | Dependência de integração |
|---|---|---|---|
| A01–A03 | Busca por intervalo: dados, vazio e erro | Bloqueado | tabela `appointments`, leitura e RLS |
| A04 | Busca por uma data | Bloqueado | tabela `appointments`, filtros de data |
| A05–A07 | Último atendimento concluído: sucesso, vazio e erro | Bloqueado | tabela `appointments`, `patient_id`, `specialty_id`, `status` |
| A08–A10 | Criar agendamento, status default/customizado e erro | Bloqueado | RPC `create_appointment_with_requirements_secure` |
| A11–A12 | Atualização de dados e erro | Bloqueado | tabela `appointments`, update/select/single |
| A13–A14 | Status cancelado e transição inválida | Bloqueado | RPC `update_appointment_status_secure` |
| A15 | Reagendamento | Bloqueado | RPC `reschedule_appointment_secure` |
| A16–A20 | Regras puras de transição | Pronto local | máquina local de status |
| A21–A22 | Cancelamento lógico e erro | Bloqueado | RPC `update_appointment_status_secure` |
| A23 | Lookup de profissionais | Bloqueado | tabela `professionals` |
| A24 | Lookup de especialidades | Bloqueado | tabela `specialties` |
| A25 | Lookup de tipos | Bloqueado | tabela `appointment_types` |
| A26 | Lookup de catálogo | Bloqueado | tabela `services_catalog` |

### Call Center — 4

| IDs | Cobertura | Classificação | Dependência de integração |
|---|---|---|---|
| C01 | Lista contatos com paciente embutido | Bloqueado | `scheduling_contact_logs`, relação `patients` |
| C02 | Cria contato e tarefa | Bloqueado | `user_profiles`, `scheduling_contact_logs`, `scheduling_call_center_tasks` |
| C03 | Rejeita motivo vazio | Parcialmente local | validação local, mas consulta ator em `user_profiles` |
| C04 | Conclui tarefa | Bloqueado | `scheduling_call_center_tasks` |

### Faturamento / financeiro — 18

| IDs | Cobertura | Classificação | Dependência de integração |
|---|---|---|---|
| F01–F03 | Lista faturamentos: dados, vazio e erro | Bloqueado | tabela `billings` |
| F04–F06 | Cria faturamento: defaults, customização e erro | Bloqueado | insert em `billings` |
| F07–F08 | Atualiza status e erro | Bloqueado | update em `billings` |
| F09–F11 | Lista transações: dados, vazio e erro | Bloqueado | tabela `financial_transactions` |
| F12–F14 | Cria transação: defaults, customização e erro | Bloqueado | insert em `financial_transactions` |
| F15–F16 | Marca como pago e erro | Bloqueado | update em `financial_transactions`, data de pagamento |
| F17–F18 | Atualiza status e erro | Bloqueado | update em `financial_transactions` |

### Regras locais / permissões / datas — 27 adicionais

| Suíte | IDs | Classificação |
|---|---|---|
| `statusTransitions` — agenda, imagem, laudo, billing e labels | S01–S22 | Pronto local |
| `routePermissions` — atendimento, faturamento e aliases | R01–R03 | Pronto local |
| `formatters` — calendário local e adição de dias | D01–D02 | Pronto local |

Os cinco testes locais A16–A20 da suíte de Agenda completam os **32 testes locais** do baseline.

## Dependências ainda bloqueadas

1. **Check-in direto não está dentro dos 75:** `get_reception_checkin_readiness` e `perform_reception_checkin_secure` precisam de testes de contrato local autorizados.
2. **Fila de confirmação do Call Center:** `refresh_confirmation_queue_secure` é acionado pela tela, mas não está coberto no baseline.
3. **Contas por atendimento:** `billing_accounts`, `billing_pending_issues`, `billing_competencies` e views de receita não têm suíte própria no baseline.
4. **RLS/tenant:** todos os testes de serviço usam mocks; eles não garantem isolamento por `company_id`, `unit_id` ou papel.
5. **Faturamento automático do Atendimento:** o frontend tenta criar `billings` após concluir o atendimento, mas o baseline não prova idempotência desse vínculo em banco local.

## Suplementos adicionados nesta rodada

- `receptionService.test.ts`: 3 testes do contrato dos RPCs de prontidão e check-in.
- `callCenterService.test.ts`: 1 teste do RPC de atualização da fila de confirmações.
- `integrationContracts.test.ts`: 2 testes do catálogo de pré-condições e pós-condições.
- `billingAccountsService.test.ts`: 4 testes de filtros, glosa, erro de schema e prontidão para envio.
- `financialService.test.ts`: 3 testes adicionais de vínculo e idempotência por atendimento.
- Total após os suplementos: **88 testes locais**; a classificação acima permanece referente aos 75 testes baseline.

## Critério de prontidão para integração

- Os 32 testes locais devem continuar verdes sem acesso externo.
- Os 43 testes dependentes devem ser reexecutados contra banco local/efêmero autorizado, com schema e RPCs versionados, antes de homologação.
- Check-in, fila de confirmação e `billing_accounts` devem ganhar testes de contrato antes de serem classificados como integrados.
- O contrato `attendance.record-billing` exige `appointment_id` persistido e uma garantia de unicidade no schema local/autorizado; a guarda concorrente do frontend não substitui essa garantia.
- Nenhuma migration remota, publicação, acesso a VPS ou DataSIGH faz parte desta matriz.
