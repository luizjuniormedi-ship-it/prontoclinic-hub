# ProntoMedic - Relatório de Distância até o Produto Final

**Data da auditoria:** 2026-07-19  
**Fonte normativa:** `docs/PRONTOMEDIC_DIRETRIZ_MESTRE.md`  
**Regra:** nenhum módulo seguinte deve avançar enquanto o módulo atual tiver gate crítico aberto.

## Resumo executivo

O ProntoMedic possui uma base local extensa de frontend, services, migrations, Edge Functions e testes. Isso não equivale a produto final. O estado atual é:

- **Módulo atual:** 2 - Usuários, Perfis e Permissões.
- **Implementação local do Módulo 2:** concluída no checkout.
- **Validação local:** type-check aprovado; 43 arquivos de teste, 493 aprovados e 1 ignorado; lint com 0 erros; build aprovado.
- **Revalidação focada do Módulo 2 em 2026-07-19:** 10 testes de autenticação/permissões/rotas aprovados; gate local de segurança 7/7; `local-auth-server.mjs` válido.
- **Validação remota:** não concluída. A migration e a Edge Function ainda não foram aplicadas/revalidadas no Supabase autorizado.
- **Produção:** bloqueada.
- **DataSIGH:** não acessado nem alterado; deve permanecer assim.

## Estado dos Módulos 1 e 2

| Módulo | Estado local | Estado VPS/banco | Liberação |
|---|---|---|---|
| 1. Autenticação | Implementado e validado localmente | Runtime de autenticação online, mas paridade de release não revalidada | Bloqueado |
| 2. Usuários, perfis e permissões | Implementado e validado localmente | Código e schema divergentes; schema VPS parcial | Bloqueado |

Regra permanente: um módulo só muda de “localmente pronto” para “liberado” após backup, rollback, migration controlada, deploy, paridade de código/schema, smoke test e evidências. O DataSIGH permanece somente leitura e fora desse processo.

## O que falta para o produto final

### 1. Fechar o Módulo 2 no ambiente autorizado

1. Fazer backup verificável do banco alvo e registrar rollback.
2. Aplicar `supabase/migrations/20260719090000_users_profiles_permissions.sql` em ambiente autorizado.
3. Publicar `supabase/functions/admin-user-invite` com secrets configurados fora do frontend.
4. Executar replay do schema em banco descartável e confirmar ordem/idempotência das migrations.
5. Validar RLS/RBAC com usuários de duas empresas, duas unidades e perfis distintos.
6. Validar convite, ativação, bloqueio, desligamento, expiração, delegação e revogação em runtime.
7. Confirmar auditoria de toda mudança de perfil, permissão, unidade e delegação.
8. Repetir type-check, testes, lint, build e E2E autenticado contra o ambiente autorizado.

### 2. Fechar os módulos 3 a 57

O repositório contém páginas, services ou migrations para várias frentes, mas elas não podem ser marcadas como prontas sem banco aplicado, API real, permissões backend, auditoria, testes integrados e E2E. O inventário abaixo é deliberadamente conservador.

| Módulo | Situação atual | Falta principal antes da liberação |
|---|---|---|
| 3. Unidades, setores e recursos | Parcial | Validar estrutura, vínculos, recursos, RLS e operações por unidade em PostgreSQL. |
| 4. Profissionais | Parcial | Publicar/validar catálogo, vínculos, habilitações, auditoria e isolamento por unidade. |
| 5. Configurações | Parcial | Versionamento, escopo por unidade, aprovação, histórico e parâmetros sensíveis. |
| 6. Auditoria e logs | Parcial | Provar cobertura de leitura, alteração, exportação, retenção e imutabilidade. |
| 7. LGPD e consentimentos | Parcial | Validar versões, revogações, base legal, compartilhamento e retenção em runtime. |
| 8. Pacientes | Parcial | Validar duplicidade, unificação, histórico, documentos e RLS multiempresa. |
| 9. Agendamento | Bloqueado | Resolver divergência dos RPCs da baseline e validar conflitos/transições no banco. |
| 10. Call Center | Bloqueado | Criar/validar tabelas de contatos, tarefas, fila e RPCs de confirmação. |
| 11. Recepção/check-in | Parcial | Aplicar migrations, validar elegibilidade/autorização/TISS e E2E real. |
| 12. Filas e senhas | Parcial | Validar prioridade, transferência, SLA, painel e auditoria de chamadas. |
| 13. Convênios e planos | Parcial | Validar vigências, snapshots históricos, regras por unidade e glosa. |
| 14. Elegibilidade | Parcial | Integrar fonte oficial de convênios, protocolos, comprovantes e exceções. |
| 15. Autorizações | Parcial | Centralizar autorização, consumo, validade, anexos, negativa e auditoria. |
| 16. Guias TISS | Bloqueado | Validar schema, geração, assinatura, XML, versão TISS e homologação externa. |
| 17. Prontuário eletrônico | Parcial | Provar versionamento, assinatura, retificação, acesso emergencial e auditoria. |
| 18. Atendimento médico | Parcial | Validar jornada clínica completa, assinatura, prescrição e cobrança transacional. |
| 19. Enfermagem e triagem | Parcial | Validar filas, sinais, protocolos, checagem e segurança assistencial. |
| 20. Prescrição eletrônica | Parcial | Validar interação, alergias, assinatura, histórico e revisão profissional. |
| 21. Protocolos assistenciais | Parcial | Validar execução auditada, alertas, escalonamento e revisão humana. |
| 22. Solicitação de exames | Parcial | Validar pedidos, autorização, preparo, assinatura e rastreamento. |
| 23. Laboratório/LIS | Parcial | Validar amostras, equipamentos, resultados críticos, QC e integração. |
| 24. Imagem/RIS | Parcial | Validar agenda, execução, PACS/Orthanc, laudo, C-STORE/C-FIND e RLS. |
| 25. Farmácia clínica | Parcial | Validar dispensação, conciliação, rastreabilidade e eventos adversos. |
| 26. Medicamentos | Parcial | Validar estoque assistencial, administração, lote, validade e assinatura. |
| 27. Materiais | Parcial | Validar consumo, reserva, devolução, lote e vínculo com faturamento. |
| 28. Estoque assistencial | Parcial | Validar saldos, FEFO, inventário, transferências e concorrência. |
| 29. Estoque | Parcial | Validar movimentos, perdas, ajustes, rastreabilidade e permissões. |
| 30. Compras e suprimentos | Parcial | Validar cotação, aprovação, recebimento, NF, divergência e fornecedores. |
| 31. OPME | Parcial | Validar autorização, lote/série, reserva, consumo e conta cirúrgica. |
| 32. Internação | Parcial | Validar episódio, leito, prescrição, transferência, alta e conta. |
| 33. Leitos | Parcial | Validar disponibilidade, bloqueio, isolamento, giro e concorrência. |
| 34. Centro cirúrgico | Parcial | Validar mapa, equipe, materiais, checklist, tempos e faturamento. |
| 35. Anestesia | Parcial | Validar avaliação, monitorização, eventos, recuperação e assinatura. |
| 36. Faturamento | Bloqueado | Criar/validar contas, pendências, competências, views, glosa e RLS. |
| 37. Auditoria de contas | Parcial | Validar auditoria técnica, documentos, pendências, aprovação e devolução. |
| 38. Glosas | Parcial | Validar importação, recurso, reapresentação, retorno e indicadores. |
| 39. Financeiro | Parcial | Validar caixa, conciliação, estorno, DRE, RLS e fechamento. |
| 40. Repasses médicos | Parcial | Validar regras, produção, glosa, impostos, fechamento e contestação. |
| 41. Fiscal | Parcial | Validar NFS-e, impostos, cancelamento, integração municipal e contábil. |
| 42. CRM | Parcial | Validar leads, consentimento, conversão, campanhas e follow-up. |
| 43. WhatsApp e comunicação | Parcial | Configurar provider, consentimento, retry, histórico e templates reais. |
| 44. Portal do paciente | Parcial | Validar auth isolada, documentos, pagamentos, resultados e responsável legal. |
| 45. NPS e satisfação | Parcial | Validar pesquisas, consentimento, métricas e plano de ação. |
| 46. Telemedicina | Parcial | Validar provider, sala segura, consentimento, prontuário e cobrança. |
| 47. BI | Parcial | Substituir indicadores sintéticos por consultas reais e validar desempenho. |
| 48. Relatórios | Parcial | Validar filtros, permissões, exportação, histórico e dados reais. |
| 49. Inteligência artificial | Parcial | Registrar modelo, versão, contexto, revisão humana e impedir ações críticas autônomas. |
| 50. Workflow e automações | Parcial | Validar eventos, filas, retry, compensação, SLA e dead-letter. |
| 51. Integrações | Parcial | Validar auth, idempotência, timeout, retry, correlação e reprocessamento. |
| 52. Documentos e arquivos | Parcial | Validar antivírus, URLs temporárias, retenção, versionamento e auditoria. |
| 53. Notificações | Parcial | Configurar providers, templates, preferências, retry e leitura. |
| 54. Tarefas e pendências | Parcial | Validar responsável, SLA, recorrência, aprovação e escalonamento. |
| 55. Backup e continuidade | Não comprovado | Executar backup, restore, rollback, RPO/RTO e teste de recuperação. |
| 56. Observabilidade | Parcial | Validar logs estruturados, métricas, tracing, alertas e dashboards técnicos. |
| 57. Suporte e Help Desk | Parcial | Validar chamados, SLA, histórico, conhecimento, incidentes e relatórios. |

## Bloqueios que impedem a entrega hoje

1. Migration e Edge Function do Módulo 2 não aplicadas no ambiente remoto.
2. Replay real de RLS/RBAC e isolamento multiempresa/unidade não comprovado.
3. Backup, restore e rollback ainda não comprovados para a release atual.
4. E2E autenticado contra ambiente remoto ainda não equivale aos testes locais.
5. Agenda tem divergência de RPC na baseline.
6. Call Center tem objetos/RPCs ausentes na baseline local.
7. Faturamento tem contas, pendências, competências, views e RPCs ausentes.
8. TISS exige homologação real, validação de versão, assinatura e XML autorizado.
9. PACS/RIS exige validação operacional de Orthanc, Worklist, C-FIND e C-STORE sem dados indevidos.
10. Providers externos, backups, observabilidade e integrações críticas precisam de configuração e evidência.

## Ordem de execução para chegar ao produto final

1. Fechar Módulo 2 remoto com backup, migration, Edge Function, RLS/RBAC, replay e E2E.
2. Registrar evidência e só então iniciar Módulo 3.
3. Fechar Módulos 3 e 4, pois unidades e profissionais são dependências da operação.
4. Resolver as divergências de Agenda, Call Center e Faturamento antes de declarar os fluxos MVP.
5. Fechar Recepção, TISS, Prontuário, Atendimento, Enfermagem, Exames e Imagem com runtime real.
6. Fechar financeiro, integrações, documentos, notificações, backup e observabilidade.
7. Executar a suíte final: instalação limpa, migrations do zero, seed, type-check, lint, unitários, integração, E2E, segurança, rotas, botões, permissões, logs e dados reais autorizados.
8. Só depois emitir o checklist de produção.

## Conclusão

O sistema está em desenvolvimento avançado local, mas **não é produto final nem está liberado para produção**. O próximo trabalho obrigatório continua sendo fechar os gates remotos do Módulo 2. Nenhum avanço de módulo e nenhuma alteração no DataSIGH estão autorizados por este relatório.
