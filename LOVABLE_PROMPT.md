# LOVABLE SYNC PROMPT — PRONTOMEDIC

> Use este arquivo como prompt base no Lovable para sincronizar a implementação com a documentação oficial definida em `MODULES.md`.
> Cole o bloco de prompt desejado diretamente no chat do Lovable.

---

## CONTEXTO DO PROJETO

Este projeto é o **ProntoMedic** — sistema de gestão para clínicas e hospitais, desenvolvido em React + TypeScript + Supabase, com 24 módulos integrados. A documentação completa e corrigida está em `MODULES.md` na raiz do repositório.

**Stack atual:**
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Supabase (auth + banco de dados)
- React Router DOM
- TanStack Query
- RBAC implementado (roles: admin, reception, doctor, nursing, financial)

**Páginas já existentes:** SchedulePage, PatientsPage, ReceptionPage, MedicalRecordsPage, FinancialPage, BillingProductionPage, AttendancePage, DicomDashboardPage, PACSPage, RadiologyReportsPage, ProfessionalsPage, MasterDataPage, WorklistPage, CompaniesPage, CallCenterPage, AdminUsersPage, AdminProfilesPage, AdminPermissionsPage, DashboardPage

**Serviços já existentes:** appointmentsService, patientsService, medicalRecordsService, financialService, dicomService, dicomIntegrationService, priceTableService, validationService, statusTransitions, api

---

## PROMPTS POR MÓDULO

> Copie e cole o prompt do módulo que deseja implementar ou corrigir.

---

### PROMPT 1 — Módulo de Agendamento (SchedulePage)

```
Revise e complete o módulo de Agendamento (SchedulePage.tsx e appointmentsService.ts) com base nas seguintes regras:

FLUXO DE STATUS OBRIGATÓRIO (implementar nesta ordem exata):
agendado → confirmado → aguardando chegada → em triagem → em atendimento → atendido
Paralelos permitidos: faltou / cancelado / remarcado

REGRAS:
- O status "remarcado" marca o registro original como remarcado e cria um NOVO agendamento com status "agendado"
- Transições inválidas devem ser bloqueadas (ex: não pode ir de "atendido" para "em atendimento")
- Usar o arquivo statusTransitions.ts já existente como base

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Cadastro de agenda por médico, especialidade, sala, equipamento e unidade
- Tipos de atendimento: particular, convênio, cortesia, retorno, pacote, campanha
- Pré-cadastro de paciente com: nome, CPF, telefone com DDD, data de nascimento, convênio, número da carteirinha, validade da carteirinha, plano, procedimento desejado
- Alerta automático quando paciente já está cadastrado (validar por CPF, telefone, CNS e nome+data de nascimento)
- Bloqueio de agenda com motivo: férias, feriado, manutenção, ausência
- Lista de espera
- Encaixe com justificativa obrigatória
- Remarcação com histórico
- Cancelamento com motivo obrigatório
- Controle de no-show
- Painel diário de agenda com filtros por profissional, sala, unidade e data

INTEGRAÇÕES (preparar hooks/eventos):
- Ao confirmar chegada do paciente → notificar ReceptionPage
- Ao criar agendamento com convênio → validar elegibilidade no módulo de Convênios
- Ao concluir atendimento → disparar evento para Faturamento
- Ao abrir atendimento → abrir prontuário (MedicalRecordsPage) no horário correto
```

---

### PROMPT 2 — Módulo de Recepção (ReceptionPage)

```
Revise e complete o módulo de Recepção (ReceptionPage.tsx) com base nas seguintes regras:

SEPARAÇÃO DE RESPONSABILIDADES:
- A Recepção gerencia a fila ADMINISTRATIVA (chegada, check-in, encaminhamento por senha)
- A classificação clínica de risco pertence ao módulo de Pronto Atendimento
- Não misturar triagem clínica com gestão de fila de chegada

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Check-in do paciente (integrado com SchedulePage — receber pacientes agendados)
- Finalização e atualização do cadastro iniciado no agendamento
- Validação de documentos com indicador visual de pendências
- Captura de foto do paciente
- Confirmação e leitura de carteirinha de convênio
- Registro de acompanhante com nome e grau de parentesco
- Geração de ficha de atendimento
- Impressão de etiquetas e termos de consentimento
- Suporte a assinatura digital de termos
- Pagamento particular + recebimento de coparticipação + emissão de recibo
- Encaminhamento para: triagem, consulta, exame ou procedimento
- Gestão de fila administrativa: emissão de senha, painel de chamadas, ordem de chegada
- Priorização administrativa: idoso (60+), gestante, PCD ou condição declarada
- Painel de alertas de pendências por paciente: documentos faltantes, convênio vencido, autorização pendente, débito anterior, cadastro incompleto

INTEGRAÇÕES:
- Receber lista de agendados do dia de SchedulePage
- Ao registrar pagamento → enviar para FinancialPage
- Ao iniciar atendimento → liberar MedicalRecordsPage para o médico
- Ao registrar chegada → iniciar guia TISS em BillingProductionPage
- Consultar elegibilidade de convênio antes de confirmar atendimento
```

---

### PROMPT 3 — Módulo de Cadastro de Pacientes (PatientsPage)

```
Revise e complete o módulo de Cadastro de Pacientes (PatientsPage.tsx, PatientCreatePage.tsx, PatientEditPage.tsx, PatientDetailPage.tsx e patientsService.ts) com base nas seguintes regras:

CAMPOS OBRIGATÓRIOS DO CADASTRO:
Dados pessoais: nome completo, nome social, CPF (único), RG, CNS, data de nascimento, sexo, gênero, estado civil, profissão, nacionalidade
Dados de contato: telefone, WhatsApp, e-mail, endereço completo (CEP + logradouro + número + complemento + bairro + cidade + UF)
Dados de convênio: operadora, plano, número da carteirinha, validade, tipo de acomodação, coparticipação (sim/não + valor)
Outros: responsável financeiro, responsável legal, acompanhantes autorizados

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Validação de duplicidade por: CPF, CNS, telefone, nome+data de nascimento
- Alerta visual quando duplicata for detectada com opção de mesclar cadastros
- Mesclagem de cadastros duplicados com histórico preservado
- Histórico de atendimentos, internações e financeiro vinculados ao paciente
- Alertas clínicos permanentes no header do cadastro: alergias, risco de queda, doenças crônicas, isolamento, uso de anticoagulante
- Conformidade LGPD: campo de consentimento com data, termo de uso, histórico de acesso ao prontuário, flag de anonimização

INTEGRAÇÕES:
- Usado por todos os módulos como fonte de dados do paciente
- SchedulePage: identificar e pré-preencher dados no agendamento
- ReceptionPage: validar dados na chegada
- MedicalRecordsPage: fornecer base clínica
- BillingProductionPage: vincular guias e cobranças
- FinancialPage: controlar débitos do paciente
```

---

### PROMPT 4 — Módulo de Prontuário Eletrônico (MedicalRecordsPage)

```
Revise e complete o módulo de Prontuário Eletrônico (MedicalRecordsPage.tsx e medicalRecordsService.ts) com base nas seguintes regras:

ESTRUTURA DO ATENDIMENTO:
1. Abertura vinculada ao agendamento ou à chegada registrada na Recepção
2. Anamnese estruturada: queixa principal, história da doença atual, antecedentes pessoais, antecedentes familiares, medicamentos em uso, alergias
3. Exame físico com campos configuráveis por especialidade
4. Hipóteses diagnósticas com busca por CID-10 e CID-11
5. Conduta médica
6. Prescrição eletrônica com alerta de interação medicamentosa
7. Solicitação de exames (LIS e PACS)
8. Emissão de: atestado, relatório médico, encaminhamento, retorno programado
9. Assinatura digital do médico (ICP-Brasil A1/A3, conforme Resolução CFM n. 2.299/2021)
10. Fechamento do atendimento com resumo

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Histórico longitudinal do paciente (todos os atendimentos anteriores)
- Templates por especialidade (cardiologia, ortopedia, pediatria, etc.)
- Suporte a ditado por voz (Web Speech API ou integração externa)
- Resumo automático por IA: exibir como sugestão, NUNCA salvar sem validação explícita do médico
- Sugestão de hipóteses diagnósticas por IA: exibir como sugestão, médico deve selecionar/rejeitar antes de salvar
- Protocolos clínicos configuráveis por especialidade
- Controle de acesso: apenas o médico responsável e perfis autorizados acessam o prontuário
- Justificativa obrigatória para acesso a prontuário de paciente não vinculado ao profissional

INTEGRAÇÕES:
- ReceptionPage: libera abertura do atendimento somente após check-in
- EnfermaryPage (futuro): receber sinais vitais e classificação de triagem
- Farmácia (futuro): enviar prescrição para dispensação
- LIS/PACS: enviar pedidos de exame e receber resultados no prontuário
- BillingProductionPage: registrar procedimentos para faturamento
- Centro Cirúrgico (futuro): gerar indicação cirúrgica
- Internação (futuro): gerar solicitação de internação
```

---

### PROMPT 5 — Módulo PACS/DICOM (DicomDashboardPage + PACSPage)

```
Revise e complete o módulo PACS/DICOM (DicomDashboardPage.tsx, PACSPage.tsx, DicomWorklistPage.tsx, DicomModalitiesPage.tsx, DicomNodesPage.tsx, RadiologyReportsPage.tsx, ImagingOrdersPage.tsx, dicomService.ts, dicomIntegrationService.ts) com base nas seguintes regras:

FLUXO DE STATUS OBRIGATÓRIO (implementar nesta ordem):
solicitado → agendado → realizado → imagem recebida → laudando → laudo liberado

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Pedido de exame de imagem originado do MedicalRecordsPage
- Worklist DICOM: listar exames pendentes por modalidade (CR, DR, CT, MR, US, MG, NM, etc.)
- Integração com equipamentos via DICOM Worklist (C-FIND/C-STORE)
- Recebimento automático de imagens dos equipamentos via nó DICOM configurado em DicomNodesPage
- Visualizador DICOM embutido (usar cornerstone.js, ohif-viewer ou similar)
- Laudo radiológico estruturado com editor rich text
- Assinatura digital do radiologista (ICP-Brasil A1/A3, Resolução CFM n. 2.299/2021)
- Comparação de exames anteriores do mesmo paciente
- Entrega online: link seguro para o paciente acessar laudo e imagens
- Gestão de modalidades em DicomModalitiesPage: tipo, AE Title, porta, IP
- Gestão de nós DICOM em DicomNodesPage: PACS remoto, equipamentos, roteamento

INTEGRAÇÕES:
- MedicalRecordsPage: receber solicitação e devolver resultado incorporado ao prontuário
- ReceptionPage: autorização e check-in para exames agendados
- BillingProductionPage: cobrança por exame realizado
- Orthanc (backend PACS): armazenamento e recuperação de imagens DICOM
- WhatsApp (futuro): entrega de laudo por mensagem
- Convênios: autorização de exames de alto custo antes de realizar
```

---

### PROMPT 6 — Módulo Financeiro (FinancialPage)

```
Revise e complete o módulo Financeiro (FinancialPage.tsx e financialService.ts) com base nas seguintes regras:

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Contas a receber: lançamentos manuais e automáticos vindos de BillingProductionPage
- Contas a pagar: vinculadas a ComprasPage (futuro) e fornecedores
- Caixa diário: abertura, lançamentos, fechamento e conferência
- Formas de pagamento: dinheiro, cartão débito/crédito, PIX, convênio, boleto, cheque
- Conciliação bancária: importação de extrato OFX/CSV e matching automático
- Repasse médico e honorários: cálculo por procedimento, percentual ou valor fixo, por profissional
- Centros de custo: segregar receitas e despesas por unidade, setor ou especialidade
- DRE (Demonstração do Resultado do Exercício): mensal e acumulado
- Fluxo de caixa: projetado vs realizado
- Controle de inadimplência: aging list, alertas de vencimento, régua de cobrança
- Baixa automática: integração com gateway de pagamento/PIX para confirmar recebimento
- Emissão de NFS-e (nota fiscal de serviços médicos) e NF-e (materiais/medicamentos) — integração com prefeitura e SEFAZ
- Previsão de receita por agenda (integrado com SchedulePage)

INTEGRAÇÕES:
- ReceptionPage: registrar pagamentos imediatos
- BillingProductionPage: gerar contas a receber de convênios
- Profissionais: calcular e registrar repasses
- BI/Dashboard: alimentar indicadores financeiros
```

---

### PROMPT 7 — Módulo de Faturamento (BillingProductionPage)

```
Revise e complete o módulo de Faturamento (BillingProductionPage.tsx) com base nas seguintes regras:

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Geração de guias TISS: consulta (SP/SADT), internação (AIH/APAC), honorários
- Suporte ao padrão XML TISS versão 3.05.00 ou superior (conforme ANS)
- Conta ambulatorial, hospitalar e cirúrgica
- Agrupamento de guias em lotes de faturamento por convênio e competência
- Conferência automática antes do envio: verificar campos obrigatórios, TUSS válido, CID obrigatório quando necessário
- Pré-auditoria com regras configuráveis: duplicidade de procedimento, quantidade máxima, compatibilidade CID x procedimento
- Envio do XML ao convênio (download do lote para envio manual ou integração direta)
- Controle de protocolo de envio: número, data, valor total
- Importação do retorno de pagamento (TISS retorno): baixar automaticamente no FinancialPage
- Gestão de glosas: listar glosas recebidas, motivo, valor, status (aceita/recorrida/paga)
- Recurso de glosa: gerar carta de recurso com documentação clínica vinculada do prontuário
- Indicadores: valor faturado, valor recebido, valor glosado, % de glosa, prazo médio de recebimento

INTEGRAÇÕES:
- MedicalRecordsPage: buscar procedimentos realizados e CID para compor a guia
- ReceptionPage: pegar dados administrativos (convênio, carteirinha, autorização)
- Farmácia (futuro): incluir materiais e medicamentos na conta
- Centro Cirúrgico (futuro): incluir taxas e OPME
- Internação (futuro): compor conta hospitalar
- FinancialPage: gerar contas a receber após envio
- IA Clínica (futuro): sugerir correções antes do envio para reduzir glosa
```

---

### PROMPT 8 — Módulo Administrativo + RBAC (AdminPages + SettingsPage)

```
Revise e complete o módulo Administrativo (AdminUsersPage.tsx, AdminProfilesPage.tsx, AdminPermissionsPage.tsx, CompaniesPage.tsx, SettingsPage.tsx) com base nas seguintes regras:

ESTRUTURA DE MULTI-TENANT:
- Empresa (Company): entidade raiz do sistema, com CNPJ, razão social e nome fantasia
- Unidade: vinculada à empresa, com endereço, CNES e tipo (clínica/hospital/laboratório)
- Setor: vinculado à unidade (recepção, enfermagem, farmácia, CC, UTI, etc.)
- Sala/Consultório: vinculado ao setor, com tipo e capacidade

RBAC — PERFIS E PERMISSÕES:
Perfis base atuais: admin, reception, doctor, nursing, financial
Adicionar: billing (faturamento), pharmacy (farmácia), radiology (radiologia), manager (gestor/BI)

Cada perfil deve ter permissões granulares por módulo:
- visualizar, criar, editar, excluir, aprovar, exportar

FUNCIONALIDADES A VALIDAR/COMPLETAR:
- Cadastro de empresas (CompaniesPage): multi-empresa com isolamento de dados por company_id
- Cadastro de usuários: vincular usuário a empresa, unidade e perfil
- Cadastro de profissionais: CRM/CRO/COREN, especialidade, conselho, UF, RQE
- Cadastro de especialidades: nome, tipo (médica/odonto/enfermagem), procedimentos padrão
- Perfis de acesso: criar, editar e clonar perfis
- Permissões por módulo: matriz de permissões por perfil
- Campos customizáveis: adicionar campos extras em formulários de paciente, prontuário e agendamento
- Logs administrativos: registrar todas as ações com usuário, data, hora, IP e dado alterado
- Configuração de integrações: WhatsApp API, PACS (Orthanc), LIS, gateway de pagamento, NFS-e
- Controle de licença: exibir módulos ativos, data de validade, usuários permitidos vs em uso

INTEGRAÇÕES:
- Todos os módulos: herdam company_id, unit_id e permissões do usuário logado
- Auditoria: todos os logs administrativos alimentam o módulo de Segurança/LGPD
```

---

### PROMPT 9 — Módulo de BI e Dashboard (DashboardPage)

```
Revise e complete o módulo de BI e Indicadores (DashboardPage.tsx) com base nas seguintes regras:

INDICADORES OBRIGATÓRIOS POR CATEGORIA:

Agenda:
- Total de agendamentos por período / unidade / profissional
- Taxa de no-show (%)
- Taxa de confirmação (%)
- Taxa de cancelamento (%)
- Ocupação da agenda (agendados / slots disponíveis)

Financeiro:
- Receita total (particular + convênio) por período
- Ticket médio por atendimento
- Inadimplência (valor e %)
- Repasse médico por profissional
- DRE resumido (receita - despesa = resultado)

Faturamento:
- Valor faturado vs recebido vs glosado por convênio
- % de glosa por convênio e por tipo de procedimento
- Prazo médio de recebimento (PMR) por convênio
- Lotes enviados vs pendentes de retorno

PACS/LIS:
- Volume de exames por modalidade/setor
- Tempo médio de liberação de laudo
- Exames pendentes de laudo

Qualidade:
- NPS médio por período, unidade e profissional
- % de reclamações respondidas dentro do SLA

FUNCIONALIDADES:
- Filtros combinados: unidade, período (dia/semana/mês/intervalo), convênio, profissional, setor, especialidade
- Todos os cards com drill-down (clicar no número abre a lista detalhada)
- Exportação de qualquer relatório em PDF e Excel
- Alertas gerenciais automáticos (ex: glosa acima de 5%, ocupação abaixo de 60%, NPS < 70)
- Modo escuro/claro respeitando preferência do usuário

INTEGRAÇÕES:
- Todos os módulos alimentam o DashboardPage via TanStack Query
- Os dados devem ser filtrados por company_id e unit_id do usuário logado (RBAC)
```

---

### PROMPT 10 — Módulo de Segurança e LGPD (transversal)

```
Implemente e revise as funcionalidades de Segurança, LGPD e Auditoria de forma transversal em todos os módulos do ProntoMedic:

AUTENTICAÇÃO E SESSÃO:
- Login seguro via Supabase Auth (já implementado)
- Expiração de sessão configurável por perfil (ex: médico: 8h, recepção: 12h, admin: 4h)
- Logout automático por inatividade
- Bloqueio de conta após N tentativas de login falhas (configurável)

CONTROLE DE ACESSO AO PRONTUÁRIO:
- Apenas o médico responsável pelo atendimento e perfis autorizados (admin, enfermagem com restrição) podem abrir o prontuário
- Acesso de outros profissionais requer justificativa obrigatória registrada em log
- O paciente pode solicitar relatório de quem acessou seu prontuário (Art. 18, LGPD)

LOGS DE AUDITORIA (implementar em TODOS os módulos):
Registrar em tabela de auditoria (Supabase):
- user_id, company_id, module_name, action (create/update/delete/view/export), record_id, old_value (JSON), new_value (JSON), ip_address, user_agent, created_at

LGPD:
- Campo de consentimento em PatientCreatePage com: data, versão do termo, canal (presencial/digital/WhatsApp)
- Exportação de todos os dados do titular em JSON/PDF (Art. 18 — direito de portabilidade)
- Flag de anonimização: quando ativada, substitui dados pessoais por hashes irreversíveis nos relatórios de BI
- Logs de consentimento imutáveis (apenas insert, nunca update/delete)

ALERTAS DE SEGURANÇA:
- Detectar acessos suspeitos: mesmo usuário acessando de IPs diferentes em curto período
- Detectar volume anômalo de exportações por usuário
- Enviar alerta por e-mail ao admin quando detectado

RELATÓRIO DE CONFORMIDADE:
- Página de relatório para o DPO: total de consentimentos, anonimizações, acessos sensíveis, solicitações de titulares
```

---

### PROMPT 11 — Módulo de Profissionais e Repasse (ProfessionalsPage + ProfessionalPaymentPage)

```
Revise e complete o módulo de Profissionais (ProfessionalsPage.tsx e ProfessionalPaymentPage.tsx) com base nas seguintes regras:

CADASTRO DE PROFISSIONAL:
- Nome completo e nome social
- CPF e data de nascimento
- Conselho profissional: CRM, CRO, COREN, CRF, CRP, CRT, etc.
- Número do conselho + UF de registro
- RQE (Registro de Qualificação de Especialista) por especialidade
- Especialidades (pode ter múltiplas)
- Unidades de atuação (pode atuar em múltiplas unidades)
- Tipo de vínculo: CLT, PJ, sócio, cooperado, plantonista
- Agenda própria: dias e horários de atendimento por unidade e sala
- Assinatura digital: certificado ICP-Brasil vinculado ao profissional

REPASSE MÉDICO (ProfessionalPaymentPage):
- Configurar modelo de repasse por profissional:
  - Percentual sobre o valor recebido (ex: 60%)
  - Valor fixo por procedimento (tabela própria)
  - Valor fixo por produção (RVU ou pontos)
- Geração de extrato de produção por período: procedimentos realizados, valor bruto, deduções (impostos, taxas), valor líquido
- Aprovação do extrato pelo profissional (assinatura digital)
- Geração de RPA ou nota fiscal pelo profissional (PJ)
- Lançamento automático em FinancialPage (contas a pagar)
- Histórico de repasses com status: calculado, aprovado, pago

INTEGRAÇÕES:
- SchedulePage: agenda por profissional
- MedicalRecordsPage: assinatura digital vinculada ao CRM
- BillingProductionPage: procedimentos realizados para cálculo de repasse
- FinancialPage: lançar repasse como conta a pagar
```

---

### PROMPT 12 — Módulo de Tabelas de Preço e Convênios (MasterDataPage + priceTableService)

```
Revise e complete o módulo de Dados Mestres (MasterDataPage.tsx e priceTableService.ts) com base nas seguintes regras:

TABELAS DE PROCEDIMENTOS:
- Tabela TUSS: importar e manter atualizada a tabela padrão ANS (código TUSS, descrição, tipo)
- Tabela CBHPM: código, descrição, porte, anestesia
- Tabela própria: preços particulares por procedimento e unidade
- Tabela por convênio: código TUSS mapeado para código do convênio, valor negociado, vigência
- Histórico de reajustes com data de vigência

CADASTRO DE CONVÊNIOS:
- Operadora: nome, registro ANS, CNPJ, telefone, e-mail de autorização, portal de acesso
- Planos: nome, tipo (ambulatorial/hospitalar/odonto/referência), acomodação (enfermaria/apartamento)
- Contratos: número, vigência, data de reajuste, regras específicas

REGRAS DE COBERTURA E ELEGIBILIDADE:
- Procedimentos cobertos e bloqueados por plano
- Regras de autorização: quais procedimentos precisam de guia de autorização prévia
- Coparticipação: valor fixo ou percentual por procedimento
- Controle de carência: data de início + período em dias + exceções por urgência
  - Bloquear agendamento durante carência (exibir motivo)
  - Alerta na recepção com opção de liberação manual com justificativa
- Limites de sessões: máximo por período (ex: 12 sessões de fisioterapia/ano)
- Regras específicas por: unidade, profissional, especialidade

VALIDAÇÕES AUTOMÁTICAS:
- No agendamento: validar elegibilidade + carência + cobertura do procedimento
- Na recepção: revalidar no momento do atendimento
- Pré-faturamento: conferir se o procedimento realizado é compatível com o plano

INTEGRAÇÕES:
- SchedulePage: bloquear/alertar no momento do agendamento
- ReceptionPage: validar na chegada
- BillingProductionPage: usar valores negociados para compor guias
- FinancialPage: calcular receita esperada por convênio
```

---

### PROMPT 13 — Módulo de Worklist e Call Center (WorklistPage + CallCenterPage)

```
Revise e complete os módulos de Worklist e Call Center (WorklistPage.tsx e CallCenterPage.tsx) com base nas seguintes regras:

WORKLIST (WorklistPage):
- Visão unificada de todos os pacientes em fluxo no dia, por status:
  agendado / confirmado / aguardando chegada / em triagem / em atendimento / atendido / faltou / cancelado
- Filtros: unidade, data, profissional, especialidade, tipo de atendimento
- Ações rápidas direto da worklist: confirmar chegada, iniciar atendimento, registrar no-show
- Atualização em tempo real (Supabase Realtime ou polling com TanStack Query)
- Indicadores do dia no topo: total agendados, presentes, em atendimento, concluídos, no-shows

CALL CENTER (CallCenterPage):
- Visualização da agenda de todos os profissionais e unidades (visão multi-agenda)
- Busca de paciente para agendamento: por nome, CPF, telefone
- Agendamento rápido por telefone: selecionar profissional > especialidade > data > horário disponível
- Confirmação de consulta: ligar/marcar como confirmado em lote
- Reagendamento com histórico de motivo
- Cancelamento com motivo
- Visualização de horários disponíveis em múltiplos profissionais simultaneamente (para oferecer opções)
- Registro de ligação: data, hora, operador, resultado (confirmou/não atendeu/cancelou/reagendou)
- Integração com WhatsApp: enviar link de confirmação ou lembrete direto da interface

INTEGRAÇÕES:
- SchedulePage: compartilhar a mesma base de dados de agendamentos
- PatientsPage: buscar e pré-cadastrar paciente
- WhatsApp (futuro): disparar mensagens de confirmação/lembrete
```

---

### PROMPT GERAL — Sincronização Completa com MODULES.md

```
Analise o arquivo MODULES.md na raiz deste repositório e realize uma auditoria completa da implementação atual do ProntoMedic, verificando:

1. MÓDULOS EXISTENTES — Para cada módulo já implementado, identificar:
   - Funcionalidades descritas no MODULES.md que ainda NÃO foram implementadas
   - Integrações entre módulos descritas no MODULES.md que estão faltando
   - Comportamentos incorretos ou incompletos em relação à especificação

2. MÓDULOS AUSENTES — Criar a estrutura base (página + serviço + tipos) para os módulos ainda não existentes:
   - Módulo de Enfermagem (EnfermaryPage)
   - Módulo de Farmácia e Materiais (PharmacyPage)
   - Módulo de Pronto Atendimento (EmergencyPage)
   - Módulo de Internação (HospitalizationPage)
   - Módulo de Centro Cirúrgico (SurgicalCenterPage)
   - Módulo LIS — Laboratório (LaboratoryPage)
   - Módulo de Telemedicina (TelemedicinePage)
   - Módulo de WhatsApp e Comunicação (CommunicationPage)
   - Módulo de Feedback do Paciente (FeedbackPage)
   - Módulo de IA Clínica (já integrado nos outros módulos — criar aiService.ts)
   - Módulo de Remoção e Transporte (TransportPage)
   - Módulo de Compras e Suprimentos (PurchasingPage)

3. PADRÕES A SEGUIR em todos os módulos criados:
   - Usar shadcn/ui como biblioteca de componentes
   - Usar TanStack Query para fetch/cache de dados
   - Respeitar RBAC: verificar permissões do usuário antes de renderizar ações
   - Filtrar todos os dados por company_id e unit_id do usuário logado
   - Registrar todas as ações de criação/edição/exclusão na tabela de auditoria do Supabase
   - Seguir o padrão de tipos definidos em src/types/index.ts

4. NAVEGAÇÃO — Atualizar AppSidebar.tsx para incluir todos os módulos com:
   - Ícone adequado (Lucide React)
   - Agrupamento por categoria: Clínico, Administrativo, Financeiro, Configuração
   - Controle de visibilidade por perfil RBAC

5. ROTAS — Atualizar App.tsx com as rotas dos novos módulos, todos protegidos por ProtectedRoute com verificação de role.

Ao finalizar, apresente um relatório de:
- O que foi criado
- O que foi corrigido
- O que ficou pendente e por quê
```

---

## INSTRUÇÕES DE USO

1. Abra o projeto no [Lovable](https://lovable.dev)
2. Conecte ao repositório `luizjuniormedi-ship-it/prontoclinic-hub`
3. No chat do Lovable, cole o prompt do módulo que deseja trabalhar
4. Após cada geração, revise o diff antes de aceitar
5. Para implementação completa, comece pelo **Prompt Geral** e depois refine módulo a módulo

## PRIORIDADE DE IMPLEMENTAÇÃO SUGERIDA

```
Fase 1 (Core): Agendamento → Recepção → Cadastro de Pacientes → Prontuário
Fase 2 (Clínico): Enfermagem → Farmácia → LIS → PACS (já iniciado)
Fase 3 (Hospitalar): Pronto Atendimento → Internação → Centro Cirúrgico
Fase 4 (Gestão): Faturamento → Financeiro → Convênios → BI
Fase 5 (Avançado): Telemedicina → WhatsApp → IA Clínica → Feedback → Auditoria
```
