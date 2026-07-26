# Responsabilidade dos módulos

## Operação e atendimento

- **Agenda**: horários, disponibilidade, bloqueios, espera, encaixes e
  pendências pré-atendimento. A grade do profissional deve ter uma única origem
  acessível também por Profissionais.
- **Call Center**: registra contato e converte demanda em agendamento.
- **Recepção**: identifica o paciente, define pagador, valida convênio,
  elegibilidade e autorização, prepara a guia, recebe valores do check-in, abre
  a conta inicial e envia o paciente à fila.
- **Pacientes**: cadastro administrativo e vínculos do paciente.

## Assistência clínica

- **Prontuário**: história longitudinal.
- **Atendimento clínico**: episódio atual.
- **Timeline**: visão cronológica do prontuário.
- **Enfermagem**: triagem, cuidados, tarefas e chamada.
- **Internação e Cirurgia**: jornadas hospitalares específicas.

Prescrição, solicitação de exame e documentos são ações do atendimento, não
itens principais da lateral.

## Diagnóstico

- **Execução de exames**: jornada assistencial do pedido até a conclusão.
- **Fila técnica DICOM**: integração MWL com modalidades.
- **PACS**: armazenamento e visualização de imagens.
- **Laudos**: produção, revisão, assinatura e liberação do documento.
- **Configuração DICOM**: nós, modalidades, equipamentos e monitoramento
  técnico, disponível apenas a perfis autorizados.

## Receita

- **Produção faturável** recebe procedimentos, exames, medicamentos e materiais.
- **Contas de faturamento** monta, critica e fecha a conta assistencial.
- **TISS** produz guias, lotes e XML.
- **Financeiro** controla títulos, caixa, Pix, cartão, recebíveis, conciliação e
  estorno.
- **Repasses** calcula valores devidos aos profissionais.

Recepção pode receber o valor do check-in, mas não fecha conta assistencial nem
gera lote TISS.

## Suprimentos, gestão e administração

- **Farmácia** valida e dispensa prescrições.
- **Compras** cuida de solicitação, aprovação, cotação e recebimento.
- **BI/NPS** consolida indicadores e experiência.
- **Acessos** reúne Usuários, Perfis e Permissões.
- **Organização** reúne Empresas, Unidades, Profissionais e Credenciamento.
- **Comercial** reúne Convênios, Planos, Contratos e Tabelas de preços.
- **Compliance** reúne LGPD, Auditoria e Notificações.
- **Tecnologia** reúne Configurações, DICOM técnico, integrações e templates.

## Lacunas funcionais conhecidas

1. Implementar grade profissional única e a aba Agenda e disponibilidade.
2. Implementar a jornada única e auditável de check-in da Recepção.
3. Decidir se Painel de chamada de enfermagem será uma página própria ou aba.
4. Integrar feed pessoal real ao sino de notificações.

Essas lacunas não autorizam criar agenda, prontuário, conta ou integração
paralela.
