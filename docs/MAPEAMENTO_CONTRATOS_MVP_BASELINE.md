# Mapeamento dos contratos MVP para a baseline local

Classificação estática do workspace atual. `comprovada` significa que a tabela/RPC é referenciada ou definida por migration local; `ausente` significa que o serviço usa o objeto, mas não há definição encontrada nas migrations; `dependente-runtime` significa que a migration existe, mas a garantia depende da aplicação no banco, dados válidos ou sessão/RLS.

## Agenda

| Recurso | Tipo | Situação |
|---|---|---|
| `appointments`, `patients`, `professionals`, `specialties`, `appointment_types`, `services_catalog` | tabelas | comprovadas |
| `create_appointment_secure`, `update_appointment_status_secure`, `reschedule_appointment_secure` | RPCs | comprovadas |
| `can_transition_appointment_status`, `get_scheduling_actor`, `assert_scheduling_permission`, `assert_appointment_slot_available` | RPCs internas | comprovadas |
| `create_appointment_with_requirements_secure`, `get_scheduling_requirements` | RPCs chamadas pelo serviço | ausentes |
| sessão authenticated, actor/tenant e RLS/grants | runtime | dependentes de runtime |

## Call Center

| Recurso | Tipo | Situação |
|---|---|---|
| `user_profiles`, `patients` | tabelas | comprovadas |
| `scheduling_contact_logs`, `scheduling_call_center_tasks`, `scheduling_confirmation_queue` | tabelas | ausentes |
| `refresh_confirmation_queue_secure`, `record_confirmation_attempt_secure` | RPCs | ausentes |
| `auth.getUser()`, perfil ligado ao `auth.uid()`, `company_id` e RLS/grants | runtime | dependentes de runtime |

## Atendimento

| Recurso | Tipo | Situação |
|---|---|---|
| `appointments`, `patients`, `medical_records`, `billings`, `price_tables` | tabelas | comprovadas |
| `update_appointment_status_secure`, `find_price` | RPCs | comprovadas |
| `billings_company_appointment_key` | constraint de idempotência | dependente de runtime |
| sessão tenant, RLS de prontuário/faturamento e dados de preço vigentes | runtime | dependentes de runtime |

## Faturamento

| Recurso | Tipo | Situação |
|---|---|---|
| `patients`, `billings` | tabelas | comprovadas |
| `billing_accounts`, `billing_pending_issues`, `billing_competencies` | tabelas | ausentes |
| `billing_check_pending` | RPC | ausente |
| `v_billing_receita_convenio`, `v_billing_receita_mensal`, `v_billing_indicadores` | views | ausentes |
| perfil financeiro/gestor, RLS tenant, competência aberta e dados de faturamento | runtime | dependentes de runtime |

## Critério de integração

Os quatro fluxos só podem ser classificados como integráveis quando todos os recursos `ausentes` forem fornecidos na baseline autorizada e os itens `dependente-runtime` forem verificados no ambiente alvo. Nenhuma migration, VPS, DataSIGH ou publicação foi alterada nesta rodada.
