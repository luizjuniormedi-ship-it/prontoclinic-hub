# ProntoMedic - Status de Execucao

Atualizado em: 2026-07-10

| Modulo | Situacao inicial | Status | Evidencia | Bloqueio/proximo passo |
|---|---|---|---|---|
| Infraestrutura e deploy | VPS instalada; release corrigida publicada | EM TESTE | Backup `20260710-220428`, release `/var/www/prontomedic/releases/20260710-220428`, Nginx valido | Executar healthcheck pos-release e provar rollback |
| Banco e migrations | PostgreSQL 18 com dados migrados | EM AUDITORIA | Dumps e auditorias de contagem | Validar migrations limpa/com dados e integridade por chave |
| Autenticacao | Login funcional apos recuperacao de JWT | EM CORRECAO | Rotacao/logout endurecidos; 4 testes de invariantes | Testar expiracao, bloqueio, recuperacao e concorrencia |
| RBAC/multiempresa | API nao aplicava escopo empresarial | EM CORRECAO | Escopo `company_id` e RPC fail-closed implementados | Executar integracao negativa com duas empresas/unidades |
| Pacientes/profissionais | Dados migrados e telas existentes | EM AUDITORIA | 83.625 pacientes observados | Validar CRUD, duplicidade, LGPD e paginacao |
| Agenda/call center | Fluxos implementados parcialmente | EM TESTE | E2E de agenda existente | Validar conflito, remarcacao, cancelamento e timezone |
| Recepcao/check-in | Fluxo e testes existentes | EM TESTE | `e2e/recepcao.spec.ts` | Validar autorizacao, guia, fila e rollback |
| Convenios/autorizacoes | 992 convenios, 395 planos; fundacao criada | EM CORRECAO | Migration `20260710193000` | Concluir deploy e regras operacionais E2E |
| TISS | 313 registros observados; fonte informa 544 ativos | BLOQUEADO | Reconciliador por `CD_XML` criado | Credenciais read-only e dry-run contra VPS |
| Prontuario/atendimento | Telas e services existentes | EM AUDITORIA | Testes unitarios parciais | Fechamento, assinatura, adendo e auditoria E2E |
| Laudos/DICOM | Rotas e services extensos | EM AUDITORIA | Componentes PACS/DICOM | Homologar integracoes e controle de acesso |
| Faturamento/financeiro | Telas, services e E2E parciais | EM AUDITORIA | Rotas e testes existentes | Validar duplicidade, estorno, glosa e conciliacao |
| Farmacia/enfermagem/lab | Implementacoes e testes unitarios | NAO ANALISADO | Inventario de codigo | Auditar por prioridade operacional |
| Seguranca/LGPD | Modulos e logs de auditoria existentes | EM AUDITORIA | Testes LGPD parciais | Threat model, acesso cruzado, retencao e incidente |
| Observabilidade | Logs PM2/Nginx consultaveis | EM DESENVOLVIMENTO | Healthcheck atual | Logs estruturados, metricas, alertas e correlacao |
| Release final | Nao comprovada | BLOQUEADO | Nenhuma auditoria final aprovada | Fechar P0/P1 e executar matriz E2E completa |

## Alteracoes desta rodada

- Commit `9a47e3a`: cobertura de carregamento e filtros TISS.
- Commit `69bd2df`: reconciliador TISS seguro e idempotente.
- Adicionado gate unico `npm run validate` (pendente de commit/execucao completa).
- Criada auditoria inicial e status de execucao.
- Suite atual: 445 testes aprovados; build de producao aprovado.
- CI endurecido: PostgreSQL 18, migrations bloqueantes e deploys legados manuais.
- Deploy da fase 1 executado na VPS: backup, build, migrations, contagens e Nginx aprovados.
- Falha residual apenas no wrapper PowerShell por conversao de `\r`; corrigida usando `scp` + `bash` remoto.

## Regras de atualizacao

- Registrar comandos e resultados reais.
- Nao usar `VALIDADO` com teste mockado como unica evidencia.
- Nao usar `PRONTO PARA PRODUCAO` enquanto existir P0/P1.
- Toda migration de producao exige backup e rollback verificavel.
