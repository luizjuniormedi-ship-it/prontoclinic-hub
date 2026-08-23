# Auditoria de RPCs no origin/main

Data: 2026-08-23  
Base: `origin/main` em `281b24fc262a46890f19f42204cd132e7cdf7bd9`

## Resultado

O inventário estático reconhece 224 migrations, 405 funções SQL e 137 chamadas
RPC no código de aplicação. O gate strict permanece bloqueado porque oito nomes
chamados pelo frontend não possuem definição SQL rastreável nesta base.

Isso não autoriza criar aliases ou migrations copiadas da branch antiga. Cada
contrato precisa ser reconciliado por domínio, com assinatura, payload, retorno,
grants e teste de runtime comprovados.

| RPC chamado | Arquivo | Decisão atual |
|---|---|---|
| `bedside_check` | `src/services/nursingCareService.ts` | Definir contrato de conferência, auditoria e permissões antes de implementar |
| `calc_imc` | `src/services/encountersService.ts` | Preferir cálculo puro local; não criar RPC sem requisito de persistência |
| `check_prescription_safety` | `src/services/encountersService.ts` | Avaliar adaptação ao `m20_validate_prescription_secure`; payloads não são equivalentes |
| `m9_get_patient_appointments_timeline_secure` | `src/services/patientAppointmentsService.ts` | Definir contrato canônico de linha do tempo |
| `m9_check_patient_appointment_conflicts_secure` | `src/services/patientAppointmentsService.ts` | Não substituir silenciosamente por `assert_appointment_slot_available` |
| `resolve_insurance_rule` | `src/services/insuranceContractService.ts` | Avaliar `validate_insurance_operation` somente com contexto obrigatório completo |
| `upsert_professional_schedule_grid_secure` | `src/services/scheduleGridsService.ts` | Migrar para o modelo canônico `professional_schedule_grades` |
| `set_professional_schedule_grid_status_secure` | `src/services/scheduleGridsService.ts` | Migrar para o contrato canônico de grades/publicação |

## Critério de fechamento

Uma RPC só pode sair da lista após comprovar no mesmo baseline:

1. função SQL e assinatura;
2. grants para os papéis usados;
3. payload e retorno compatíveis com o chamador;
4. teste unitário sem mock enganoso;
5. replay em banco descartável e teste de isolamento;
6. validação remota somente leitura antes de qualquer publicação.

As quatro ausências diretas encontradas por um inventário restrito a chamadas
`.rpc()` (`bedside_check`, `calc_imc`, `check_prescription_safety` e
`resolve_insurance_rule`) não anulam as outras quatro: elas aparecem em wrappers
e superfícies de serviço e devem ser classificadas, não ignoradas.

## Gates fora do checkout

TISS externo, replay remoto, backup/restore/rollback e homologação VPS continuam
bloqueados por pré-requisitos externos. Nenhum deles foi executado nesta rodada.
DataSIGH não foi acessado ou alterado.
