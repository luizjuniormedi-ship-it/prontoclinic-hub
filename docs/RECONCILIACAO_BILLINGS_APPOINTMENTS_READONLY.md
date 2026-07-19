# Reconciliacao `billings` x `appointments`

## Objetivo

Produzir evidencia para o bloqueio de `appointment_id` sem alterar a VPS, o
DataSIGH ou o banco operacional. O SQL associado e explicitamente somente
leitura e termina com `ROLLBACK`.

Arquivo executavel: `scripts/reconcile-billings-appointments-readonly.sql`.

## Regra de seguranca

Nao aplicar `appointment_id NOT NULL`, FK composta, backfill ou qualquer
deduplicacao antes da revisao financeira. A relacao existente
`appointments.billing_id = billings.id` nao e suficiente para escolher um
agendamento quando ha duplicidade.

## Evidencia atual da VPS

| Medicao | Resultado |
|---|---:|
| Faturamentos | 15.899 |
| Faturamentos mapeados | 15.074 |
| Faturamentos sem mapeamento | 825 |
| Grupos duplicados de `billing_id` | 351 |
| Divergencias de empresa nos mapeados | 0 |
| `billings.company_id` nulo | 0 |
| `billings.appointment_id` existente | nao |

## Procedimento de aceite

1. Executar o SQL em clone descartavel ou com usuario de leitura.
2. Anexar a saida agregada ao registro de auditoria, sem nomes, CPF,
   matriculas ou outros dados identificaveis.
3. Para os 825 sem vinculo, registrar uma decisao financeira por lote:
   `vincular`, `manter_sem_vinculo` ou `cancelar/revisar`.
4. Para os 351 duplicados, indicar explicitamente o agendamento valido ou
   justificar a manutencao da duplicidade.
5. Gerar um mapping aprovado e validado em PostgreSQL efemero.
6. Somente depois executar replay RLS e testar isolamento multiempresa.

## Gate

Enquanto o mapping aprovado nao existir, o produto permanece **NAO APTO PARA
PRODUCAO**. Este artefato nao autoriza alteracao na VPS e nao acessa o
DataSIGH.
