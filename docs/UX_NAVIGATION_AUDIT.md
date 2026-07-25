# Auditoria de navegação e experiência

## Escopo e método

Auditoria da branch `ux/sidebar-navigation-refactor`, comparando as rotas privadas de
`src/App.tsx` com o catálogo central, as permissões de rota, os menus por perfil,
o lançador pesquisável e os breadcrumbs. Nenhuma rota foi removida.

Perfis abreviados: `ADM` administrador, `GES` gestor, `REC` recepção, `MED`
médico, `ENF` enfermagem, `LAB` laboratório, `DIA` diagnóstico, `FAR` farmácia,
`FIN` financeiro, `DPO` privacidade e `ADO` administrativo. `*` significa todos
os usuários autenticados.

Status:

- **Corrigido**: correção implementada e coberta por teste automatizado.
- **Preservado**: rota e acesso existentes permanecem disponíveis.
- **Pendente funcional**: depende de contrato de negócio além desta refatoração.
- **Pendente E2E**: exige ambiente autenticado e fixtures operacionais.

## Inventário de rotas privadas

| Rota | Tela e função | Perfis | Área e acesso | Dados / conexões | Problema, decisão e status |
|---|---|---|---|---|---|
| `/` | Dashboard de prioridades | Todos os perfis conhecidos | Início; lateral e lançador | Indicadores de todos os módulos | Mantido como entrada por perfil. **Preservado** |
| `/schedule` | Agenda de consultas, exames e procedimentos | ADM, GES, REC, MED | Operação; lateral e lançador | Agendamentos, pacientes, profissionais, salas | Nome e descrição esclarecidos. Abas atuais não substituem uma grade profissional completa. **Pendente funcional** |
| `/reception` | Check-in e encaminhamento | ADM, GES, REC | Operação; lateral e lançador | Paciente, pagador, convênio, autorização, conta | É a dona da entrada do paciente. O fluxo único de 12 etapas ainda não existe integralmente. **Pendente funcional** |
| `/patients` | Pesquisa e cadastro administrativo | ADM, GES, REC, MED | Operação; lateral e lançador | Identificação, documentos, contatos, convênios | Catálogo é dono das rotas contextuais abaixo. **Corrigido** |
| `/patients/new` | Novo paciente | Mesmo de `/patients` | Ação contextual em Pacientes | Cadastro administrativo | Não vira item duplicado; continua acessível por botão. **Preservado** |
| `/patients/:id` | Detalhe do paciente | Mesmo de `/patients` | Resultado da busca/lista | Dados administrativos e vínculos | Breadcrumb herdado de Pacientes. **Corrigido** |
| `/patients/:id/edit` | Edição do paciente | Mesmo de `/patients` | Ação contextual no detalhe | Dados administrativos | Permissão usa o prefixo exato `/patients`. **Corrigido** |
| `/meus-agendamentos` | Agenda do portal | * | Operação; lançador e portal | Agendamentos do usuário | Rota privada estava fora do catálogo. **Corrigido** |
| `/callcenter` | Contatos e conversão em agenda | ADM, REC | Operação; lateral e lançador | Contatos, pacientes, agendamentos | Responsabilidade separada da Recepção. **Preservado** |
| `/pa` | Jornada de pronto atendimento | ADM, GES, REC, MED, ENF | Operação; lateral e lançador | Fila, classificação, atendimento | Nome operacional preservado. **Preservado** |
| `/telemedicina` | Atendimento remoto | ADM, GES, MED | Operação; lateral médica e lançador | Sala, consulta, documentos | Mantido fora da lateral dos demais perfis. **Preservado** |
| `/professionals` | Profissionais, habilitações e vínculos | ADM, GES, ADO | Assistência; lateral administrativa e lançador | Profissionais, unidades, convênios | Deve compartilhar a mesma origem futura de grade da Agenda. **Pendente funcional** |
| `/records` | Prontuário longitudinal | ADM, MED | Assistência; lateral médica e lançador | História clínica, documentos | Separado do episódio atual. **Preservado** |
| `/encounters` | Lista de atendimentos clínicos | ADM, MED | Assistência; lateral e lançador | Episódios, agenda, prontuário | É o ponto de entrada do atendimento atual. **Corrigido** |
| `/attendance/:appointmentId` | Atendimento clínico atual | ADM, MED | Ação contextual em Atendimento | Anamnese, exame, diagnóstico, conduta | Catalogada como rota relacionada, sem item duplicado. **Corrigido** |
| `/clinical-timeline` | Linha do tempo clínica | ADM, MED | Assistência; lançador e prontuário | Eventos clínicos | Retirada da rotina lateral, preservada no catálogo. **Preservado** |
| `/nursing/triage` | Triagem e risco | ADM, MED, REC, ENF | Assistência; lateral e lançador | Sinais vitais, queixa, risco | Nome orientado à tarefa. **Preservado** |
| `/nursing/care` | Cuidados de enfermagem | ADM, MED, REC, ENF | Assistência; lateral e lançador | Medicações, procedimentos, tarefas | Separado da triagem. **Preservado** |
| `/nursing/queue` | Painel de chamada | ADM, MED, REC, ENF | Assistência; lateral e lançador | Fila e senhas | Mesma página técnica da triagem no App; duplicidade funcional a revisar. **Pendente funcional** |
| `/internacao` | Internação e leitos | ADM, GES, MED, ENF | Assistência; lateral e lançador | Admissão, leito, evolução, alta | Mantida como módulo assistencial. **Preservado** |
| `/cirurgia` | Centro cirúrgico | ADM, GES, MED, ENF | Assistência; lançador | Agenda, equipe, sala, OPME | Não polui a lateral geral. **Preservado** |
| `/assinatura` | Assinatura digital | ADM, MED | Assistência; lançador e ações contextuais | Documentos e certificados | Mantida como função transversal. **Preservado** |
| `/ia-clinica` | Assistência clínica supervisionada | ADM, GES, MED | Assistência; lançador | Contexto clínico e auditoria | Descrição explicita supervisão. **Preservado** |
| `/lab` | Fluxo laboratorial | ADM, GES, MED, DIA, LAB | Diagnóstico; lateral e lançador | Coleta, amostras, resultados | Separado de imagem/DICOM. **Preservado** |
| `/worklist` | Execução assistencial de exames | ADM, DIA, LAB | Diagnóstico; lateral e lançador | Pedido, execução, PACS | Nome diferencia execução de fila DICOM. **Corrigido** |
| `/dicom/orders` | Pedidos de imagem | ADM, DIA | Diagnóstico; lateral e lançador | Solicitações de imagem | Separado da execução. **Corrigido** |
| `/dicom/worklist` | Fila técnica DICOM | ADM, DIA | Diagnóstico; lateral e lançador | MWL, accession, modalidade | Nome técnico explícito. **Corrigido** |
| `/pacs` | Visualizador PACS | ADM, DIA, MED | Diagnóstico; lateral e lançador | Estudos e instâncias | Preservado também como ação contextual de exame/laudo. **Preservado** |
| `/dicom/reports` | Produção e assinatura de laudos | ADM, GES, DIA, MED | Diagnóstico; lateral e lançador | Estudo, laudo, assinatura | Diferenciado de PACS. **Corrigido** |
| `/admin/report-templates` | Modelos de laudo | ADM, DIA | Diagnóstico; lançador/administração | Templates e versões | Função pouco frequente fora da lateral. **Preservado** |
| `/dicom/dashboard` | Monitor de integração DICOM | ADM, DIA | Diagnóstico; lançador | Jobs, estudos, falhas | Diferenciado da execução clínica. **Corrigido** |
| `/dicom/modalities` | Modalidades DICOM | ADM, DIA | Diagnóstico; lançador | AE Title e parâmetros | Configuração técnica fora da rotina geral. **Preservado** |
| `/dicom/nodes` | Nós DICOM | ADM, DIA | Diagnóstico; lançador | PACS, Worklist e endpoints | Configuração técnica preservada. **Preservado** |
| `/admin/dicom` | Equipamentos DICOM | ADM, DIA | Diagnóstico; lançador/administração | Equipamentos e conexões | Gate específico alinhado ao catálogo e à matriz. **Corrigido** |
| `/billing-production` | Produção faturável | ADM, GES, FIN | Receita; lateral e lançador | Itens assistenciais produzidos | Entrada para composição da conta, não recebimento. **Corrigido** |
| `/billing-accounts` | Contas de faturamento | ADM, GES, FIN | Receita; lateral e lançador | Conta, itens, críticas, fechamento | Diferenciada de produção, TISS e financeiro. **Corrigido** |
| `/admin/tiss` | Guias, lotes e XML TISS | ADM, ADO, FIN | Receita; lateral financeira e lançador | Guias, lotes, XML | Não deve ser usada para caixa. **Corrigido** |
| `/financial` | Caixa, títulos e conciliação | ADM, GES, FIN | Receita; lateral e lançador | Dinheiro, Pix, cartão, recebíveis | Diferenciada de faturamento. **Corrigido** |
| `/professional-payment` | Repasses profissionais | ADM, FIN | Receita; lateral e lançador | Produção e repasses | Módulo próprio preservado. **Preservado** |
| `/pharmacy` | Farmácia e dispensação | ADM, GES, MED, FAR, ADO | Suprimentos; lateral e lançador | Prescrição, dispensação, estoque | Separada de Compras. **Preservado** |
| `/purchases` | Compras | ADM, GES, FAR, ADO | Suprimentos; lateral e lançador | Solicitações, cotações, recebimento | Só aparece na lateral autorizada. **Preservado** |
| `/transport` | Transporte | ADM, GES, REC, ENF, ADO | Suprimentos; lançador | Solicitações e remoções | Fora da lateral para reduzir ruído. **Preservado** |
| `/bi` | BI e indicadores | ADM, GES, MED, FIN | Gestão; lateral e lançador | Indicadores consolidados | Mantido por perfil. **Preservado** |
| `/bi/metas` | Metas gerenciais | ADM, GES, MED, FIN | Gestão; lançador | Metas e KPIs | Rota específica vence o prefixo `/bi`. **Corrigido** |
| `/bi/alertas` | Alertas gerenciais | ADM, GES, MED, FIN | Gestão; lançador | Limites e desvios | Mantido fora da lateral. **Preservado** |
| `/nps` | Experiência e NPS | ADM, GES | Gestão; lançador | Pesquisas, respostas, planos | Formulário público `/nps/:token` não entra no catálogo privado. **Preservado** |
| `/admin/users` | Usuários | ADM, ADO | Administração; lançador | Conta e estado de acesso | A API/RBAC continua autoridade. **Preservado** |
| `/admin/profiles` | Perfis | ADM, ADO | Administração; lançador | Papéis | Fora da rotina operacional. **Preservado** |
| `/admin/permissions` | Permissões | ADM, ADO | Administração; lançador | Permissões por módulo | Fora da rotina operacional. **Preservado** |
| `/companies` | Empresas e unidades | ADM, GES, ADO | Administração; lateral e lançador | Empresas, unidades, contexto | Troca de contexto agora atualiza menu e gates. **Corrigido** |
| `/admin/insurances` | Convênios | ADM, GES, ADO | Administração; lateral e lançador | Operadoras, planos, contratos | Nome comercial claro. **Preservado** |
| `/admin/credentialing` | Credenciamento | ADM, GES, ADO | Administração; lateral e lançador | Profissional, unidade, plano, serviço | Responsabilidade explícita. **Preservado** |
| `/admin/price-tables` | Tabelas de preços | ADM, GES, FIN, ADO | Administração; lateral e lançador | Valores, vigências, pagadores | Separada do faturamento operacional. **Preservado** |
| `/master-data` | Cadastros mestres | ADM, ADO | Administração; lateral e lançador | Catálogos compartilhados | Função central preservada. **Preservado** |
| `/admin/lgpd` | LGPD e privacidade | ADM, DPO | Administração; lateral e lançador | Consentimentos e solicitações | Perfil DPO incluído. **Corrigido** |
| `/admin/audit` | Auditoria | ADM, DPO | Administração; lateral e lançador | Logs e eventos | Perfil DPO incluído. **Corrigido** |
| `/admin/notifications` | Central de notificações | ADM, DPO, ADO | Administração; lateral e lançador | Regras e mensagens | Sino superior não mostra contador fictício. Feed pessoal ainda não integrado. **Pendente funcional** |
| `/settings` | Configurações | ADM, GES, ADO | Administração; lateral e lançador | Parâmetros organizacionais | Fora da lateral operacional. **Preservado** |

## Problemas encontrados e decisões

1. **Rota privada órfã**: `/meus-agendamentos` não estava no catálogo. Foi
   catalogada em Operação e atendimento.
2. **Correspondência insegura por prefixo**: caminhos como `/patients-legacy`
   podiam herdar a permissão de `/patients`. O matching agora exige o segmento
   exato ou uma barra subsequente.
3. **Contexto ativo divergente**: menu, launcher, atalhos e tela de acesso negado
   usavam o papel original, mesmo depois da troca de unidade/perfil. Todos agora
   consomem o papel do contexto ativo.
4. **Notificação fictícia**: o cabeçalho mostrava `3` notificações sem fonte de
   dados. O contador falso foi removido e o sino ganhou ação real.
5. **Ajuda e usuário sem ação completa**: ajuda passou a abrir a central de
   atalhos; identidade e logout foram agrupados em menu de usuário acessível.
6. **Launcher sem nome acessível**: diálogo recebeu título, descrição e campo de
   busca nomeado.
7. **Rotas contextuais**: cadastro/detalhe/edição de paciente e atendimento atual
   permanecem fora da lateral, mas possuem dono de catálogo e breadcrumb.
8. **Gate administrativo divergente**: rotas específicas de DPO, financeiro,
   gestor e diagnóstico eram protegidas pelo prefixo genérico `/admin`, em
   desacordo com o launcher. Cada `ProtectedRoute` agora usa a rota específica,
   com teste de equivalência para todos os papéis.
9. **Troca de contexto frágil**: o seletor podia permanecer carregando após a
   primeira troca. O estado agora é liberado em sucesso ou erro e o cabeçalho
   reage também à ativação automática.
10. **Contexto armazenado inconsistente**: o papel só é aceito pela navegação
    quando empresa, vínculo, papel e unidade coincidem com o registro devolvido
    pelo backend. API e RLS continuam sendo a autoridade contra manipulação.
11. **Breadcrumbs legados**: oito telas com cabeçalho próprio receberam
    `PageBreadcrumb`; o wrapper duplicado do BI foi removido.
12. **Telemedicina**: papel e empresa agora acompanham o contexto ativo, evitando
    controles médicos indevidos depois de troca de perfil.

## Lacunas que não podem ser mascaradas

- Agenda ainda precisa de contrato e UI únicos para **Grades dos profissionais**
  e aba **Agenda e disponibilidade** no cadastro do profissional.
- Recepção ainda precisa consolidar identificação, pagador, elegibilidade,
  autorização, guia, pagamento, termos e destino em um check-in único e
  auditável. A navegação esclarece a responsabilidade, mas não cria esse fluxo.
- O sino não possui feed pessoal em tempo real; por isso não exibe contagem.
- A rota `/nursing/queue` reutiliza a página de triagem no `App.tsx`; a decisão
  funcional entre painel próprio e aba interna ainda precisa ser formalizada.
- A matriz E2E de dez perfis depende de fixtures e backend autenticado. Até essa
  execução, o PR deve permanecer em rascunho.
- Não há evidência nesta branch de publicação ou validação na VPS.
