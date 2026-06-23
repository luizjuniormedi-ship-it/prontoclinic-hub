# PRONTOMEDIC — MÓDULOS, FUNCIONALIDADES E INTEGRAÇÕES

> **Nota:** Este sistema é desenvolvido sob o nome de código `prontoclinic-hub` no repositório. O nome comercial do produto é **ProntoMedic**. Padronize todos os arquivos, README e variáveis de ambiente com um único nome.

---

## 1. Módulo de Agendamento

O módulo de Agendamento controla consultas, exames, procedimentos, retornos, encaixes e agendas por profissional, sala, unidade e convênio.

### Funcionalidades

- Cadastro de agendas por médico, especialidade, sala, equipamento e unidade.
- Agendamento de consultas, exames e procedimentos.
- Escolha do tipo de atendimento: particular, convênio, cortesia, retorno, pacote ou campanha.
- Pré-cadastro do paciente no momento do agendamento.
- Coleta de dados básicos: nome; CPF; telefone com DDD; data de nascimento; convênio; número da carteirinha; validade da carteirinha; plano; procedimento desejado.
- Alerta automático de paciente já cadastrado.
- Validação de duplicidade por CPF, telefone, CNS e nome/data de nascimento.
- Bloqueio de agenda por férias, feriados, manutenção ou ausência do profissional.
- Lista de espera.
- Encaixe com justificativa.
- Remarcação com histórico.
- Cancelamento com motivo.
- Confirmação automática por WhatsApp.
- Envio de lembrete pré-consulta.
- Controle de no-show.
- Painel diário de agenda.

**Status do agendamento (fluxo sequencial):**

agendado → confirmado → aguardando chegada → em triagem → em atendimento → atendido
(paralelos: faltou / cancelado / remarcado)

> Correção aplicada: O status "em triagem" foi adicionado entre "aguardando chegada" e "em atendimento". O status "remarcado" é aplicado ao registro original; o novo horário gera um novo registro com status "agendado".

### Integrações

- Recepção: transforma agendamento em atendimento real.
- Cadastro de Pacientes: evita duplicidade.
- Convênios: valida cobertura e elegibilidade.
- Faturamento: gera previsão de cobrança.
- WhatsApp: confirmações, lembretes e reagendamentos.
- Atendimento Médico: abre prontuário no horário correto.
- PACS/LIS: agenda exames de imagem e laboratório.
- Financeiro: previsão de receita por agenda.

---

## 2. Módulo de Recepção

A Recepção é o ponto de entrada administrativo do paciente. A gestão de filas neste módulo refere-se ao fluxo administrativo; a classificação clínica de risco pertence ao Módulo de Pronto Atendimento.

### Funcionalidades

- Check-in do paciente.
- Finalização do cadastro iniciado no agendamento.
- Atualização cadastral obrigatória.
- Validação de documentos.
- Captura de foto do paciente.
- Confirmação de convênio.
- Leitura ou digitação de carteirinha.
- Registro de acompanhante.
- Geração de ficha de atendimento.
- Impressão de etiquetas.
- Impressão de termo de consentimento.
- Assinatura digital.
- Pagamento particular.
- Recebimento de coparticipação.
- Emissão de recibo.
- Encaminhamento para triagem, consulta, exame ou procedimento.
- Gestão de filas administrativas (ordem de chegada, emissão de senha, painel de chamadas).
- Priorização administrativa por: idoso, gestante, PCD ou condição declarada.
- Alertas de pendências: documentos faltantes; convênio vencido; autorização pendente; débito anterior; cadastro incompleto.

### Integrações

- Agendamento: recebe pacientes agendados.
- Prontuário: libera atendimento clínico.
- Financeiro: registra pagamentos.
- Faturamento: inicia guia TISS.
- Convênios: consulta elegibilidade.
- Assinatura Digital: coleta termos.
- WhatsApp: envia comprovantes e senhas.
- Painel de Chamadas: direciona paciente.

---

## 3. Módulo de Cadastro de Pacientes

Centraliza todas as informações demográficas, clínicas, administrativas e financeiras do paciente.

### Funcionalidades

- Cadastro completo do paciente.
- Dados pessoais: nome completo; nome social; CPF; RG; CNS; data de nascimento; sexo; gênero; estado civil; profissão; nacionalidade.
- Dados de contato: telefone; WhatsApp; e-mail; endereço completo.
- Dados de convênio: operadora; plano; carteirinha; validade; acomodação; coparticipação.
- Responsável financeiro.
- Responsável legal.
- Acompanhantes autorizados.
- Histórico de atendimentos.
- Histórico de internações.
- Histórico financeiro.
- Alertas clínicos: alergias; risco de queda; doenças crônicas; isolamento; uso de anticoagulante.
- Mesclagem de cadastros duplicados.
- LGPD: consentimento; termo de uso; histórico de acesso; anonimização quando aplicável.

### Integrações

- Todos os módulos clínicos e administrativos.
- Agendamento: identifica paciente.
- Recepção: valida dados.
- Prontuário: fornece base clínica.
- Faturamento: vincula guias e cobranças.
- Financeiro: controla débitos.
- WhatsApp: comunicação ativa.
- Auditoria: rastreia alterações.

---

## 4. Módulo de Atendimento Médico / Prontuário Eletrônico

É o núcleo clínico do sistema.

### Funcionalidades

- Abertura de atendimento médico.
- Anamnese estruturada.
- Queixa principal.
- História da doença atual.
- Antecedentes pessoais.
- Antecedentes familiares.
- Medicamentos em uso.
- Alergias.
- Exame físico.
- Hipóteses diagnósticas.
- CID-10 / CID-11.
- Conduta médica.
- Prescrição eletrônica.
- Solicitação de exames.
- Solicitação de procedimentos.
- Emissão de atestado.
- Emissão de relatório médico.
- Evolução médica.
- Encaminhamento.
- Retorno programado.
- Protocolos clínicos.
- Alertas de interação medicamentosa.
- Assinatura digital do médico (certificado ICP-Brasil, conforme Resolução CFM n. 2.299/2021).
- Histórico longitudinal do paciente.
- Templates por especialidade.
- Ditado por voz.
- Resumo automático por IA (via integração com Módulo 21).
- Integração com IA Clínica para sugestão de hipóteses diagnósticas, com validação obrigatória do médico antes de qualquer registro.

### Integrações

- Recepção: libera atendimento.
- Enfermagem: recebe sinais vitais e triagem.
- Farmácia: recebe prescrição.
- LIS: envia pedido laboratorial.
- PACS/DICOM: envia pedido de imagem.
- Faturamento: gera procedimentos cobrados.
- Centro Cirúrgico: gera indicação cirúrgica.
- Internação: gera solicitação de internação.
- Auditoria Clínica: revisa condutas.
- IA Clínica (Módulo 21): apoio à decisão diagnóstica.

---

## 5. Módulo de Enfermagem

Controla atividades assistenciais de enfermagem em ambulatório, pronto atendimento e internação.

### Funcionalidades

- Triagem.
- Classificação de risco.
- Sinais vitais: pressão arterial; frequência cardíaca; frequência respiratória; temperatura; saturação; glicemia; dor.
- Escalas assistenciais: Braden; Morse; Glasgow; EVA; risco de queda.
- Evolução de enfermagem.
- SAE (Sistematização da Assistência de Enfermagem).
- Prescrição de enfermagem.
- Checagem de medicação.
- Administração de medicamentos.
- Curativos.
- Controle de acesso venoso.
- Balanço hídrico.
- Controle de dietas.
- Passagem de plantão.
- Checklist de segurança.
- Alertas de eventos adversos.
- Notificação de intercorrências.

### Integrações

- Prontuário: registra evolução assistencial.
- Médico: envia alertas clínicos.
- Farmácia: recebe medicações dispensadas.
- Internação: acompanha pacientes internados.
- Pronto Atendimento: registra triagem.
- Centro Cirúrgico: checklist pré e pós-operatório.
- BI: indicadores assistenciais.
- Auditoria: rastreabilidade de checagem.

---

## 6. Módulo de Farmácia e Materiais

Controla medicamentos, materiais, dispensação, estoque e rastreabilidade.

### Funcionalidades

- Cadastro de medicamentos.
- Cadastro de materiais.
- Controle por lote.
- Controle de validade.
- Curva ABC.
- Estoque mínimo e máximo.
- Entrada por nota fiscal.
- Saída por dispensação.
- Transferência entre setores (estoque interno entre unidades ou centros de custo).
- Devolução por paciente (medicamento não administrado retorna ao estoque com rastreabilidade).
- Perda, quebra e vencimento.
- Rastreabilidade por paciente.
- Dispensação por prescrição.
- Substituição autorizada.
- Controle de medicamentos controlados.
- Inventário.
- Separação por centro de custo.
- Alertas: estoque baixo; vencimento próximo; lote bloqueado; divergência de dispensação.

### Integrações

- Prescrição Médica: recebe itens prescritos.
- Enfermagem: confirma administração.
- Financeiro: contabiliza custo.
- Faturamento: cobra materiais e medicamentos.
- Centro Cirúrgico: kits cirúrgicos.
- Internação: consumo por leito.
- Compras: reposição automática.
- Auditoria: rastreia desvios.

---

## 7. Módulo de Pronto Atendimento

Gerencia atendimentos urgentes e emergenciais.

### Funcionalidades

- Entrada espontânea.
- Cadastro rápido.
- Triagem de risco (Protocolo de Manchester ou equivalente).
- Classificação por prioridade clínica.
- Painel de fila assistencial.
- Sala de medicação.
- Observação.
- Evolução médica.
- Evolução de enfermagem.
- Prescrição de urgência.
- Solicitação de exames.
- Procedimentos emergenciais.
- Reavaliação.
- Alta.
- Internação.
- Transferência.
- Óbito.
- Tempo de espera.
- Indicadores de SLA assistencial.
- Alertas de pacientes críticos.

### Integrações

- Recepção: entrada administrativa.
- Enfermagem: triagem.
- Médico: atendimento.
- LIS/PACS: exames urgentes.
- Farmácia: medicação de urgência.
- Internação: conversão em internação.
- Faturamento: cobrança por atendimento.
- BI: tempo porta-médico, tempo de permanência.

---

## 8. Módulo de Internação

Gerencia todo o ciclo da internação hospitalar.

### Funcionalidades

- Solicitação de internação.
- Autorização do convênio.
- Reserva de leito.
- Admissão hospitalar.
- Mapa de leitos.

Status do leito: livre; reservado (alocado para paciente em pré-admissão, ainda não chegou); ocupado; higienização; bloqueado; manutenção; isolamento.

> Correção aplicada: Status "reservado" adicionado para evitar double-booking entre autorização e chegada do paciente.

- Transferência interna.
- Mudança de acomodação.
- Evolução médica diária.
- Evolução de enfermagem.
- Prescrição hospitalar.
- Dietas.
- Controle de acompanhantes.
- Balanço hídrico.
- Controle de dispositivos.
- Intercorrências.
- Alta médica.
- Alta administrativa.
- Resumo de alta.
- Conta hospitalar.
- Fechamento da internação.

### Integrações

- Recepção: admissão.
- Convênios: autorização.
- Prontuário: evolução clínica.
- Enfermagem: cuidados diários.
- Farmácia: dispensação por leito.
- Faturamento: conta hospitalar.
- Hotelaria: higienização e ocupação.
- Centro Cirúrgico: pacientes cirúrgicos.
- BI: taxa de ocupação, média de permanência.

---

## 9. Módulo de Centro Cirúrgico

Controla agenda, sala, equipe, materiais, anestesia e recuperação.

### Funcionalidades

- Solicitação cirúrgica.
- Agendamento cirúrgico.
- Reserva de sala.
- Reserva de equipe.
- Reserva de materiais.
- Gestão de OPME (Órtese, Prótese e Material Especial): solicitação, autorização pelo convênio, rastreabilidade por número de série e lote, vinculação à conta cirúrgica.
- Checklist pré-operatório.
- Consentimento cirúrgico.
- Registro anestésico.
- Tempos cirúrgicos: entrada em sala; início anestesia; início cirurgia; fim cirurgia; saída de sala.
- Registro de procedimento.
- Registro de materiais utilizados.
- Registro de intercorrências.
- Recuperação pós-anestésica (RPA).
- Alta da RPA.
- Cancelamento cirúrgico com motivo.
- Indicadores: taxa de ocupação de sala; atraso; cancelamento; tempo médio cirúrgico.

### Integrações

- Agendamento: agenda procedimentos.
- Internação: pacientes internados.
- Prontuário: indicação e evolução.
- Farmácia: materiais e medicamentos.
- Faturamento: cobrança cirúrgica.
- Enfermagem: checklist e RPA.
- Convênios: autorização cirúrgica e de OPME.
- Compras: OPME e materiais especiais.

---

## 10. Módulo LIS — Laboratório

Gerencia exames laboratoriais.

### Funcionalidades

- Cadastro de exames.
- Coleta.
- Etiquetas.
- Amostras.
- Tubos.
- Setores laboratoriais.
- Mapa de bancada.
- Interfaceamento com equipamentos.
- Recebimento automático de resultados.
- Validação técnica.
- Validação biomédica.
- Liberação de laudo.
- Resultado crítico.
- Recoleta.
- Histórico de exames.
- Entrega digital.
- Assinatura digital.
- Integração com portal do paciente.

### Integrações

- Atendimento Médico: recebe pedidos.
- Recepção: registra coleta.
- Convênios: autorização de exames que exigem pré-aprovação.
- Faturamento: cobra exames.
- Equipamentos laboratoriais: interfaceamento bidirecional.
- WhatsApp: entrega de resultado.
- Prontuário: incorpora resultado.
- BI: produtividade e tempo de liberação.

---

## 11. Módulo PACS/DICOM/RIS

Gerencia exames de imagem.

### Funcionalidades

- Pedido de exame de imagem.
- Agendamento de exame.
- Worklist DICOM.
- Integração com equipamentos (modalidades: CR, DR, CT, MR, US e outras).
- Recebimento de imagens.
- Visualizador DICOM.
- Laudo radiológico.
- Assinatura digital.
- Comparação com exames anteriores.
- Entrega online.
- Status: solicitado; agendado; realizado; imagem recebida; laudando; laudo liberado.

### Integrações

- Atendimento Médico: solicitação.
- Recepção: autorização e check-in.
- Faturamento: cobrança.
- Orthanc/PACS: armazenamento de imagens.
- RIS: fluxo radiológico.
- WhatsApp/Portal: entrega de laudo.
- Prontuário: anexa laudo e imagem.

---

## 12. Módulo de Convênios e Procedimentos

Controla operadoras, planos, contratos, tabelas e regras de cobertura.

### Funcionalidades

- Cadastro de convênios.
- Cadastro de planos.
- Cadastro de contratos.
- Tabelas TUSS.
- Tabelas próprias.
- Regras de elegibilidade.
- Regras de autorização.
- Coparticipação.
- Controle de carência com bloqueio automático no agendamento, alerta na recepção e liberação manual mediante justificativa clínica registrada.
- Pacotes.
- Procedimentos cobertos.
- Procedimentos bloqueados.
- Regras por unidade.
- Regras por profissional.
- Regras por especialidade.
- Limites de sessões.
- Validação automática no agendamento.
- Validação automática na recepção.
- Histórico de reajustes.

### Integrações

- Agendamento: valida se pode marcar.
- Recepção: valida atendimento.
- Faturamento: gera guias.
- Financeiro: calcula repasse.
- Auditoria: evita glosas.
- Internação: autorizações hospitalares.
- Centro Cirúrgico: autorizações cirúrgicas e de OPME.

---

## 13. Módulo de Faturamento e Glosas

Responsável pela geração, conferência, envio e acompanhamento das cobranças.

### Funcionalidades

- Geração de guias TISS.
- Conta ambulatorial.
- Conta hospitalar.
- Conta cirúrgica.
- Lotes de faturamento.
- XML TISS (versão 3.05.00 ou superior, conforme padrão ANS vigente).
- Conferência automática.
- Pré-auditoria.
- Regras de glosa.
- Envio para convênio.
- Controle de protocolo.
- Retorno de pagamento.
- Baixa parcial.
- Recurso de glosa.
- Histórico de glosas.
- Indicadores: valor faturado; valor recebido; valor glosado; percentual de glosa; prazo médio de recebimento.

### Integrações

- Recepção: dados administrativos.
- Prontuário: comprovação clínica.
- Farmácia: materiais e medicamentos.
- Centro Cirúrgico: taxas e OPME.
- Internação: conta hospitalar.
- Convênios: regras de cobrança.
- Financeiro: contas a receber.
- IA Clínica (Módulo 21): previsão e prevenção de glosas.

---

## 14. Módulo Financeiro

Controla contas a pagar, receber, caixa, repasses e resultado financeiro.

### Funcionalidades

- Contas a receber.
- Contas a pagar.
- Caixa diário.
- Formas de pagamento.
- Conciliação bancária.
- Repasse médico.
- Honorários.
- Centros de custo.
- DRE (Demonstração do Resultado do Exercício).
- Fluxo de caixa.
- Controle de inadimplência.
- Recebimentos particulares.
- Recebimentos de convênio.
- Baixa automática.
- Relatórios financeiros.
- Previsão de receita.
- Controle de despesas.
- Integração com NFS-e (nota fiscal de serviços médicos) e NF-e (materiais e medicamentos), conforme legislação municipal e federal vigente.

### Integrações

- Recepção: pagamentos imediatos.
- Faturamento: contas a receber.
- Convênios: valores contratados.
- Médicos: repasses.
- Compras: contas a pagar.
- Farmácia/Estoque: custos.
- BI: indicadores financeiros.

---

## 15. Módulo Administrativo

Gerencia estrutura, usuários, unidades e configurações do sistema.

### Funcionalidades

- Cadastro de empresas.
- Cadastro de unidades.
- Cadastro de setores.
- Cadastro de salas.
- Cadastro de profissionais.
- Cadastro de especialidades.
- Usuários.
- Perfis de acesso (RBAC).
- Permissões por módulo.
- Configurações gerais.
- Parâmetros financeiros.
- Parâmetros assistenciais.
- Campos customizáveis.
- Logs administrativos.
- Auditoria de ações.
- Configuração de integrações.
- Controle de licença.

### Integrações

- Todos os módulos.
- Define permissões, estrutura e regras globais.

---

## 16. Módulo de Segurança, LGPD e Auditoria

Responsável por proteção de dados, rastreabilidade e conformidade.

### Funcionalidades

- Login seguro.
- Autenticação por perfil (RBAC).
- Controle de sessão.
- Logs de acesso.
- Logs de alteração.
- Logs de exclusão.
- Rastreio por IP/dispositivo.
- Consentimento LGPD.
- Termos assinados.
- Controle de acesso ao prontuário.
- Justificativa para acesso sensível.
- Anonimização de dados.
- Exportação de dados do titular (Art. 18, LGPD).
- Bloqueio de usuário.
- Auditoria de permissões.
- Alertas de acesso suspeito.
- Relatório de conformidade.

### Integrações

- Todos os módulos.
- Prontuário: acesso sensível.
- Administrativo: permissões.
- BI: relatórios de segurança.
- Assinatura Digital: validade jurídica.

---

## 17. Módulo de Telemedicina

Permite atendimento remoto integrado ao prontuário.

### Funcionalidades

- Agenda de teleconsulta.
- Sala virtual.
- Link seguro.
- Consentimento digital.
- Chat.
- Upload de documentos.
- Compartilhamento de exames.
- Gravação, quando autorizada pelo paciente.
- Prescrição digital.
- Atestado digital.
- Pagamento online.
- Registro automático no prontuário.
- Encerramento com resumo.

### Integrações

- Agendamento: agenda remota.
- Prontuário: atendimento clínico.
- Financeiro: pagamento.
- Assinatura Digital: documentos.
- WhatsApp: envio de link.
- LIS/PACS: visualização de exames.

---

## 18. Módulo de WhatsApp e Comunicação

Centraliza comunicação com pacientes.

### Funcionalidades

- Confirmação de consulta.
- Lembrete automático.
- Envio de preparo de exame.
- Envio de senha.
- Envio de resultado.
- Pesquisa de satisfação.
- Reagendamento.
- Segunda via de boleto.
- Confirmação de cirurgia.
- Mensagens por campanha.
- Chat humano.
- Chatbot.
- Templates aprovados (Meta Business API).
- Histórico de conversas.

### Integrações

- Agendamento: confirmações.
- Recepção: senhas e check-in.
- LIS/PACS: resultados.
- Financeiro: cobrança.
- Feedback: pesquisa de satisfação.
- Telemedicina: link de consulta.

---

## 19. Módulo de Feedback do Paciente e Qualidade

Mede satisfação e qualidade assistencial.

### Funcionalidades

- Pesquisa pós-atendimento.
- NPS (Net Promoter Score).
- Avaliação por setor.
- Avaliação por profissional.
- Reclamações.
- Elogios.
- Ocorrências.
- Plano de ação.
- SLA de resposta.
- Indicadores de qualidade.
- Relatório para gestão.
- Alertas de baixa satisfação.

### Integrações

- WhatsApp: coleta de resposta.
- BI: indicadores.
- Administrativo: gestão de equipe.
- Auditoria: análise de eventos.
- Atendimento: correlação com jornada do paciente.

---

## 20. Módulo de BI e Indicadores

Painel executivo e operacional.

### Funcionalidades

- Dashboard geral.
- Indicadores assistenciais.
- Indicadores financeiros.
- Indicadores operacionais.
- Indicadores de agenda.
- Indicadores de internação.
- Indicadores de centro cirúrgico.
- Indicadores de faturamento.
- Indicadores de glosa.
- Indicadores de qualidade.
- Filtros por: unidade; período; convênio; profissional; setor; especialidade.
- Exportação PDF/Excel.
- Alertas gerenciais.

### Integrações

- Todos os módulos.
- Consolida dados clínicos, administrativos e financeiros.

---

## 21. Módulo de IA Clínica e Operacional

Camada inteligente transversal do ProntoMedic. Todas as sugestões requerem validação humana antes de qualquer ação ou registro.

### Funcionalidades

- Resumo automático do prontuário.
- Sugestão de hipóteses diagnósticas (com validação obrigatória do médico).
- Alertas de risco clínico.
- Detecção de inconsistências clínicas.
- Análise de risco de glosa.
- Auditoria automática de faturamento.
- Sugestão de protocolos clínicos.
- Classificação de prioridade.
- Predição de no-show.
- Predição de ocupação de leitos.
- Detecção de padrões atípicos de faturamento: guias duplicadas, procedimentos incompatíveis por paciente/dia, quantidades acima dos limites do convênio.
- Sugestão de faturamento correto.
- Apoio ao gestor com insights executivos.

### Integrações

- Prontuário: análise clínica.
- Faturamento: prevenção de glosas.
- Agenda: previsão de faltas.
- Internação: risco assistencial.
- BI: insights executivos.
- Auditoria: revisão automática.

---

## 22. Módulo de Remoção e Transporte

Controla transporte interno e externo de pacientes.

### Funcionalidades

- Solicitação de transporte.
- Transporte interno.
- Transporte externo.
- Ambulância.
- Maca.
- Cadeira de rodas.
- Equipe responsável.
- Prioridade.
- Origem e destino.
- Horário solicitado.
- Horário realizado.
- Status: solicitado; aceito; em deslocamento; concluído; cancelado.
- Registro de intercorrência durante o transporte.
- Controle de frota.
- Controle de motorista.
- Controle de ambulância.

### Integrações

- Internação: transporte entre setores.
- Centro Cirúrgico: transporte para sala.
- Pronto Atendimento: remoção de urgência.
- Recepção: chegada externa.
- Convênios: autorização de remoção coberta pelo plano.
- Faturamento: cobrança de remoção.
- BI: tempo médio de transporte.

---

## 23. Módulo de Compras e Suprimentos

Gerencia aquisição de materiais, medicamentos e insumos.

### Funcionalidades

- Solicitação de compra.
- Cotação.
- Pedido de compra.
- Aprovação.
- Recebimento.
- Conferência.
- Entrada em estoque.
- Fornecedores.
- Histórico de preço.
- Curva ABC.
- Reposição automática.
- Controle de contratos.
- Alertas de ruptura.

### Integrações

- Farmácia/Estoque: reposição.
- Financeiro: contas a pagar.
- Centro Cirúrgico: OPME e kits.
- Administrativo: aprovação.
- BI: custos e consumo.

---

## 24. Módulo de Assinatura Digital

Valida documentos clínicos e administrativos com validade jurídica plena.

### Funcionalidades

- Assinatura de prescrições.
- Assinatura de laudos.
- Assinatura de termos.
- Assinatura de consentimentos.
- Assinatura de relatórios.
- Certificado digital ICP-Brasil (A1/A3), conforme Resolução CFM n. 2.299/2021.
- Carimbo de tempo (timestamp de autoridade certificadora).
- Validação jurídica.
- Histórico de assinatura.
- Bloqueio contra alteração após assinatura.

### Integrações

- Prontuário: documentos médicos.
- LIS/PACS: laudos.
- Recepção: termos.
- Telemedicina: documentos digitais.
- LGPD: consentimentos.

---

## Resumo da Arquitetura Integrada

### Fluxo Ambulatorial

Agendamento → Recepção → Atendimento Médico → Exames/Prescrição → Farmácia / LIS / PACS → Faturamento → Financeiro → BI / Auditoria

### Fluxo Hospitalar

Recepção / PA → Internação → [Médico + Enfermagem + Farmácia + LIS/PACS] → Centro Cirúrgico (se aplicável) → Alta Médica → Alta Administrativa → Conta Hospitalar → Faturamento → Financeiro → BI / Auditoria

### Princípios da Arquitetura

Cada módulo deve gerar rastreabilidade, faturamento correto, dados para BI, conformidade com LGPD, prevenção de glosas, histórico clínico completo, comunicação automática com o paciente e auditoria operacional e assistencial.

---

## Status de Implementação (v1.1.0)

| # | Módulo | Status | Migration | Service | UI |
|---|--------|--------|-----------|---------|-----|
| 1 | Agendamento | Parcial | - | - | ✅ |
| 2 | Recepção | Parcial | - | - | ✅ |
| 3 | Cadastro de Pacientes | ✅ | - | `patientsService` | ✅ |
| 4 | Atendimento / Prontuário | ✅ | - | `medicalRecordsService` | ✅ |
| 5 | Enfermagem / Triagem | ✅ | 16 | `nursingService` | ✅ |
| **6** | **Farmácia / Materiais** | **✅** | **15** | **`pharmacyService`** | **✅** |
| 7 | Pronto Atendimento | Pendente | - | - | - |
| 8 | Internação | Pendente | - | - | - |
| 9 | Centro Cirúrgico | Pendente | - | - | - |
| 10 | LIS / Laboratório | Pendente | - | - | - |
| 11 | PACS / DICOM / RIS | ✅ | 9 | `dicomService` | ✅ |
| 12 | Convênios | ✅ | 1-4 | `insuranceService` | ✅ |
| 13 | Faturamento TISS | ✅ | 10 | `tissService` | ✅ |
| 14 | Financeiro | ✅ | - | `financialService` | ✅ |
| 15 | Administrativo | ✅ | - | `api.ts` | ✅ |
| 16 | LGPD / Auditoria | ✅ | 6, 7, 12 | `lgpdService`, `auditService` | ✅ |
| 17 | Telemedicina | ✅ | 17 | `telemedicinaService` | ✅ |
| 18 | WhatsApp / Comunicação | ✅ | 8 | `notificationService` | ✅ |
| 19 | Feedback / NPS | Pendente | - | - | - |
| 20 | BI / Indicadores | Pendente | - | - | - |
| 21 | IA Clínica | Pendente | - | - | - |
| 22 | Remoção / Transporte | Pendente | - | - | - |
| 23 | Compras | Pendente | - | - | - |
| 24 | Assinatura Digital | Pendente | - | - | - |

