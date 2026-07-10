# PRONTOMEDIC — PLANO ESTRUTURAL DE ENTREGA AO CLIENTE

> Regra absoluta: **Não avançar sem o módulo estar 100% operacional** (banco + backend + frontend + permissões + logs + testes + fluxo real).

---

## STATUS ATUAL (2026-07-09)

### ✅ MÓDULOS CONCLUÍDOS (100% operacionais)

| # | Módulo | Checklist | Dados SIGH | Segurança | Observação |
|---|--------|:---------:|:----------:|:---------:|------------|
| M1 | Base/Admin/Auth | 35/35 | 87/87 usuários | 20/20 | RBAC server-side ativo |
| M2 | Pacientes | 28/28 | 83.624 (100%) | 10/10 | LGPD: recepção bloqueada de prontuário |
| M3 | Convênios/Planos | 37/37 | 992 convênios | 10/10 | CID referência livre |
| M4 | Agenda | 36/36 | 248.067 | 11/11 | Ciclo transacional (Codex) |
| M5 | Recepção | 23/23 | 5.607 senhas | 10/10 | Autorização/elegibilidade (Bloco 1) |
| M6 | Prontuário | 28/28 | 9.259 records | 10/10 | LGPD: bloqueio ativo |
| M7 | Enfermagem | 19/19 | Triagem ativa | — | Segurança testada |
| M8 | Farmácia | 27/27 | Catálogos BRASINDICE/SIMPRO | ✅ | Menor privilégio aplicado |
| M9 | Laboratório | 25/25 | Pedidos/resultados | — | — |
| M10 | Imagem/DICOM | 17/17 | Schemas existem | — | — |
| M11 | Faturamento | 36/36 | 13.534 lançamentos | — | Glosa preventiva ativa |
| M12 | Financeiro | 36/36 | 13.534 contas | — | Fluxo de caixa real |
| L | Laudos | 24/24 | 7.714 reports | — | Executor + solicitante SIGH |
| PEP | PEP | 21/21 | 1.543 encounters | — | Segurança de prescrição |

### 🔨 MÓDULOS INCOMPLETOS (precisam de trabalho antes da entrega)

| # | Módulo | % | O que falta | Esforço |
|---|--------|:--:|-------------|:------:|
| E1 | **Segurança (arquitetura)** | 70% | Role restrito + RLS nativo no PostgreSQL | 2-3d |
| E2 | **Recepção Bloco 2** | 40% | Guia TISS estruturada assinável (consulta/SP-SADT) | 2d |
| E3 | **Recepção Bloco 3** | 30% | Caixa-sessão, Documentos, Exceção | 2d |
| E4 | **Call Center** | 80% | Frontend OK (Codex), falta testar fluxo real | 0.5d |
| E5 | **11 services sem testes** | 60% | Testes unitários para billing, reports, encounters, etc | 2d |
| E6 | **God components** | — | 10 arquivos >500 linhas — refatorar | 3d |
| E7 | **Telemedicina** | 10% | Schemas existem, 0 dados, 0 telas | 3d |
| E8 | **BI / Dashboards** | 15% | Schemas, sem dados reais | 4d |
| E9 | **Portal do Paciente** | 5% | Não iniciado | 5d |
| E10 | **WhatsApp** | 5% | Não iniciado | 5d |
| E11 | **Internação** | 10% | Schemas, sem fluxo | 4d |
| E12 | **Centro Cirúrgico** | 5% | Não iniciado | 5d |

---

## FOCO DA FASE 1 (entrega mínima funcional)

**Data alvo:** 2 semanas  
**Critério:** Clínica consegue operar consultas + exames + faturamento com segurança.

### Ordem de execução (por dependência)

| Ordem | Item | Depende de | Critério de aceite |
|:-----:|------|-----------|---------------------|
| 1 | **Segurança (E1)** | Nenhum | Role app_prontomedic sem superuser; RLS policies ativas em patients + appointments + medical_records |
| 2 | **11 services com testes (E5)** | Nenhum | Cobertura ≥80% nos services críticos (billing, reports, encounters, userProfiles) |
| 3 | **Recepção Bloco 2 (E2)** | E1 | Guia de consulta e SP-SADT geradas, assináveis, com validação ANS |
| 4 | **Recepção Bloco 3 (E3)** | E2 | Caixa abre/fecha, documentos anexados, exceção com trilha |
| 5 | **Call Center (E4)** | E2 | Fluxo completo: ligação → cadastro → agendamento testado |

### Checklist por item (só avança se 100%)

#### E1 — Segurança (Arquitetura)
- [ ] Criar role PostgreSQL `app_prontomedic` sem superuser
- [ ] Criar policies RLS para patients (recepção lê/escreve, médico lê, admin tudo)
- [ ] Criar policies RLS para appointments
- [ ] Criar policies RLS para medical_records
- [ ] Alterar local-auth-server.mjs para conectar como app_prontomedic
- [ ] Enforcement 20/20 mantido após migração
- [ ] Dia-real 24/24 mantido após migração

#### E2 — Recepção Bloco 2 (Guia TISS)
- [ ] Tabela `reception_tiss_guides` com campos ANS completos
- [ ] Tabela `reception_tiss_guide_signatures`
- [ ] Service `tissGuideService.ts` com CRUD + gerarPDF
- [ ] Tela de geração de guia de consulta
- [ ] Tela de geração de guia SP-SADT
- [ ] Assinatura digital no PDF
- [ ] Enforcement: recepção cria, médico assina, admin vê

#### E3 — Recepção Bloco 3 (Caixa + Documentos + Exceção)
- [ ] Tabela `reception_cash_sessions` (abrir/fechar/sangria/suprimento)
- [ ] Tabela `reception_documents` (anexar/validar/recusar)
- [ ] Tabela `reception_exception_releases` (com trilha)
- [ ] Service `receptionCashService.ts`
- [ ] Service `receptionDocumentsService.ts`
- [ ] Tela de caixa (abertura/fechamento)
- [ ] Tela de documentos
- [ ] Fluxo de liberação por exceção

#### E4 — Call Center
- [ ] Testar fluxo real: recepção → cadastro → agendamento
- [ ] Testar registro de contato (telefone, WhatsApp, email)
- [ ] Testar tarefas de call center
- [ ] Testar scripts de atendimento

#### E5 — Testes de services
- [ ] billingAccountsService.test.ts
- [ ] reportsService.test.ts
- [ ] encountersService.test.ts
- [ ] userProfilesService.test.ts
- [ ] nursingCareService.test.ts
- [ ] rolePermissionsService.test.ts
- [ ] catalogService.test.ts
- [ ] dicomService.test.ts
- [ ] professionalPaymentsService.test.ts
- [ ] tissService.test.ts
- [ ] systemSettingsService.test.ts

---

## MÉTRICAS DE QUALIDADE (gate de entrega)

| Métrica | Atual | Alvo Fase 1 |
|---------|:-----:|:-----------:|
| TypeScript erros | 0 | 0 |
| Testes unitários | 437 | ≥500 |
| Cobertura de testes (services) | ~60% (19/30) | ≥90% (27/30) |
| Enforcement RBAC | 20/20 | 20/20 |
| Fluxo completo (dia-real) | 24/24 | 24/24 |
| SQL injection | Bloqueado | Bloqueado |
| Dados vs SIGH | 83.624 (100%) | 83.624 (100%) |
| RLS policies ativas | 0 | ≥3 (patients, appointments, medical_records) |
| God components (>500 linhas) | 10 | 10 (débito aceito para Fase 1) |
| Services sem testes | 11 | 0 |

---

## REGRAS DE COLABORAÇÃO (Claude + Codex)

| Zona | Arquivos | Codex pode? |
|------|----------|:-----------:|
| 🔴 Vermelha | `local-auth-server.mjs`, `scripts/e2e_*.py`, `scripts/*checklist*.py` | ❌ NUNCA |
| 🟡 Amarela | `supabase/migrations/*.sql`, `src/services/*.ts`, `src/types/*.ts` | ⚠️ PR obrigatório |
| 🟢 Verde | `src/pages/*.tsx`, `src/components/**/*.tsx` | ✅ Livre |

---

## CRONOGRAMA (2 semanas)

| Semana | Dias | Entregas |
|--------|------|----------|
| **Semana 1** | 1-2 | E1 — Role restrito + RLS policies |
| | 3-5 | E5 — 11 services com testes + E2 — Guia TISS Fase 1 |
| **Semana 2** | 6-7 | E2 — Guia TISS Fase 2 (assinatura, PDF, ANS) |
| | 8-9 | E3 — Caixa + Documentos + Exceção |
| | 10 | E4 — Call Center validação + Integração final + Regressão |

---

## PRÓXIMO PASSO IMEDIATO

**Confirmar o escopo da Fase 1.** O cliente (POLICLINICA MEDILIFE) precisa de:
1. Operar consultas com segurança (já funciona ✅)
2. Emitir guia TISS na recepção (falta 🔨)
3. Cobrar particular/convênio e fechar caixa (falta 🔨)
4. Call center funcional (quase pronto 🔨)

Se este escopo está correto, começo pelo **E1 (Segurança)** agora — é a fundação que bloqueia produção e o pré-requisito para tudo abaixo.
