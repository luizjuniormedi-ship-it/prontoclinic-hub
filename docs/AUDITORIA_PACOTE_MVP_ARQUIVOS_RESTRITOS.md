# Auditoria do pacote MVP contra arquivos restritos

## Escopo e ressalva

O workspace não contém uma lista nominal dos cinco arquivos classificados como restritos. Portanto, a auditoria abaixo usa cinco fronteiras de integração assumidas, escolhidas pelo impacto em rotas, identidade e contratos de backend. A lista oficial deve ser confirmada antes da abertura da PR; sem isso, o conflito é considerado pendente.

## Cinco fronteiras auditadas

| Arquivo assumido como restrito | Fluxos afetados | Conflito do pacote | Decisão para PR |
|---|---|---|---|
| `src/App.tsx` | os 7 fluxos, por roteamento/layout | pacote não deve alterar registro de rotas; `BillingAccountsPage` pode introduzir tela nova | bloquear qualquer diff de rota; incluir somente se a rota já existir no oficial |
| `src/config/routePermissions.ts` | autenticação, paciente, agenda, recepção, atendimento, faturamento | patches MVP ajustam RBAC e podem conflitar com matriz oficial de papéis | aplicar manualmente e exigir teste de permissão por fluxo |
| `src/hooks/useAuth.tsx` | autenticação, todos os fluxos tenant-aware | pacote depende de `company_id`, `role_name` e sessão; mudanças de auth não devem ser carregadas por cópia ampla | não copiar arquivo inteiro; resolver apenas diff compatível com contrato oficial |
| `src/services/appointmentsService.ts` | agenda, recepção, atendimento | serviço chama `create_appointment_with_requirements_secure`/`get_scheduling_requirements`, ausentes na baseline local | conflito bloqueante até alinhar RPC ou contrato backend |
| `src/services/financialService.ts` | atendimento, faturamento | `createForAppointment` depende de `appointment_id`, empresa e unicidade persistente | aplicar com teste local; liberar runtime só com constraint/RLS validados |

## Conflitos por fluxo

| Fluxo | Conflito frontend | Conflito backend/runtime | Classificação |
|---|---|---|---|
| Autenticação/sessão | `App.tsx`, `routePermissions.ts`, `useAuth.tsx` são fronteiras compartilhadas | Auth, perfil, claims e `company_id` não são comprovados somente por migration | pendente de lista oficial + runtime |
| Paciente | permissões compartilhadas; serviço/páginas fora das cinco fronteiras | `patients`/RLS precisam validação PostgreSQL | não bloqueado localmente; runtime pendente |
| Agenda | `appointmentsService.ts` e `routePermissions.ts` têm alto risco de conflito | dois RPCs chamados pelo serviço estão ausentes; RPCs existentes têm nomes diferentes | bloqueante |
| Call Center | página/serviço aplicáveis, mas dependem de guards compartilhados | três tabelas e dois RPCs ausentes | bloqueante backend |
| Recepção/check-in | `routePermissions.ts` e `useAuth.tsx`; serviço canônico separado | RPCs/tabelas locais comprovados, mas RLS/grants e legado exigem runtime | liberável após runtime |
| Atendimento | `financialService.ts`, `routePermissions.ts`, `useAuth.tsx` | constraint de billing, RLS e concorrência entre sessões | parcial; runtime obrigatório |
| Faturamento | `financialService.ts`, permissões e condição de existência da página | contas, pendências, competências, RPC de glosa e views ausentes | bloqueante backend |

## Ordem de resolução de conflitos

1. Confirmar a lista real dos cinco arquivos restritos no repositório oficial.
2. Comparar `App.tsx`, `routePermissions.ts` e `useAuth.tsx` com a branch oficial sem copiar arquivos inteiros.
3. Resolver a divergência de RPC da Agenda antes de integrar a página/serviço.
4. Integrar `financialService.ts` somente com a garantia local de idempotência preservada e o gate PostgreSQL explicitado.
5. Integrar serviços/páginas não restritos em pares com seus testes, sem adicionar rotas.
6. Manter Call Center e Faturamento como dependências de PR backend enquanto os objetos ausentes não existirem.

## Checklist de PR

- [ ] Lista oficial dos cinco arquivos restritos confirmada e anexada à PR.
- [ ] Nenhum arquivo restrito foi copiado integralmente sem revisão de diff.
- [ ] `App.tsx` não ganhou rota ou tela nova.
- [ ] RBAC dos sete fluxos preserva os papéis oficiais.
- [ ] Agenda está bloqueada até resolver os RPCs divergentes/ausentes.
- [ ] Call Center e Faturamento estão marcados como dependências backend, sem falso sinal verde local.
- [ ] Atendimento mantém `appointment_id`/empresa e não promete unicidade sem constraint runtime.
- [ ] Testes locais focados: 92 aprovados.
- [ ] Testes PostgreSQL/RLS/grants/concorrência estão separados e pendentes.
- [ ] Build/lint e warnings registrados.
- [ ] PR criada como draft em branch própria; sem merge, push ou publicação nesta etapa.

## Resultado

O pacote é integrável apenas de forma parcial: contratos, estados, retry, RBAC e testes locais podem ser preparados; Agenda, Call Center, Atendimento e Faturamento mantêm gates backend/runtime explícitos. Nenhuma tela foi criada e nenhum arquivo remoto foi alterado.
