# PRONTOMEDIC — PROMPT DE AUDITORIA OPERACIONAL ENTERPRISE

> Use este prompt no Lovable para executar uma auditoria completa do sistema real contra a documentação oficial em `MODULES.md` e `IMPLEMENTATION_PLAN.md`.
> **NÃO cole junto com outros prompts.** Use este isoladamente em uma sessão dedicada de auditoria.

---

## MISSÃO: VALIDAR O SISTEMA REAL CONTRA O MODULES.md E IMPLEMENTATION_PLAN.md

Atue como um time especializado composto por:

- QA Engineer Enterprise
- Auditor de Sistemas Hospitalares
- Especialista HIS/ERP Hospitalar
- Engenheiro Fullstack Senior
- Especialista em Fluxos Assistenciais
- Especialista em Segurança e LGPD
- Analista de Testes E2E
- Especialista Supabase + React + TypeScript
- Especialista em Sistemas Clínicos Reais

Você está auditando o sistema **ProntoMedic** (repositório: prontoclinic-hub).

A documentação oficial está em:
- `MODULES.md`
- `IMPLEMENTATION_PLAN.md`

O objetivo **NÃO é gerar código novo imediatamente**.

Sua missão é:

1. TESTAR o sistema REAL existente
2. VALIDAR se os fluxos realmente funcionam
3. IDENTIFICAR funcionalidades fake/placeholders
4. VALIDAR integrações reais
5. TESTAR regras hospitalares
6. TESTAR segurança
7. TESTAR RBAC
8. TESTAR multiempresa
9. TESTAR persistência
10. GERAR RELATÓRIO REAL DE MATURIDADE

---

## REGRA CRÍTICA

**NÃO ASSUMA QUE FUNCIONA.**

Somente considere **✅ IMPLEMENTADO** quando houver:

- código funcional
- fluxo operacional real
- persistência real no Supabase
- integração real entre módulos
- navegação funcional
- validação funcional
- comportamento verificável e testável

Se houver qualquer um dos itens abaixo, marcar como **❌ NÃO IMPLEMENTADO**:

- mock ou mockData
- placeholder visual
- botão que não persiste
- toast sem persistência no banco
- tela sem backend real
- API simulada
- componente sem integração real
- hardcoded data

---

## O QUE DEVE SER TESTADO

---

### 1. AGENDAMENTO

**Validar:**
- Criação de agendamento com todos os campos obrigatórios
- Edição de agendamento existente
- Cancelamento com motivo obrigatório
- Remarcação com histórico preservado
- Lista de espera funcional
- Encaixe com justificativa obrigatória

**Fluxo de status (validar transições e bloqueios):**
```
agendado → confirmado → aguardando chegada → em triagem → em atendimento → atendido
(paralelos: faltou / cancelado / remarcado)
```

**Testar:**
- Transições inválidas (ex: atendido → em atendimento deve ser bloqueado)
- Validação de duplicidade de paciente por CPF/CNS/telefone
- Conflito de agenda (mesmo profissional, mesma sala, mesmo horário)
- Filtro por profissional, sala, unidade e data
- Integração com ReceptionPage (paciente agendado aparece na recepção)

**Validar tecnicamente:**
- Persistência real no Supabase (não mockData)
- TanStack Query: invalidação de cache após mutação
- RBAC: perfil recepção pode agendar, médico pode visualizar mas não editar
- Registro de auditoria a cada transição de status

---

### 2. RECEPÇÃO

**Validar:**
- Check-in do paciente agendado
- Fila administrativa com emissão de senha
- Confirmação de chegada com timestamp
- Leitura/digitação de carteirinha de convênio
- Recebimento de coparticipação com emissão de recibo
- Impressão de ficha e termos
- Encaminhamento para triagem, consulta ou exame

**Testar cenários de erro:**
- Paciente sem cadastro prévio (pré-cadastro na hora)
- Convênio com carteirinha vencida (alertar, bloquear ou liberar com justificativa)
- Autorização de convênio pendente
- Prioridade de atendimento: idoso 60+, gestante, PCD
- Paciente com débito financeiro anterior (alerta)

**Validar integrações:**
- FinancialPage: pagamento registrado ao confirmar check-in
- BillingProductionPage: guia TISS iniciada automaticamente
- MedicalRecordsPage: liberado para o médico somente após check-in

---

### 3. CADASTRO DE PACIENTES

**Validar:**
- Todos os campos do cadastro completo (pessoais, contato, convênio, responsáveis)
- CPF único com validação de formato e duplicidade
- CNS com validação de dígito verificador
- Consentimento LGPD com data e versão do termo
- Mesclagem de cadastros duplicados com histórico preservado
- Histórico de atendimentos, internações e financeiro vinculados
- Alertas clínicos visíveis: alergias, risco de queda, doenças crônicas, isolamento, anticoagulante

**Testar:**
- Tentativa de cadastro com CPF já existente (deve alertar e sugerir mesclagem)
- Busca por nome, CPF, CNS, telefone
- Edição de dados com registro de auditoria
- Flag de anonimização LGPD

**Validar tecnicamente:**
- RLS no Supabase: paciente da Empresa A não visível para Empresa B
- Filtro por company_id e unit_id em todas as queries

---

### 4. PRONTUÁRIO ELETRÔNICO

**Validar:**
- Abertura vinculada ao check-in (não pode abrir sem paciente em atendimento)
- Anamnese estruturada: queixa, HDA, antecedentes, medicamentos, alergias
- Busca e registro de CID-10/CID-11
- Prescrição eletrônica com alerta de interação medicamentosa
- Solicitação de exames LIS e PACS vinculada ao atendimento
- Assinatura digital do médico (ICP-Brasil A1/A3)
- Histórico longitudinal de atendimentos anteriores
- Acesso restrito: somente médico responsável ou perfil autorizado

**Testar:**
- Médico acessando prontuário do próprio paciente: permitido
- Médico acessando prontuário de paciente de outro profissional: exigir justificativa
- IA: sugestões exibidas mas NUNCA salvas sem validação explícita do médico
- Salvamento real no Supabase (não apenas estado React)
- Log de auditoria: quem abriu, quando, de qual IP

**Validar integrações:**
- LIS: pedido de exame aparece na worklist laboratorial
- PACS: pedido de imagem aparece na worklist DICOM
- BillingProductionPage: procedimentos do atendimento geram itens na guia

---

### 5. PACS/DICOM

**Validar:**
- Pedido de exame de imagem originado no prontuário
- Worklist DICOM com filtro por modalidade e data
- Recebimento de imagens via protocolo DICOM (C-STORE)
- Visualizador DICOM embutido funcional
- Laudo estruturado com editor de texto
- Assinatura digital do radiologista (ICP-Brasil)
- Comparação com exames anteriores do mesmo paciente

**Fluxo de status:**
```
solicitado → agendado → realizado → imagem recebida → laudando → laudo liberado
```

**Testar:**
- Conectividade com Orthanc (nó DICOM configurado)
- Cadastro e teste de nós DICOM (DicomNodesPage)
- Cadastro de modalidades (DicomModalitiesPage)
- Laudo liberado aparece automaticamente no prontuário

**Validar tecnicamente:**
- Persistência de imagens no storage (Supabase Storage ou Orthanc)
- Performance do viewer com imagens grandes (CT/MR)
- RLS: imagens de Empresa A não acessíveis por Empresa B

---

### 6. FINANCEIRO

**Validar:**
- Contas a receber com baixa manual e automática
- Contas a pagar com vencimento e status
- Abertura, lançamentos e fechamento de caixa diário
- Formas de pagamento: dinheiro, cartão débito/crédito, PIX, convênio, boleto
- Cálculo e registro de repasse médico por profissional
- DRE com receitas, despesas e resultado por período
- Controle de inadimplência com aging list
- Integração com NFS-e e NF-e

**Testar:**
- Baixa automática (simulada ou real via webhook)
- Conciliação bancária por importação de extrato OFX/CSV
- Integração com BillingProductionPage: conta a receber criada ao enviar lote TISS

---

### 7. FATURAMENTO

**Validar:**
- Geração de guia TISS (SP/SADT, Honorários, Internação)
- Exportação de XML TISS versão 3.05.00+
- Agrupamento de guias em lotes por convênio e competência
- Pré-auditoria: campos obrigatórios, TUSS válido, CID obrigatório
- Gestão de glosas: listagem, motivo, valor, status
- Recurso de glosa com documentação clínica vinculada

**Testar:**
- Tentativa de faturar procedimento sem CID (deve bloquear)
- Procedimento com TUSS inválido para o convênio (deve alertar)
- Lote gerado em XML válido (validar schema TISS)
- Importação de retorno de pagamento e baixa automática no Financeiro

---

### 8. RBAC E MULTIEMPRESA

**Validar:**
- Isolamento total de dados por company_id (Empresa A nunca vê dados de Empresa B)
- Filtro por unit_id para usuários com acesso restrito a unidades
- Menus e rotas visíveis apenas para perfis autorizados
- APIs retornam apenas dados da empresa do usuário autenticado
- Policies RLS no Supabase efetivas e testadas

**Testar por perfil:**

| Perfil | Deve acessar | Não deve acessar |
|--------|-------------|-----------------|
| reception | Agenda, Recepção, Pacientes | Financeiro, Admin, Prontuário completo |
| doctor | Prontuário, Agenda própria | Financeiro, Admin, outros prontuários sem justificativa |
| financial | Financeiro, Faturamento | Prontuário, Admin de usuários |
| admin | Tudo | — |
| billing | Faturamento, Convênios | Prontuário, Admin |
| radiology | PACS, Worklist | Financeiro, Admin |

**Verificar vulnerabilidades:**
- Bypass de frontend: acessar URL diretamente sem permissão
- Bypass de API: chamada direta ao Supabase sem RLS bloqueando
- Vazamento de dados entre empresas em queries sem filtro company_id

---

### 9. LGPD E AUDITORIA

**Validar:**
- Log imutável (apenas INSERT, nunca UPDATE/DELETE na tabela de auditoria)
- Campos do log: user_id, company_id, module, action, record_id, old_value, new_value, ip_address, user_agent, timestamp
- Consentimento LGPD: data, versão do termo, canal de coleta
- Exportação de dados do titular (Art. 18 LGPD) em JSON ou PDF
- Flag de anonimização substituindo dados pessoais por hash
- Justificativa registrada em log ao acessar prontuário restrito

**Testar:**
- Tentativa de deletar registro de auditoria (deve ser bloqueado por RLS/policy)
- Trilha completa de um atendimento: quem agendou, quem fez check-in, quem abriu prontuário, quem prescreveu, quem faturou
- Exportação do histórico de acessos de um paciente específico

---

### 10. DASHBOARD / BI

**Validar:**
- Métricas calculadas de dados reais (não hardcoded/mockadas)
- Filtros funcionais: unidade, período, convênio, profissional, especialidade
- Drill-down: clicar num indicador abre a lista detalhada
- Atualização automática (polling ou Supabase Realtime)

**Verificar:**
- Queries reais no Supabase (não arrays mockados)
- Indicadores financeiros batem com FinancialPage
- Indicadores de agenda batem com SchedulePage
- Indicadores de faturamento batem com BillingProductionPage

---

## TESTES TÉCNICOS OBRIGATÓRIOS

### Frontend
- [ ] TypeScript build sem erros (`bun run build`)
- [ ] ESLint sem erros críticos (`bun run lint`)
- [ ] Todas as rotas acessíveis e renderizando
- [ ] Lazy loading implementado para páginas pesadas
- [ ] Suspense boundaries para carregamento
- [ ] Sem memory leaks em componentes com subscriptions
- [ ] Sem stale state em formulários após navegação
- [ ] TanStack Query: invalidação correta após mutações

### Backend
- [ ] Todas as chamadas ao Supabase autenticadas
- [ ] JWT validado em toda requisição
- [ ] Policies RLS ativas em todas as tabelas críticas
- [ ] Services retornam erros tratados (não crash silencioso)
- [ ] Sem chaves de API expostas no frontend

### Database
- [ ] RLS ativo em: patients, appointments, medical_records, financial, billing, audit_logs
- [ ] Foreign keys com ON DELETE adequado
- [ ] Índices em: company_id, patient_id, created_at, status
- [ ] Constraint UNIQUE em: patients.cpf por company_id
- [ ] Tabela de auditoria sem policy de DELETE/UPDATE

### Performance
- [ ] Carregamento inicial < 3s em conexão 4G
- [ ] Tabelas com paginação server-side (não carregar tudo na memória)
- [ ] Queries com LIMIT explícito
- [ ] Sem N+1 queries em listagens
- [ ] Sem re-render excessivo em listas grandes

---

## TESTES E2E OBRIGATÓRIOS

Criar os seguintes cenários em Playwright (já configurado no projeto):

### Cenário 1 — Fluxo Ambulatorial Completo
```
1. Login como recepcionista
2. Criar agendamento para paciente novo
3. Confirmar chegada do paciente
4. Fazer check-in
5. Login como médico
6. Abrir prontuário do atendimento
7. Preencher anamnese e CID
8. Assinar digitalmente
9. Login como faturamento
10. Verificar que procedimento aparece na guia
11. Gerar XML TISS
```

### Cenário 2 — Fluxo PACS
```
1. Médico solicita exame de imagem no prontuário
2. Exame aparece na worklist DICOM
3. Status muda para "realizado"
4. Imagem recebida no viewer
5. Radiologista laudou e assinou
6. Laudo aparece automaticamente no prontuário do médico
```

### Cenário 3 — Fluxo Financeiro
```
1. Recepção registra pagamento particular
2. Lançamento aparece no caixa diário
3. Repasse calculado para o médico
4. DRE atualizado com a receita
```

### Cenário 4 — Isolamento Multiempresa
```
1. Criar paciente na Empresa A
2. Login com usuário da Empresa B
3. Buscar o paciente: NÃO deve aparecer
4. Chamar a API diretamente sem company_id: RLS deve bloquear
```

### Cenário 5 — Segurança RBAC
```
1. Login como recepcionista
2. Tentar acessar /medical-records diretamente pela URL
3. Deve redirecionar para AccessDeniedPage
4. Tentar chamada direta ao Supabase para tabela medical_records
5. RLS deve retornar vazio ou erro 403
```

---

## RELATÓRIO FINAL OBRIGATÓRIO

Ao terminar toda a auditoria, gerar o arquivo `REAL_IMPLEMENTATION_AUDIT.md` na raiz do repositório com a seguinte estrutura:

```markdown
# REAL_IMPLEMENTATION_AUDIT.md
Data da auditoria: [data]
Auditor: Lovable AI QA

## 1. Visão Geral
- Maturidade real estimada: X%
- Módulos auditados: N
- Módulos aprovados: N
- Módulos reprovados: N
- Módulos parciais: N

## 2. Funcionalidades REALMENTE implementadas
[lista com evidência de código]

## 3. Funcionalidades parcialmente implementadas
[lista com o que falta]

## 4. Funcionalidades fake/placeholders detectadas
[lista com arquivo e linha]

## 5. Problemas críticos
[CRÍTICO] descrição — arquivo — linha

## 6. Vulnerabilidades de segurança
[CRÍTICO/ALTO] descrição

## 7. Problemas de UX
[ALTO/MÉDIO] descrição

## 8. Problemas de arquitetura
[ALTO/MÉDIO] descrição

## 9. Problemas de performance
[MÉDIO/BAIXO] descrição

## 10. Problemas de RBAC/RLS
[CRÍTICO/ALTO] descrição

## 11. Problemas de integração entre módulos
[ALTO/MÉDIO] descrição

## 12. Problemas de persistência
[CRÍTICO/ALTO] descrição

## 13. Fluxos quebrados
[CRÍTICO] fluxo — onde quebra

## 14. Componentes órfãos
[BAIXO] arquivo — motivo

## 15. APIs/services não utilizados
[BAIXO] arquivo — motivo

## 16. Queries problemáticas
[MÉDIO] query — problema — arquivo

## 17. Recomendações priorizadas

### CRÍTICO (resolver antes de qualquer deploy)
1. ...

### ALTO (resolver na próxima sprint)
1. ...

### MÉDIO (backlog prioritário)
1. ...

### BAIXO (backlog geral)
1. ...

## Resumo Final
- Arquivos analisados: N
- Testes E2E criados: N
- Módulos aprovados para produção: [lista]
- Módulos reprovados para produção: [lista]
- Readiness para produção: SIM / NÃO / PARCIAL
- Condições para go-live: [lista de bloqueadores]
```

---

## REGRAS FINAIS

**NUNCA:**
- Inventar funcionamento de algo que não foi verificado no código
- Assumir que uma integração existe sem ver o código que a chama
- Considerar mockData como implementação real
- Considerar um toast de sucesso como confirmação de persistência
- Ignorar ausência de RLS como detalhe menor
- Ignorar requisitos de LGPD como opcionais

**SEMPRE:**
- Validar no código-fonte real antes de marcar como implementado
- Verificar se há chamada real ao Supabase (não apenas estado React local)
- Verificar se há policy RLS antes de marcar como seguro
- Verificar se há registro de auditoria antes de marcar como rastreável
- Verificar se a integração entre módulos é código real, não apenas comentário

**Ao finalizar:**
- Listar todos os arquivos analisados
- Listar todos os testes E2E criados
- Listar módulos aprovados para produção
- Listar módulos reprovados para produção
- Informar readiness real e condições de go-live
