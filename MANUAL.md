# Manual do Usuário - ProntoMedic

Bem-vindo ao ProntoMedic! Este manual cobre o uso do sistema para cada perfil de usuário.

## Sumário

- [Para Recepção](#para-recepção)
- [Para Médicos](#para-médicos)
- [Para Faturamento](#para-faturamento)
- [Para Administrador](#para-administrador)
- [Para Paciente](#para-paciente)
- [Atalhos de teclado](#atalhos-de-teclado)

---

## Para Recepção

![Tela de Login](/docs/screenshots/login.png)
*Tela de login com campos de email e senha*

### Login

1. Acesse https://app.prontomedic.com.br
2. Digite seu email e senha
3. Clique em "Entrar"
4. Se tiver 2FA, digite o código do app autenticador (Google Authenticator, Authy, etc.)

### Agenda do dia

![Agenda do dia](/docs/screenshots/agenda.png)
*Visão geral da agenda do dia com filtros laterais*

1. No menu lateral, clique em "Agenda"
2. Selecione a data no canto superior direito (calendário)
3. Veja a lista de agendamentos do dia, com cores por status:
   - **Azul**: Confirmado
   - **Verde**: Em espera
   - **Amarelo**: Em atendimento
   - **Cinza**: Atendido
   - **Vermelho**: Cancelado
4. Clique em um agendamento para ver detalhes
5. Use os filtros para refinar (profissional, especialidade, status, convênio)

### Criar agendamento

![Modal de novo agendamento](/docs/screenshots/agendamento-novo.png)
*Formulário de criação de agendamento*

![Busca de paciente por CPF](/docs/screenshots/busca-paciente.png)
*Autocomplete de paciente com validação de CPF*

1. Na agenda, clique no botão "Novo agendamento" (canto superior direito)
2. Selecione o **profissional**
3. Selecione a **data**
4. Escolha um **horário disponível** (em azul na grade)
5. Busque o **paciente** por CPF ou nome (autocomplete)
   - Se não encontrar, clique em "Cadastrar novo paciente"
6. Selecione o **convênio** (ou "Particular")
7. Selecione o **procedimento**
8. Adicione observações (opcional)
9. Clique em "Salvar"
10. O paciente recebe confirmação por e-mail/WhatsApp automaticamente

### Confirmar presença

![Check-in do paciente](/docs/screenshots/checkin.png)
*Tela de check-in com seleção de tipo de atendimento*

1. No momento do atendimento, clique no agendamento na agenda
2. Clique em "Check-in" no painel de detalhes
3. O status muda para "Em espera" e o paciente entra na fila
4. Quando o médico chamar, clique em "Em atendimento"
5. Após o atendimento, clique em "Atendido"

### Cancelar agendamento

1. Clique no agendamento na agenda
2. Clique em "Cancelar"
3. Selecione o **motivo** do cancelamento (lista suspensa)
4. Adicione observação (opcional)
5. Confirme
6. O paciente recebe notificação de cancelamento automaticamente

### Pré-cadastro de paciente

Você pode cadastrar pacientes de duas formas:

**Opção A: pela recepção**

1. Acesse "Pacientes" > "Novo"
2. Preencha o formulário completo
3. Marque "Consentimento LGPD" (termo de uso)
4. Clique em "Salvar"

**Opção B: pelo próprio paciente (recomendado)**

1. Envie ao paciente o link: https://app.prontomedic.com.br/pre-cadastro
2. O paciente preenche o formulário de casa
3. Recebe e-mail de confirmação
4. Após confirmar, o cadastro fica pendente
5. Você revisa na lista "Pré-cadastros pendentes"
6. Promova para "Cadastro definitivo" após validar documentos

### Fila de atendimento

1. Acesse "Atendimento" > "Fila"
2. Veja os pacientes em ordem de chegada
3. Filtre por profissional
4. Chame o próximo clicando em "Chamar"
5. O painel da sala de espera atualiza automaticamente

---

## Para Médicos

![Prontuário Eletrônico](/docs/screenshots/prontuario.png)
*Prontuário eletrônico estruturado com abas de anamnese, exame físico e CID-10*

### Abrir prontuário

1. Na agenda, clique no paciente em atendimento (status "Em atendimento")
2. O prontuário abre automaticamente
3. Preencha:
   - Anamnese
   - Exame físico
   - Hipótese diagnóstica
   - CID-10 (busque pelo código ou descrição)
   - Conduta
4. Clique em "Salvar" (salva rascunho) ou "Finalizar consulta"

### Prescrever

![Tela de prescrição](/docs/screenshots/prescricao.png)
*Editor de prescrição com autocomplete de medicamentos e assinatura ICP-Brasil*

1. No prontuário, clique na aba "Prescrição"
2. Busque o **medicamento** (autocomplete por nome genérico ou comercial)
3. Selecione:
   - **Dose** (ex: 500mg)
   - **Via** (oral, IV, IM, etc.)
   - **Frequência** (8/8h, 12/12h, etc.)
   - **Duração** do tratamento
4. Adicione observações (ex: "tomar após almoço")
5. Clique em "Adicionar à prescrição"
6. Repita para cada medicamento
7. Clique em "Assinar digitalmente"
8. Use seu certificado **ICP-Brasil** (token ou A3)
9. A prescrição fica disponível para o paciente no portal

### Solicitar exame

1. No prontuário, clique na aba "Exames"
2. Selecione o tipo:
   - **Laboratorial** (sangue, urina, etc.)
   - **Imagem** (raio-X, US, TC, RM)
   - **Outro**
3. Busque o exame por nome ou código TUSS
4. Adicione observações clínicas
5. Clique em "Enviar"
6. O exame aparece no portal do paciente e na lista de exames pendentes

### Emitir atestado

1. No prontuário, clique na aba "Atestado"
2. Selecione o **template** (comparência, afastamento, etc.)
3. Preencha os campos variáveis
4. Clique em "Gerar PDF"
5. Assine digitalmente (ICP-Brasil)
6. O PDF é enviado por e-mail ao paciente

### Templates de laudo

1. Acesse "Modelos" > "Templates de laudo"
2. Crie templates com variáveis `{{paciente.nome}}`, `{{exame.data}}`, etc.
3. Use em qualquer laudo com autocomplete

### Visualizador DICOM

![Visualizador DICOM](/docs/screenshots/dicom.png)
*Visualizador DICOM com controles de zoom, pan, window/level e medições*

1. Na aba "Exames" do prontuário, clique em "Visualizar DICOM"
2. O visualizador abre com:
   - Navegação entre séries
   - Zoom, pan, rotação
   - Medições (distância, ângulo)
   - Window/Level para contraste
3. Capture screenshots com "Anotar"

---

## Para Faturamento

![Tela de faturamento TISS](/docs/screenshots/faturamento.png)
*Painel de faturamento TISS 3.05 com status de lotes enviados*

### Gerar fatura mensal

1. Acesse "Faturamento" > "Faturas"
2. Selecione o **mês** e **ano**
3. Selecione o **convênio**
4. Clique em "Gerar faturas"
5. O sistema gera **XMLs TISS 3.05** para cada lote
6. Revise cada lote na lista
7. Clique em "Enviar" para submeter à operadora
8. Acompanhe o status (enviado, processado, pago, glosado)

### Processar retorno TISS

1. Acesse "Faturamento" > "Retornos TISS"
2. Clique em "Upload XML de retorno"
3. Selecione o arquivo XML da operadora
4. O sistema processa automaticamente:
   - Marca faturas como **pagas** ou **glosadas**
   - Extrai valores pagos e glosados
   - Categoriza glosas por código
5. Glosas aparecem em destaque na lista
6. Clique em cada glosa para ver detalhes e justificativa da operadora

### Enviar recurso de glosa

1. Na lista de glosas, clique em "Recurso"
2. O sistema gera o **XML de recurso** TISS
3. Revise e adicione **justificativa clínica**
4. Anexe documentos (opcional)
5. Clique em "Enviar"
6. Acompanhe o status: pendente, aceito, negado

### Comissionamento

1. Acesse "Faturamento" > "Comissionamento"
2. Selecione o **mês** e **profissional**
3. O sistema calcula automaticamente:
   - Valor bruto por procedimento
   - Percentual de comissão configurado
   - Deduções (impostos, adiantamentos)
4. Revise e clique em "Aprovar"
5. Sistema gera o **recibo** e a **fatura** do profissional

### Conciliação bancária

1. Acesse "Financeiro" > "Conciliação"
2. Faça upload do **extrato bancário** (OFX ou CSV)
3. Sistema faz matching automático com faturas
4. Revise matches sugeridos
5. Marque divergências para análise

### BPA / AIH (SUS)

1. Acesse "Faturamento" > "SUS"
2. Selecione "BPA" (boletim de produção ambulatorial) ou "AIH" (autorização de internação hospitalar)
3. Gere o arquivo mensal
4. Envie para o Ministério da Saúde

---

## Para Administrador

![Painel administrativo LGPD](/docs/screenshots/lgpd-admin.png)
*Painel LGPD com solicitações pendentes, política de retenção e auditoria de acesso*

### Cadastrar novo médico

1. Acesse "Profissionais" > "Novo"
2. Preencha:
   - Dados pessoais
   - CPF, RG, CRM
   - Email e telefone
3. Selecione a **especialidade** e o **CBO**
4. Configure a **escala** (dias e horários de atendimento)
5. Defina **credenciamentos** (quais convênios atende)
6. Configure a **comissão** (% por convênio)
7. Salve

### Configurar convênio

1. Acesse "Admin" > "Convênios" > "Novo"
2. Preencha:
   - Razão social, CNPJ
   - Registro ANS
   - Endereço, contato
3. Adicione **planos** do convênio
4. Defina **tabela de preços** (TUSS ou própria)
5. Configure **flags TISS** (versão, tipo de envio)
6. Configure **prazos** (vencimento, glosa)
7. Salve

### Tabela de preços

1. Acesse "Admin" > "Tabela de Preços"
2. Crie tabelas por:
   - Convênio + Plano
   - Vigência (data início/fim)
   - Procedimento + Valor
3. Configure **fallback** (qual tabela usar se não achar)
4. O sistema aplica automaticamente no faturamento

### LGPD

1. Acesse "Admin" > "LGPD"
2. Visualize solicitações pendentes
3. Processe solicitações:
   - **Acesso**: gerar relatório com dados do paciente
   - **Portabilidade**: exportar em JSON/CSV
   - **Esquecimento**: anonimizar dados pessoais
4. Configure **política de retenção** (ex: 20 anos para prontuários)
5. **Anonimize** pacientes inativos após o prazo

### Auditoria

1. Acesse "Admin" > "Auditoria"
2. Filtre por:
   - Tabela
   - Ação (INSERT, UPDATE, DELETE)
   - Usuário
   - Período
3. Visualize **diff antes/depois** de cada alteração
4. Exporte em JSON ou CSV
5. Logs são **imutáveis** (atendem CFM 1.821/2007)

### Multi-empresa / Multi-unidade

1. Acesse "Admin" > "Empresas"
2. Cadastre empresas (CNPJ, razão social)
3. Cadastre unidades por empresa
4. Configure usuários por unidade
5. Configure permissões por papel (admin, médico, recepção, etc.)

### BI / KPIs

1. Acesse "BI" no menu
2. Visualize dashboards:
   - **Ocupação** da agenda por profissional
   - **No-show** rate
   - **Glosa** por convênio
   - **Faturamento** por mês
3. Filtre por período, unidade, convênio
4. Exporte relatórios

---

## Para Paciente

![Portal do paciente PWA](/docs/screenshots/portal-paciente.png)
*Portal do paciente com pré-cadastro, agendamentos e download de dados LGPD*

### Pré-cadastro (PWA)

1. Acesse https://app.prontomedic.com.br/pre-cadastro pelo celular
2. Clique em "Adicionar à tela inicial" (Safari/Chrome) para instalar como app
3. Preencha o formulário
4. Confirme o e-mail

### Agendar consulta

1. Acesse "Portal do Paciente"
2. Clique em "Nova consulta"
3. Escolha **especialidade** e **profissional**
4. Escolha **data e horário**
5. Confirme
6. Receba confirmação por e-mail/WhatsApp

### Confirmar / Cancelar / Reagendar

1. No portal, clique em "Minhas consultas"
2. Para cada consulta:
   - **Confirmar**: clique em "Confirmar presença"
   - **Cancelar**: clique em "Cancelar" e informe o motivo
   - **Reagendar**: clique em "Reagendar" e escolha nova data

### Ver exames e laudos

1. No portal, clique em "Meus exames"
2. Veja lista de exames com status (solicitado, realizado, laudo pronto)
3. Clique em um exame para ver detalhes
4. Baixe o laudo em PDF

### Notificações

Você recebe notificações por:
- **E-mail** (cadastro, confirmações)
- **WhatsApp** (lembretes 24h antes)
- **SMS** (urgentes)

Configure no portal: "Notificações" > "Preferências"

### Download de dados (LGPD)

1. No portal, clique em "Meus dados"
2. Clique em "Solicitar download"
3. Confirme por e-mail
4. Em até 15 dias, você recebe o link de download (JSON + PDFs)

---

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+K` | Buscar |
| `Ctrl+N` | Novo agendamento |
| `Esc` | Fechar modal |
| `?` | Esta ajuda |
| `g d` | Dashboard |
| `g a` | Agenda |
| `g p` | Pacientes |
| `g f` | Faturamento |
| `g c` | Configurações |
| `/` | Focar na busca |
| `j` / `k` | Próximo / anterior (em listas) |
| `Enter` | Abrir item selecionado |

---

## Suporte

- **Email**: suporte@prontomedic.com.br
- **Telefone**: (XX) XXXX-XXXX
- **Portal de ajuda**: https://ajuda.prontomedic.com.br
- **Chat**: disponível no canto inferior direito
