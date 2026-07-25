# Mapa de navegação

Perfis: `ADM` administrador, `GES` gestor, `REC` recepção, `MED` médico, `ENF`
enfermagem, `LAB` laboratório, `DIA` diagnóstico, `FAR` farmácia, `FIN`
financeiro, `DPO` privacidade e `ADO` administrativo. `*` significa qualquer
usuário autenticado.

| Área | Tela | Rota | Perfis | Função e ponto de acesso | Tela relacionada | Ação principal | Tooltip | Status |
|---|---|---|---|---|---|---|---|---|
| Início | Dashboard | `/` | Todos os papéis conhecidos | Prioridades; lateral e launcher | Todos os módulos | Abrir prioridade | Veja prioridades, indicadores e atalhos do seu perfil | Estático aprovado |
| Operação | Agenda | `/schedule` | ADM/GES/REC/MED | Agendar e acompanhar; lateral e launcher | Profissionais, Recepção | Novo agendamento | Agende, confirme, remarque e acompanhe consultas, exames e procedimentos | Grade unificada pendente |
| Operação | Recepção | `/reception` | ADM/GES/REC | Check-in; lateral e launcher | Pacientes, Agenda, Faturamento | Iniciar check-in | Faça check-in, resolva pendências, valide convênio e encaminhe o paciente | Fluxo completo pendente |
| Operação | Pacientes | `/patients` | ADM/GES/REC/MED | Cadastro e pesquisa; lateral e launcher | Prontuário, Recepção | Novo paciente | Pesquise, cadastre e consulte os dados administrativos do paciente | Estático aprovado |
| Operação | Novo paciente | `/patients/new` | ADM/GES/REC/MED | Ação contextual em Pacientes | Pacientes | Salvar cadastro | Cadastra a identificação administrativa do paciente | Estático aprovado |
| Operação | Detalhe do paciente | `/patients/:id` | ADM/GES/REC/MED | Resultado da lista | Pacientes, Prontuário | Editar paciente | Exibe cadastro, convênio e vínculos do paciente | Estático aprovado |
| Operação | Editar paciente | `/patients/:id/edit` | ADM/GES/REC/MED | Ação no detalhe | Pacientes | Salvar alterações | Atualiza o cadastro administrativo do paciente | Estático aprovado |
| Operação | Meus agendamentos | `/meus-agendamentos` | * | Portal e launcher | Agenda | Consultar agendamento | Consulte próximos agendamentos e histórico de marcações | Estático aprovado |
| Operação | Call Center | `/callcenter` | ADM/REC | Lateral e launcher | Agenda, Pacientes | Registrar contato | Registre contatos e transforme solicitações em agendamentos | Estático aprovado |
| Operação | Pronto Atendimento | `/pa` | ADM/GES/REC/MED/ENF | Lateral e launcher | Triagem, Atendimento | Admitir paciente | Acompanhe a jornada do paciente no pronto atendimento | Estático aprovado |
| Operação | Telemedicina | `/telemedicina` | ADM/GES/MED | Lateral médica e launcher | Agenda, Atendimento | Iniciar sala | Acesse salas, atendimentos e documentos de consultas remotas | Contexto corrigido; E2E pendente |
| Assistência | Profissionais | `/professionals` | ADM/GES/ADO | Lateral administrativa e launcher | Agenda, Credenciamento | Novo profissional | Cadastre habilitações, unidades, convênios e disponibilidade | Grade unificada pendente |
| Assistência | Prontuário | `/records` | ADM/MED | Lateral médica e launcher | Timeline, Atendimento | Abrir prontuário | Consulte a história clínica longitudinal e documentos | Estático aprovado |
| Assistência | Atendimento clínico | `/encounters` | ADM/MED | Lateral e launcher | Prontuário, Agenda | Abrir atendimento | Abra e acompanhe atendimentos médicos em andamento | Estático aprovado |
| Assistência | Atendimento atual | `/attendance/:appointmentId` | ADM/MED | Ação contextual em Atendimento | Prontuário, Prescrição, Exames | Salvar atendimento | Registra o episódio clínico atual | Estático aprovado |
| Assistência | Timeline clínica | `/clinical-timeline` | ADM/MED | Launcher e prontuário | Prontuário | Consultar evento | Visualize eventos clínicos em ordem cronológica | Estático aprovado |
| Assistência | Triagem | `/nursing/triage` | ADM/MED/REC/ENF | Lateral e launcher | PA, Cuidados | Registrar triagem | Registre sinais vitais, queixa e classificação de risco | Estático aprovado |
| Assistência | Cuidados de enfermagem | `/nursing/care` | ADM/MED/REC/ENF | Lateral e launcher | Triagem, Internação | Registrar cuidado | Execute medicações, procedimentos, tarefas e evoluções | Estático aprovado |
| Assistência | Painel de chamada | `/nursing/queue` | ADM/MED/REC/ENF | Lateral e launcher | Triagem | Chamar paciente | Chame e acompanhe pacientes da fila de enfermagem | Página própria pendente |
| Assistência | Internação | `/internacao` | ADM/GES/MED/ENF | Lateral e launcher | Enfermagem, Faturamento | Admitir paciente | Gerencie admissões, leitos, transferências e altas | Estático aprovado |
| Assistência | Centro cirúrgico | `/cirurgia` | ADM/GES/MED/ENF | Launcher | Agenda, Internação | Agendar cirurgia | Planeje sala, equipe, checklist, materiais e execução | Estático aprovado |
| Assistência | Assinatura digital | `/assinatura` | ADM/MED | Launcher e ação contextual | Documentos, Laudos | Assinar documento | Assine e valide documentos com rastreabilidade | Estático aprovado |
| Assistência | IA clínica | `/ia-clinica` | ADM/GES/MED | Launcher | Atendimento, Auditoria | Gerar assistência | Use assistência clínica supervisionada e auditável | Estático aprovado |
| Diagnóstico | Laboratório | `/lab` | ADM/GES/MED/DIA/LAB | Lateral e launcher | Pedidos, Faturamento | Registrar coleta | Acompanhe coleta, amostras, resultados e liberação | Estático aprovado |
| Diagnóstico | Execução de exames | `/worklist` | ADM/DIA/LAB | Lateral e launcher | Pedidos, PACS | Iniciar exame | Gerencie o fluxo assistencial do exame até o PACS | Estático aprovado |
| Diagnóstico | Pedidos de imagem | `/dicom/orders` | ADM/DIA | Lateral e launcher | Execução | Abrir pedido | Consulte e organize solicitações de imagem | Estático aprovado |
| Diagnóstico | Fila técnica DICOM | `/dicom/worklist` | ADM/DIA | Lateral e launcher | Modalidades, Execução | Reprocessar item | Acompanhe itens exportados para as modalidades | Estático aprovado |
| Diagnóstico | Visualizador PACS | `/pacs` | ADM/DIA/MED | Lateral, launcher e exame | Laudos, Execução | Abrir estudo | Abra, compare e consulte estudos e imagens | Estático aprovado |
| Diagnóstico | Laudos | `/dicom/reports` | ADM/GES/DIA/MED | Lateral e launcher | PACS, Assinatura | Criar laudo | Produza, revise, assine e libere laudos | Estático aprovado |
| Diagnóstico | Modelos de laudo | `/admin/report-templates` | ADM/DIA | Launcher/administração | Laudos | Novo modelo | Cadastre e versione modelos usados em laudos | Estático aprovado |
| Diagnóstico | Integração DICOM | `/dicom/dashboard` | ADM/DIA | Launcher | Nós, Modalidades | Ver falhas | Monitore worklist, estudos e falhas DICOM | Estático aprovado |
| Diagnóstico | Modalidades DICOM | `/dicom/modalities` | ADM/DIA | Launcher | Equipamentos, Nós | Nova modalidade | Cadastre modalidades e parâmetros técnicos | Estático aprovado |
| Diagnóstico | Nós DICOM | `/dicom/nodes` | ADM/DIA | Launcher | Modalidades, PACS | Novo nó | Configure servidores e destinos DICOM | Estático aprovado |
| Diagnóstico | Equipamentos DICOM | `/admin/dicom` | ADM/DIA | Launcher/administração | Modalidades, Worklist | Novo equipamento | Administre equipamentos e conexões de imagem | Estático aprovado |
| Receita | Produção faturável | `/billing-production` | ADM/GES/FIN | Lateral e launcher | Assistência, Contas | Revisar produção | Acompanhe procedimentos e consumos capturados | Estático aprovado |
| Receita | Contas de faturamento | `/billing-accounts` | ADM/GES/FIN | Lateral e launcher | Produção, TISS | Conferir conta | Revise itens, pendências e fechamento assistencial | Estático aprovado |
| Receita | TISS | `/admin/tiss` | ADM/FIN/ADO | Lateral financeira e launcher | Contas, Operadoras | Gerar lote | Gere, valide e acompanhe guias e arquivos TISS | Estático aprovado |
| Receita | Financeiro | `/financial` | ADM/GES/FIN | Lateral e launcher | Recepção, Contas | Registrar recebimento | Controle títulos, pagamentos, caixa e conciliação | Estático aprovado |
| Receita | Repasses profissionais | `/professional-payment` | ADM/FIN | Lateral e launcher | Produção, Financeiro | Calcular repasse | Calcule e acompanhe valores devidos aos profissionais | Estático aprovado |
| Suprimentos | Farmácia | `/pharmacy` | ADM/GES/MED/FAR/ADO | Lateral e launcher | Prescrição, Estoque | Dispensar | Valide prescrições e dispense medicamentos | Estático aprovado |
| Suprimentos | Compras | `/purchases` | ADM/GES/FAR/ADO | Lateral autorizada e launcher | Farmácia, Estoque | Nova solicitação | Solicite, aprove, cote e acompanhe compras | Estático aprovado |
| Suprimentos | Transporte | `/transport` | ADM/GES/REC/ENF/ADO | Launcher | PA, Internação | Solicitar transporte | Solicite e acompanhe transportes e remoções | Estático aprovado |
| Gestão | BI e indicadores | `/bi` | ADM/GES/MED/FIN | Lateral e launcher | Todos os módulos | Consultar indicador | Acompanhe indicadores operacionais, clínicos e financeiros | Estático aprovado |
| Gestão | Metas | `/bi/metas` | ADM/GES/MED/FIN | Launcher | BI | Nova meta | Cadastre metas e acompanhe desempenho | Estático aprovado |
| Gestão | Alertas gerenciais | `/bi/alertas` | ADM/GES/MED/FIN | Launcher | BI | Configurar alerta | Acompanhe desvios dos indicadores | Estático aprovado |
| Gestão | Experiência e NPS | `/nps` | ADM/GES | Launcher | Atendimento, Gestão | Ver respostas | Acompanhe satisfação e planos de ação | Estático aprovado |
| Administração | Usuários | `/admin/users` | ADM/ADO | Launcher | Perfis, Permissões | Novo usuário | Cadastre usuários e controle o estado de acesso | Estático aprovado |
| Administração | Perfis | `/admin/profiles` | ADM/ADO | Launcher | Usuários, Permissões | Novo perfil | Organize papéis e conjuntos de permissões | Estático aprovado |
| Administração | Permissões | `/admin/permissions` | ADM/ADO | Launcher | Usuários, Auditoria | Alterar permissão | Defina ações permitidas por módulo e perfil | Estático aprovado |
| Administração | Empresas e unidades | `/companies` | ADM/GES/ADO | Lateral e launcher | Contexto, Profissionais | Nova unidade | Administre empresas, unidades e contextos | Estático aprovado |
| Administração | Convênios | `/admin/insurances` | ADM/GES/ADO | Lateral e launcher | Tabelas, Recepção | Novo convênio | Cadastre operadoras, planos, contratos e cobertura | Estático aprovado |
| Administração | Credenciamento | `/admin/credentialing` | ADM/GES/ADO | Lateral e launcher | Profissionais, Convênios | Credenciar | Gerencie vínculos entre profissional, unidade e plano | Estático aprovado |
| Administração | Tabelas de preços | `/admin/price-tables` | ADM/GES/FIN/ADO | Lateral e launcher | Convênios, Faturamento | Nova regra | Cadastre valores, vigências e regras por pagador | Estático aprovado |
| Administração | Cadastros mestres | `/master-data` | ADM/ADO | Lateral e launcher | Todos os módulos | Novo cadastro | Administre catálogos compartilhados | Estático aprovado |
| Administração | LGPD e privacidade | `/admin/lgpd` | ADM/DPO | Lateral e launcher | Auditoria, Pacientes | Abrir solicitação | Gerencie consentimentos e solicitações de privacidade | Estático aprovado |
| Administração | Auditoria | `/admin/audit` | ADM/DPO | Lateral e launcher | Todos os módulos | Filtrar eventos | Consulte acessos, alterações e eventos críticos | Estático aprovado |
| Administração | Central de notificações | `/admin/notifications` | ADM/DPO/ADO | Lateral e launcher | Todos os módulos | Abrir central | Configure e acompanhe notificações operacionais | Feed pessoal pendente |
| Administração | Configurações | `/settings` | ADM/GES/ADO | Lateral e launcher | Organização, Tecnologia | Salvar parâmetros | Ajuste parâmetros gerais da organização | Estático aprovado |

## Menu diário por perfil

| Perfil | Itens da lateral |
|---|---|
| Administrador | Dashboard, Agenda, Recepção, Pacientes, Atendimento clínico, Contas de faturamento, Financeiro, BI |
| Gestor | Dashboard, Agenda, Recepção, Pacientes, Contas de faturamento, Financeiro, BI |
| Recepção | Dashboard, Agenda, Recepção, Pacientes, Call Center, Pronto Atendimento |
| Médico | Dashboard, Agenda, Atendimento clínico, Prontuário, Laudos, Telemedicina, Internação |
| Enfermagem | Dashboard, Triagem, Cuidados de enfermagem, Painel de chamada, Internação, Pronto Atendimento |
| Laboratório | Dashboard, Laboratório, Execução de exames |
| Diagnóstico | Dashboard, Pedidos de imagem, Execução de exames, Fila técnica DICOM, Visualizador PACS, Laudos |
| Farmácia | Dashboard, Farmácia, Compras |
| Financeiro | Dashboard, Contas de faturamento, Produção faturável, Financeiro, Repasses profissionais, TISS |
| DPO | Dashboard, LGPD e privacidade, Auditoria, Central de notificações |
| Administrativo | Dashboard, Profissionais, Empresas e unidades, Convênios, Credenciamento, Tabelas de preços, Cadastros mestres, Configurações |

Perfis com menos de cinco tarefas diárias não recebem itens artificiais apenas
para preencher o menu. Todos os módulos realmente autorizados continuam no
launcher pesquisável.
