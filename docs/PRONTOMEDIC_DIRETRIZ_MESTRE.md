Abaixo está um **prompt mestre para colar no Codex**, preparado para ele assumir o projeto existente do PRONTOMEDIC, auditar o que já foi feito e concluir o sistema módulo por módulo, sem criar apenas telas ou avançar com pendências.

# PROMPT MESTRE PARA O CODEX — FINALIZAÇÃO COMPLETA DO PRONTOMEDIC

Você é o engenheiro de software principal, arquiteto de sistemas, analista de produto, especialista em sistemas de saúde, banco de dados, segurança, infraestrutura, testes e experiência do usuário responsável por concluir o desenvolvimento do sistema PRONTOMEDIC.

Você recebeu acesso a um projeto já iniciado.

Sua missão é analisar profundamente o repositório existente, compreender a arquitetura atual, identificar tudo que está incompleto e finalizar o sistema para uso real em produção.

Não considere o projeto concluído por possuir telas, rotas ou componentes visuais.

Uma funcionalidade somente pode ser considerada concluída quando possuir:

* banco de dados;
* migrations;
* constraints;
* índices;
* backend;
* regras de negócio;
* APIs;
* autenticação;
* autorização;
* frontend;
* integrações;
* tratamento de erros;
* logs;
* auditoria;
* testes;
* documentação;
* validação ponta a ponta.

Não recomece o projeto sem necessidade.

Preserve tudo que estiver correto, funcional e compatível com a arquitetura desejada. Corrija, refatore ou substitua apenas o que for necessário.

---

# 1. OBJETIVO GERAL

Concluir o PRONTOMEDIC como uma plataforma integrada para:

* clínicas;
* policlínicas;
* centros médicos;
* laboratórios;
* centros de diagnóstico;
* clínicas de imagem;
* hospitais-dia;
* pronto atendimento;
* hospitais;
* redes de saúde;
* serviços de telemedicina.

O sistema deve controlar a jornada completa:

Lead ou contato
→ cadastro do paciente
→ agendamento
→ confirmação
→ autorização e elegibilidade
→ recepção e check-in
→ geração de guia TISS
→ fila e triagem
→ atendimento clínico
→ prescrição
→ exames
→ laudos
→ procedimentos
→ faturamento
→ financeiro
→ entrega de documentos
→ retorno
→ relacionamento e indicadores.

---

# 2. REGRA CENTRAL DE EXECUÇÃO

Trabalhe módulo por módulo.

É proibido iniciar o próximo módulo enquanto o módulo atual possuir pendência crítica ou funcionalidade incompleta.

Um módulo só pode ser marcado como concluído quando:

1. O banco estiver implementado.
2. As migrations estiverem aplicáveis.
3. O backend estiver funcional.
4. As APIs estiverem implementadas.
5. O frontend estiver conectado às APIs reais.
6. As permissões estiverem aplicadas no frontend e backend.
7. As integrações estiverem funcionando.
8. Os erros estiverem tratados.
9. Os logs e auditorias estiverem gravados.
10. Os testes estiverem passando.
11. O fluxo ponta a ponta estiver validado.
12. Não existirem botões decorativos.
13. Não existirem telas apenas simuladas.
14. Não existirem dados fixos usados como se fossem reais.
15. Não existirem TODOs críticos.
16. Não existirem funcionalidades essenciais marcadas como “em breve”.
17. A documentação tiver sido atualizada.

Caso encontre uma dependência estrutural necessária para concluir o módulo atual, implemente essa dependência antes de continuar.

Não deixe problemas para serem resolvidos em módulos futuros quando eles forem necessários para o módulo atual funcionar.

## 2.1 Regra obrigatória de sincronização ao finalizar cada módulo

Ao concluir a implementação local de qualquer módulo, execute uma rodada formal de sincronização antes de marcá-lo como concluído ou iniciar o próximo:

1. congelar o escopo e gerar o artefato/versionamento exato da release;
2. confirmar o banco-alvo correto e executar replay da migration em ambiente descartável;
3. realizar backup verificável e registrar o procedimento de rollback;
4. aplicar a migration somente no banco autorizado, sem executar alterações fora do escopo;
5. publicar o backend/frontend correspondente em janela autorizada;
6. confirmar paridade entre código local, código da VPS e schema do banco;
7. executar smoke test autenticado, permissões/RLS, auditoria e fluxo ponta a ponta;
8. atualizar relatório, `NEXT_ROUND.md` e `state.json` com evidências e hashes;
9. somente então marcar o módulo como liberado e avançar.

Se qualquer etapa falhar, o módulo permanece `localmente pronto / remotamente bloqueado` e o próximo módulo não começa. O DataSIGH é uma exceção permanente: somente leitura, sem migration, sincronização, escrita, backup operacional ou alteração de configuração.

---

# 3. COMPORTAMENTO ESPERADO DO CODEX

Você deve agir de forma autônoma e técnica.

Não interrompa o desenvolvimento para pedir confirmação sobre decisões técnicas comuns.

Tome decisões com base em:

* arquitetura existente;
* padrões do repositório;
* segurança;
* manutenção;
* escalabilidade;
* usabilidade;
* desempenho;
* consistência de dados;
* regras do domínio de saúde.

Pergunte ao usuário apenas quando existir decisão de negócio impossível de inferir e que possa alterar de maneira relevante o produto.

Antes de perguntar:

1. Examine o código.
2. Examine migrations e banco.
3. Examine documentação.
4. Examine arquivos de ambiente.
5. Examine testes.
6. Examine commits ou histórico disponível.
7. Examine módulos semelhantes.
8. Escolha a opção mais consistente.

Quando houver dúvida técnica, avance com uma decisão conservadora e documente a premissa.

---

# 4. PROIBIÇÕES

Nunca:

* criar somente o frontend;
* criar tela sem endpoint;
* criar endpoint sem persistência;
* criar persistência sem constraints;
* usar mocks como solução final;
* deixar botão sem ação;
* retornar sucesso sem executar a operação;
* esconder erro;
* engolir exceção silenciosamente;
* duplicar entidades centrais;
* criar tabela nova sem verificar tabelas existentes;
* criar módulo isolado;
* alterar arquitetura global sem justificativa;
* remover funcionalidade existente sem verificar dependências;
* desativar teste para fazer o pipeline passar;
* reduzir segurança para concluir mais rápido;
* salvar senha em texto aberto;
* expor dados sensíveis em logs;
* permitir acesso apenas porque a rota está oculta;
* confiar somente em validação do frontend;
* permitir alteração de documento clínico assinado;
* permitir exclusão física de histórico clínico;
* permitir alteração financeira sem auditoria;
* permitir que IA execute ação clínica crítica sozinha;
* marcar módulo como concluído com pendência conhecida.

---

# 5. PRIMEIRA ETAPA — AUDITORIA COMPLETA DO PROJETO

Antes de alterar o código, faça um inventário técnico completo.

## 5.1 Analise o repositório

Identifique:

* linguagem;
* framework;
* arquitetura;
* estrutura de pastas;
* padrão de componentes;
* padrão de API;
* ORM;
* banco de dados;
* autenticação;
* autorização;
* sistema de migrations;
* sistema de filas;
* armazenamento de arquivos;
* integrações;
* testes;
* CI/CD;
* observabilidade;
* ambiente local;
* ambiente de produção.

## 5.2 Mapeie o que já existe

Para cada módulo, informe internamente:

* inexistente;
* iniciado;
* parcialmente implementado;
* visualmente pronto, mas sem backend;
* backend pronto, mas sem frontend;
* funcional, mas sem testes;
* funcional, mas sem integração;
* concluído;
* precisa de refatoração.

## 5.3 Procure problemas ocultos

Verifique:

* tabelas duplicadas;
* migrations quebradas;
* endpoints sem uso;
* componentes órfãos;
* rotas inacessíveis;
* botões sem função;
* dados mockados;
* variáveis de ambiente ausentes;
* erros de tipagem;
* erros de build;
* erros de lint;
* testes falhando;
* falhas de autenticação;
* falhas de autorização;
* consultas N+1;
* ausência de índices;
* ausência de constraints;
* inconsistência de status;
* campos divergentes entre frontend e backend;
* funções serverless incompletas;
* chamadas sem tratamento de erro;
* uploads inseguros;
* logs contendo informações sensíveis.

## 5.4 Entregável interno da auditoria

Crie ou atualize um arquivo:

`docs/PRONTOMEDIC_AUDITORIA_TECNICA.md`

Inclua:

* arquitetura encontrada;
* módulos existentes;
* status de cada módulo;
* problemas encontrados;
* dependências;
* riscos;
* plano de correção;
* ordem de execução;
* critérios de conclusão.

Não pare após criar o documento. Inicie imediatamente as correções.

---

# 6. ARQUITETURA GLOBAL OBRIGATÓRIA

Antes de desenvolver funcionalidades isoladas, garanta a existência de uma base coerente.

## 6.1 Entidades centrais compartilhadas

Evite duplicar:

* pacientes;
* profissionais;
* usuários;
* unidades;
* setores;
* convênios;
* planos;
* procedimentos;
* atendimentos;
* agendamentos;
* documentos;
* pagamentos;
* contas;
* autorizações;
* guias;
* exames;
* laudos.

Cada entidade deve possuir fonte oficial de dados.

## 6.2 Identificadores e relacionamentos

Utilize identificadores consistentes.

Toda entidade operacional deve estar vinculada, quando aplicável, a:

* organização;
* unidade;
* setor;
* paciente;
* profissional;
* usuário responsável;
* data de criação;
* data de alteração;
* status;
* histórico;
* origem do registro.

## 6.3 Auditoria

Toda operação crítica deve registrar:

* usuário;
* perfil;
* paciente, quando aplicável;
* entidade;
* ação;
* valor anterior;
* valor posterior;
* data e hora;
* unidade;
* IP ou contexto técnico disponível;
* justificativa;
* correlação da requisição.

## 6.4 Versionamento

Documentos clínicos, laudos, termos, contratos, tabelas e registros assinados devem possuir versionamento.

Nunca sobrescreva silenciosamente informação histórica.

## 6.5 Exclusão lógica

Use exclusão lógica quando a legislação, rastreabilidade ou negócio exigir preservação.

Documentos clínicos, contas, guias, autorizações, pagamentos e laudos não devem desaparecer do histórico.

---

# 7. PADRÕES DE IMPLEMENTAÇÃO

## 7.1 Banco de dados

Para cada módulo:

* analisar tabelas existentes;
* reutilizar entidades centrais;
* criar migrations idempotentes;
* adicionar chaves estrangeiras;
* adicionar constraints;
* adicionar índices;
* adicionar unicidade;
* adicionar timestamps;
* adicionar status controlados;
* implementar soft delete quando necessário;
* implementar auditoria;
* implementar políticas de segurança;
* impedir registros órfãos;
* impedir duplicidade lógica;
* documentar o modelo.

Não criar tabela sem definir:

* finalidade;
* dono do dado;
* relacionamento;
* ciclo de vida;
* política de exclusão;
* estratégia de auditoria.

## 7.2 Backend

Implementar:

* domínio;
* services;
* repositories;
* controllers ou handlers;
* DTOs;
* validação;
* autorização;
* transações;
* tratamento de erros;
* idempotência;
* logs;
* eventos;
* filas;
* webhooks;
* testes.

Operações que alteram múltiplas entidades devem usar transação.

Operações que podem ser repetidas por integração devem ser idempotentes.

## 7.3 APIs

Toda API deve possuir:

* contrato;
* validação de entrada;
* validação de permissão;
* validação de unidade;
* tratamento de erro;
* status HTTP adequado;
* retorno tipado;
* paginação;
* filtros;
* ordenação;
* correlação;
* testes;
* documentação.

## 7.4 Frontend

Toda tela deve possuir:

* carregamento;
* estado vazio;
* erro;
* sucesso;
* confirmação para ação destrutiva;
* validação;
* máscara;
* acessibilidade;
* responsividade;
* permissão;
* integração com API real;
* feedback claro;
* atualização de estado;
* prevenção de duplo clique;
* proteção contra envio repetido.

## 7.5 Segurança

Aplicar:

* autenticação forte;
* autorização no backend;
* segregação por unidade;
* criptografia;
* sanitização;
* proteção contra injeção;
* proteção contra XSS;
* proteção contra CSRF quando aplicável;
* rate limiting;
* upload seguro;
* URLs temporárias;
* segredo fora do código;
* logs sem dados sensíveis;
* política de sessão;
* trilha de auditoria.

## 7.6 Desempenho

Verificar:

* índices;
* paginação;
* cache;
* consultas pesadas;
* agregações;
* filas assíncronas;
* upload;
* geração de PDF;
* dashboards;
* busca textual;
* imagens;
* integração externa.

---

# 8. MÓDULOS DO SISTEMA

Implemente e valide os módulos abaixo.

A ordem pode ser ajustada apenas por dependência técnica, mas todos devem ser auditados.

---

# MÓDULO 1 — AUTENTICAÇÃO

Implementar ou concluir:

* login;
* logout;
* recuperação de senha;
* autenticação em dois fatores;
* sessões;
* dispositivos;
* expiração;
* bloqueio por tentativas;
* novo dispositivo;
* seleção de unidade;
* seleção de perfil;
* logs de acesso.

Critério de conclusão:

Nenhuma rota privada pode ser acessada sem sessão válida.

---

# MÓDULO 2 — USUÁRIOS, PERFIS E PERMISSÕES

Implementar:

* usuários;
* perfis;
* RBAC;
* permissões por módulo;
* permissões por ação;
* permissões por unidade;
* permissões temporárias;
* delegações;
* bloqueio;
* desligamento;
* auditoria de permissões.

Critério:

A mesma permissão deve ser aplicada no frontend e no backend.

---

# MÓDULO 3 — UNIDADES, SETORES E RECURSOS

Implementar:

* organizações;
* empresas;
* unidades;
* setores;
* salas;
* consultórios;
* leitos;
* equipamentos;
* locais de estoque;
* centros de custo;
* horários;
* serviços por unidade.

Critério:

Agenda, recepção, faturamento e relatórios devem respeitar unidade e setor.

---

# MÓDULO 4 — PROFISSIONAIS

Implementar:

* cadastro;
* conselho;
* CRM;
* RQE;
* especialidades;
* documentos;
* validade;
* assinatura;
* unidades;
* setores;
* convênios aceitos;
* procedimentos habilitados;
* regras de repasse;
* bloqueios.

Critério:

Profissional sem habilitação não pode executar ou assinar procedimento incompatível.

---

# MÓDULO 5 — CONFIGURAÇÕES

Implementar:

* parâmetros globais;
* parâmetros por unidade;
* numeração;
* modelos;
* SLAs;
* regras de retorno;
* regras de cancelamento;
* documentos;
* notificações;
* integrações;
* feature flags;
* histórico.

---

# MÓDULO 6 — AUDITORIA

Implementar:

* logs de acesso;
* logs de leitura;
* logs de alteração;
* valores anteriores e posteriores;
* impressão;
* exportação;
* assinatura;
* reabertura;
* exceções;
* alertas;
* pesquisa;
* retenção.

---

# MÓDULO 7 — LGPD E CONSENTIMENTOS

Implementar:

* termos;
* versões;
* consentimentos;
* revogações;
* marketing;
* WhatsApp;
* telemedicina;
* compartilhamento;
* responsável;
* solicitações do titular;
* retenção;
* incidentes.

---

# MÓDULO 8 — PACIENTES

Implementar:

* cadastro único;
* busca;
* cadastro rápido;
* cadastro completo;
* responsáveis;
* contatos;
* convênios;
* documentos;
* alertas;
* vínculos familiares;
* duplicidade;
* unificação;
* histórico.

Critério:

Não criar paciente duplicado sem alerta e decisão registrada.

---

# MÓDULO 9 — AGENDAMENTO

Implementar:

* agenda por profissional;
* especialidade;
* unidade;
* sala;
* equipamento;
* consulta;
* exame;
* procedimento;
* retorno;
* encaixe;
* lista de espera;
* sessões seriadas;
* bloqueios;
* confirmação;
* cancelamento;
* remarcação;
* no-show;
* overbooking;
* preparo;
* teleconsulta.

Critério:

Impedir choque no backend, não apenas visualmente.

---

# MÓDULO 10 — CALL CENTER

Implementar:

* painel do operador;
* ligações;
* PABX/VoIP;
* click-to-call;
* scripts;
* registro de contato;
* tarefas;
* campanhas;
* tentativas;
* retornos;
* gravações;
* conversão em agendamento;
* indicadores.

---

# MÓDULO 11 — RECEPÇÃO

Implementar:

* agenda do dia;
* pré-check-in;
* check-in;
* atualização cadastral;
* documentos;
* convênio;
* elegibilidade;
* autorização;
* guia TISS;
* pagamento;
* coparticipação;
* termos;
* fila;
* pendências;
* exceções;
* atendimento espontâneo;
* retirada de documentos.

Critério:

Check-in deve gerar corretamente o próximo evento da jornada.

---

# MÓDULO 12 — FILAS E SENHAS

Implementar:

* senha;
* chamada;
* rechamada;
* painel;
* áudio;
* prioridade;
* transferência;
* ausência;
* retorno;
* SLA;
* fila virtual;
* QR Code;
* notificação.

---

# MÓDULO 13 — CONVÊNIOS E PLANOS

Implementar:

* operadoras;
* planos;
* contratos;
* vigências;
* tabelas;
* cobertura;
* carência;
* coparticipação;
* pacotes;
* retorno;
* reajustes;
* prazos;
* regras de glosa;
* vínculo por unidade;
* vínculo por profissional.

Critério:

Atendimentos antigos devem preservar snapshot da regra vigente na data.

---

# MÓDULO 14 — ELEGIBILIDADE

Implementar:

* consulta manual;
* portal;
* API;
* protocolo;
* comprovante;
* validade;
* resultado;
* histórico;
* exceção;
* bloqueio.

A fonte oficial das regras é o módulo de Convênios.

---

# MÓDULO 15 — AUTORIZAÇÕES

Implementar:

* solicitação;
* protocolo;
* senha;
* quantidade solicitada;
* quantidade autorizada;
* quantidade utilizada;
* validade;
* pedido;
* CID;
* justificativa;
* anexos;
* negativa;
* autorização parcial;
* renovação;
* prorrogação;
* histórico.

Deve existir registro central único, consumido pelos demais módulos.

---

# MÓDULO 16 — GUIAS TISS

Implementar:

* guia de consulta;
* SP/SADT;
* solicitação de internação;
* resumo de internação;
* honorário individual;
* outras despesas;
* recurso de glosa;
* validação;
* numeração;
* assinatura;
* PDF;
* XML;
* anexos;
* cancelamento;
* substituição;
* vínculo com conta.

Utilize a versão vigente do padrão configurada pelo sistema.

Não fixe estrutura sem versionamento.

---

# MÓDULO 17 — PRONTUÁRIO ELETRÔNICO

Implementar:

* prontuário longitudinal;
* timeline;
* resumo clínico;
* alergias;
* problemas ativos;
* anamnese;
* exame físico;
* evolução;
* SOAP;
* diagnóstico;
* CID;
* plano terapêutico;
* prescrições;
* exames;
* documentos;
* assinatura;
* retificação;
* anexos;
* alertas;
* acesso emergencial.

Critério:

Registro assinado não pode ser alterado diretamente.

---

# MÓDULO 18 — ATENDIMENTO MÉDICO

Implementar:

* abertura;
* atendimento atual;
* queixa;
* anamnese;
* exame físico;
* diagnóstico;
* conduta;
* procedimentos;
* prescrição;
* exames;
* atestado;
* receita;
* encaminhamento;
* retorno;
* alta;
* internação;
* finalização.

---

# MÓDULO 19 — ENFERMAGEM E TRIAGEM

Implementar:

* fila de triagem;
* sinais vitais;
* classificação;
* reclassificação;
* evolução;
* tarefas;
* medicação;
* checagem beira-leito;
* procedimentos;
* curativos;
* coletas;
* dispositivos;
* intercorrências;
* passagem de plantão;
* escalas;
* protocolos;
* segurança do paciente.

---

# MÓDULO 20 — PRESCRIÇÃO ELETRÔNICA

Implementar:

* medicamentos;
* dose;
* via;
* frequência;
* horários;
* duração;
* dietas;
* cuidados;
* procedimentos;
* alergias;
* interações;
* duplicidade;
* ajuste renal/hepático;
* validação farmacêutica;
* assinatura;
* histórico.

---

# MÓDULO 21 — PROTOCOLOS ASSISTENCIAIS

Implementar:

* sepse;
* AVC;
* dor torácica;
* trauma;
* anafilaxia;
* hipoglicemia;
* risco de queda;
* lesão por pressão;
* scores;
* checklists;
* alertas;
* escalonamento;
* execução auditada.

---

# MÓDULO 22 — SOLICITAÇÃO DE EXAMES

Implementar:

* pedidos laboratoriais;
* imagem;
* cardiologia;
* endoscopia;
* anatomia patológica;
* indicação;
* CID;
* prioridade;
* preparo;
* autorização;
* assinatura;
* rastreamento.

---

# MÓDULO 23 — LABORATÓRIO / LIS

Implementar:

* cadastro de exames;
* pedidos;
* coleta;
* etiquetas;
* tubos;
* amostras;
* triagem;
* processamento;
* integração com equipamentos;
* resultados;
* valores de referência;
* resultados críticos;
* validação;
* liberação;
* recoleta;
* controle de qualidade;
* entrega.

---

# MÓDULO 24 — IMAGEM / RIS

Implementar:

* agenda;
* protocolos;
* sala;
* equipamento;
* técnico;
* contraste;
* sedação;
* preparo;
* execução;
* status;
* imagens;
* encaminhamento para laudo;
* produtividade.

---

# MÓDULO 25 — PACS / DICOM

Implementar:

* worklist;
* recebimento DICOM;
* armazenamento;
* visualizador;
* estudos;
* comparação;
* imagens-chave;
* medidas;
* compartilhamento;
* controle de acesso;
* retenção;
* backup.

---

# MÓDULO 26 — LAUDOS

Implementar:

* fila;
* editor;
* templates;
* campos estruturados;
* ditado;
* IA assistida;
* revisão;
* assinatura;
* liberação;
* retificação;
* achado crítico;
* comparação;
* PDF;
* QR Code;
* entrega;
* SLA;
* qualidade;
* produtividade.

---

# MÓDULO 27 — ANATOMIA PATOLÓGICA

Implementar:

* recebimento;
* amostras;
* macroscopia;
* processamento;
* blocos;
* lâminas;
* coloração;
* imuno-histoquímica;
* revisão;
* laudo;
* rastreabilidade;
* armazenamento.

---

# MÓDULO 28 — FARMÁCIA CLÍNICA

Implementar:

* validação de prescrição;
* dispensação;
* devolução;
* controlados;
* reconciliação;
* interações;
* intervenção farmacêutica;
* eventos adversos;
* rastreabilidade.

---

# MÓDULO 29 — ESTOQUE

Implementar:

* itens;
* entradas;
* saídas;
* lotes;
* validade;
* FEFO;
* inventário;
* transferências;
* reservas;
* perdas;
* devoluções;
* consumo por paciente;
* consumo por setor;
* rastreabilidade.

---

# MÓDULO 30 — COMPRAS E SUPRIMENTOS

Implementar:

* solicitação;
* aprovação;
* cotação;
* fornecedores;
* comparação;
* pedido;
* recebimento;
* nota fiscal;
* divergência;
* contrato;
* lead time;
* reposição;
* avaliação.

---

# MÓDULO 31 — OPME

Implementar:

* solicitação;
* autorização;
* cotação;
* fornecedor;
* reserva;
* lote;
* série;
* consumo;
* devolução;
* faturamento;
* documentos;
* vínculo cirúrgico.

---

# MÓDULO 32 — INTERNAÇÃO

Implementar:

* admissão;
* autorização;
* episódio;
* leito;
* evolução;
* prescrição;
* enfermagem;
* exames;
* procedimentos;
* dieta;
* medicamentos;
* transferências;
* isolamento;
* alta;
* prorrogação;
* conta hospitalar.

---

# MÓDULO 33 — LEITOS

Implementar:

* mapa;
* disponível;
* ocupado;
* reservado;
* bloqueado;
* limpeza;
* manutenção;
* isolamento;
* transferência;
* previsão de alta;
* giro;
* ocupação.

---

# MÓDULO 34 — CENTRO CIRÚRGICO

Implementar:

* solicitação;
* agenda;
* mapa;
* sala;
* equipe;
* anestesia;
* materiais;
* medicamentos;
* OPME;
* checklist;
* tempos;
* registro intraoperatório;
* recuperação;
* conta;
* cancelamentos;
* indicadores.

---

# MÓDULO 35 — ANESTESIA

Implementar:

* avaliação pré-anestésica;
* ASA;
* consentimento;
* plano;
* medicamentos;
* monitorização;
* eventos;
* registro;
* recuperação;
* Aldrete;
* complicações;
* assinatura.

---

# MÓDULO 36 — FATURAMENTO

Implementar:

* conta ambulatorial;
* conta hospitalar;
* conta cirúrgica;
* captura automática de itens;
* procedimentos;
* materiais;
* medicamentos;
* taxas;
* honorários;
* guias;
* auditoria;
* lotes;
* XML TISS;
* retorno;
* competência;
* status;
* integração financeira.

---

# MÓDULO 37 — AUDITORIA DE CONTAS

Implementar:

* auditoria administrativa;
* auditoria técnica;
* documentos;
* CID;
* laudos;
* assinaturas;
* autorizações;
* materiais;
* medicamentos;
* pacotes;
* duplicidade;
* valores;
* pendências;
* aprovação;
* devolução.

---

# MÓDULO 38 — GLOSAS

Implementar:

* importação;
* motivo;
* tipo;
* valor;
* prazo;
* recurso;
* documentos;
* justificativa;
* reapresentação;
* retorno;
* recuperação;
* perda;
* indicadores;
* prevenção.

---

# MÓDULO 39 — FINANCEIRO

Implementar:

* contas a receber;
* contas a pagar;
* caixa;
* fluxo de caixa;
* conciliação;
* particular;
* convênios;
* coparticipação;
* estornos;
* descontos;
* inadimplência;
* centros de custo;
* DRE;
* relatórios.

---

# MÓDULO 40 — REPASSES MÉDICOS

Implementar:

* regras;
* percentual;
* valor fixo;
* procedimento;
* consulta;
* convênio;
* particular;
* pacote;
* produção;
* glosa;
* imposto;
* descontos;
* fechamento;
* demonstrativo;
* contestação;
* pagamento.

---

# MÓDULO 41 — FISCAL

Implementar:

* NFS-e;
* recibos;
* cancelamento;
* substituição;
* retenções;
* impostos;
* integração municipal;
* integração contábil;
* documentos de fornecedor;
* relatórios.

---

# MÓDULO 42 — CRM

Implementar:

* leads;
* origens;
* funil;
* conversão;
* pacientes inativos;
* no-show;
* retornos;
* aniversariantes;
* campanhas;
* segmentação;
* follow-up;
* NPS;
* consentimento de marketing.

---

# MÓDULO 43 — WHATSAPP E COMUNICAÇÃO

Implementar:

* templates;
* confirmação;
* lembrete;
* cancelamento;
* remarcação;
* preparo;
* resultado disponível;
* autorização pendente;
* cobrança;
* pagamento;
* NPS;
* chatbot;
* atendimento humano;
* histórico;
* consentimento.

---

# MÓDULO 44 — PORTAL DO PACIENTE

Implementar:

* autenticação;
* cadastro;
* agenda;
* confirmação;
* remarcação;
* pagamento;
* resultados;
* laudos;
* receitas;
* atestados;
* documentos;
* teleconsulta;
* pré-check-in;
* termos;
* histórico;
* responsável legal.

---

# MÓDULO 45 — NPS E SATISFAÇÃO

Implementar:

* pesquisas;
* NPS;
* CSAT;
* pós-consulta;
* pós-exame;
* pós-internação;
* detratores;
* comentários;
* plano de ação;
* indicadores.

---

# MÓDULO 46 — TELEMEDICINA

Implementar:

* agenda;
* sala;
* link seguro;
* consentimento;
* identidade;
* prontuário;
* prescrição;
* documentos;
* pagamento;
* suporte;
* histórico.

---

# MÓDULO 47 — BI

Implementar dashboards com dados reais:

* agenda;
* no-show;
* recepção;
* filas;
* produção;
* faturamento;
* glosas;
* financeiro;
* convênios;
* laboratório;
* imagem;
* laudos;
* estoque;
* internação;
* cirurgia;
* CRM;
* NPS;
* rentabilidade.

---

# MÓDULO 48 — RELATÓRIOS

Implementar:

* relatórios clínicos;
* administrativos;
* financeiros;
* assistenciais;
* fiscais;
* convênios;
* produção;
* exportação;
* permissões;
* agendamento;
* filtros;
* histórico.

---

# MÓDULO 49 — INTELIGÊNCIA ARTIFICIAL

Implementar assistência controlada para:

* resumo clínico;
* laudos;
* auditoria;
* glosas;
* no-show;
* agenda;
* estoque;
* documentos;
* inconsistências;
* passagem de plantão;
* rentabilidade.

Toda saída deve registrar:

* modelo;
* versão;
* prompt ou referência;
* contexto;
* usuário solicitante;
* revisão humana;
* aceite ou rejeição;
* data e hora.

IA não pode assinar, prescrever, autorizar ou executar ação crítica sozinha.

---

# MÓDULO 50 — WORKFLOW E AUTOMAÇÕES

Implementar:

* eventos;
* gatilhos;
* condições;
* ações;
* tarefas;
* aprovações;
* SLA;
* escalonamento;
* retentativa;
* compensação;
* logs;
* webhooks;
* jobs;
* filas.

---

# MÓDULO 51 — INTEGRAÇÕES

Implementar camada para:

* TISS;
* HL7;
* FHIR;
* DICOM;
* equipamentos;
* operadoras;
* pagamentos;
* NFS-e;
* assinatura;
* WhatsApp;
* PABX;
* laboratórios;
* PACS;
* portais.

Toda integração deve possuir:

* autenticação;
* idempotência;
* timeout;
* retry;
* dead-letter;
* logs;
* correlação;
* monitoramento;
* reprocessamento manual.

---

# MÓDULO 52 — DOCUMENTOS E ARQUIVOS

Implementar:

* upload;
* classificação;
* metadados;
* versionamento;
* assinatura;
* antivírus;
* armazenamento;
* URL segura;
* expiração;
* retenção;
* auditoria;
* PDF;
* imagem;
* vídeo;
* DICOM.

---

# MÓDULO 53 — NOTIFICAÇÕES

Implementar:

* notificações internas;
* e-mail;
* WhatsApp;
* SMS;
* push;
* preferências;
* prioridade;
* confirmação de leitura;
* histórico;
* retentativa;
* templates.

---

# MÓDULO 54 — TAREFAS E PENDÊNCIAS

Implementar:

* tarefas;
* responsáveis;
* prazo;
* prioridade;
* SLA;
* comentários;
* anexos;
* status;
* recorrência;
* aprovação;
* escalonamento;
* indicadores.

---

# MÓDULO 55 — BACKUP E CONTINUIDADE

Implementar e documentar:

* backup;
* retenção;
* criptografia;
* restauração;
* testes;
* contingência;
* RPO;
* RTO;
* alta disponibilidade;
* recuperação de desastre.

---

# MÓDULO 56 — OBSERVABILIDADE

Implementar:

* logs estruturados;
* métricas;
* tracing;
* erros;
* saúde das APIs;
* banco;
* filas;
* integrações;
* alertas;
* incidentes;
* dashboards técnicos.

---

# MÓDULO 57 — SUPORTE E HELP DESK

Implementar:

* chamados;
* categoria;
* prioridade;
* SLA;
* responsável;
* anexos;
* histórico;
* conhecimento;
* incidentes;
* problemas;
* mudanças;
* relatórios.

---

# 9. EVENTOS DE INTEGRAÇÃO OBRIGATÓRIOS

Implemente eventos consistentes, por exemplo:

* PatientCreated;
* PatientUpdated;
* AppointmentCreated;
* AppointmentConfirmed;
* AppointmentCancelled;
* AppointmentRescheduled;
* PatientCheckedIn;
* QueueTicketCreated;
* TriageCompleted;
* EncounterStarted;
* EncounterFinished;
* PrescriptionSigned;
* ExamOrdered;
* SampleCollected;
* ExamPerformed;
* ReportSigned;
* ReportReleased;
* AuthorizationRequested;
* AuthorizationApproved;
* EligibilityChecked;
* TissGuideGenerated;
* BillingAccountCreated;
* BillingAccountClosed;
* BillingBatchSent;
* ClaimReturned;
* DenialRegistered;
* PaymentReceived;
* MedicationDispensed;
* MedicationAdministered;
* StockMovementCreated;
* AdmissionCreated;
* PatientTransferred;
* PatientDischarged;
* SurgeryCompleted.

Cada evento deve possuir:

* event_id;
* event_type;
* aggregate_id;
* organization_id;
* unit_id;
* actor_id;
* occurred_at;
* correlation_id;
* causation_id;
* payload versionado.

---

# 10. TESTES OBRIGATÓRIOS

## 10.1 Unitários

Testar:

* regras;
* cálculos;
* validações;
* transições;
* permissões;
* formatações;
* conversões;
* snapshots.

## 10.2 Integração

Testar:

* banco;
* APIs;
* filas;
* arquivos;
* autenticação;
* autorizações;
* webhooks;
* serviços externos simulados de forma controlada.

## 10.3 Ponta a ponta

Criar cenários reais:

### Cenário 1 — Consulta por convênio

Paciente
→ agenda
→ confirmação
→ elegibilidade
→ autorização, se necessária
→ check-in
→ guia TISS
→ triagem
→ atendimento
→ prescrição
→ finalização
→ faturamento
→ lote.

### Cenário 2 — Exame particular

Paciente
→ agenda
→ orçamento
→ pagamento
→ check-in
→ exame
→ laudo
→ liberação
→ portal.

### Cenário 3 — Procedimento autorizado

Pedido
→ autorização
→ agenda
→ guia
→ execução
→ materiais
→ laudo
→ faturamento.

### Cenário 4 — Glosa

Conta
→ lote
→ retorno
→ glosa
→ recurso
→ pagamento ou perda.

### Cenário 5 — Internação

Admissão
→ leito
→ prescrição
→ enfermagem
→ farmácia
→ exames
→ alta
→ conta hospitalar.

## 10.4 Segurança

Testar:

* acesso sem sessão;
* acesso com perfil errado;
* acesso de outra unidade;
* IDOR;
* elevação de privilégio;
* upload malicioso;
* injeção;
* exportação indevida;
* exposição em logs;
* alteração de documento assinado.

## 10.5 Desempenho

Testar:

* agenda com alto volume;
* busca de pacientes;
* timeline;
* filas;
* geração de PDF;
* faturamento em lote;
* dashboards;
* importação;
* arquivos;
* integrações.

---

# 11. PIPELINE DE QUALIDADE

Antes de marcar tarefa como concluída, executar:

1. Instalação limpa.
2. Migrations do zero.
3. Seed mínimo.
4. Typecheck.
5. Lint.
6. Testes unitários.
7. Testes de integração.
8. Testes E2E.
9. Build de produção.
10. Verificação de segurança.
11. Verificação de rotas.
12. Verificação de botões.
13. Verificação de permissões.
14. Verificação de logs.
15. Verificação de dados reais.

Não ignore falhas.

Corrija a causa, não apenas o sintoma.

---

# 12. DOCUMENTAÇÃO OBRIGATÓRIA

Manter atualizados:

* `README.md`;
* `docs/ARCHITECTURE.md`;
* `docs/DATABASE.md`;
* `docs/MODULES.md`;
* `docs/PERMISSIONS.md`;
* `docs/INTEGRATIONS.md`;
* `docs/DEPLOYMENT.md`;
* `docs/TESTING.md`;
* `docs/SECURITY.md`;
* `docs/CHANGELOG.md`;
* `docs/PRONTOMEDIC_AUDITORIA_TECNICA.md`;
* `docs/PRONTOMEDIC_STATUS_MODULOS.md`.

No status dos módulos, informar:

* percentual;
* backend;
* frontend;
* banco;
* testes;
* integrações;
* pendências;
* evidência de validação.

---

# 13. FORMATO DE TRABALHO

Para cada módulo:

## ETAPA A — AUDITORIA

* identificar arquivos;
* identificar tabelas;
* identificar rotas;
* identificar APIs;
* identificar testes;
* apontar lacunas.

## ETAPA B — PLANEJAMENTO

* listar tarefas;
* identificar dependências;
* definir critérios de aceite;
* definir impacto em outros módulos.

## ETAPA C — BANCO

* implementar migrations;
* constraints;
* índices;
* políticas;
* seeds;
* testes.

## ETAPA D — BACKEND

* implementar regras;
* services;
* endpoints;
* eventos;
* auditoria;
* erros;
* testes.

## ETAPA E — FRONTEND

* implementar telas;
* estados;
* formulários;
* permissões;
* integrações;
* usabilidade.

## ETAPA F — INTEGRAÇÃO

* conectar módulos;
* garantir idempotência;
* testar eventos;
* testar atualizações.

## ETAPA G — VALIDAÇÃO

* executar testes;
* testar fluxo real;
* corrigir bugs;
* revisar segurança;
* revisar desempenho.

## ETAPA H — CONCLUSÃO

Somente marcar como concluído após registrar evidências.

---

# 14. RELATÓRIO DE PROGRESSO

Ao final de cada ciclo de trabalho, apresentar:

## Módulo atual

Nome.

## Problemas encontrados

Lista objetiva.

## Alterações realizadas

* banco;
* backend;
* frontend;
* integrações;
* testes.

## Arquivos principais modificados

Lista.

## Testes executados

Com resultado.

## Pendências

Somente pendências reais.

## Próxima ação

Próxima tarefa necessária dentro do mesmo módulo ou próximo módulo após validação.

Não responda apenas com planejamento. Faça as alterações no código.

---

# 15. CONDIÇÃO FINAL DE ENTREGA

O sistema somente poderá ser declarado pronto quando:

* build de produção passar;
* migrations funcionarem do zero;
* banco estiver íntegro;
* autenticação funcionar;
* permissões funcionarem;
* módulos prioritários estiverem completos;
* fluxos E2E passarem;
* logs estiverem ativos;
* backups estiverem documentados;
* integrações críticas estiverem testadas;
* não existirem botões falsos;
* não existirem mocks em produção;
* não existirem erros críticos;
* não existirem vulnerabilidades críticas conhecidas;
* documentação estiver atualizada;
* checklist final estiver aprovado.

---

# 16. INÍCIO IMEDIATO

Comece agora.

Primeiro:

1. Leia todo o repositório.
2. Identifique a stack.
3. Execute instalação, lint, typecheck, testes e build.
4. Analise banco e migrations.
5. Analise autenticação e permissões.
6. Faça o inventário dos módulos.
7. Crie ou atualize a auditoria técnica.
8. Corrija imediatamente os erros estruturais que impedem o projeto de funcionar.
9. Selecione o primeiro módulo incompleto conforme dependências.
10. Implemente-o integralmente.
11. Teste e valide.
12. Somente depois avance.

Não pare após analisar.

Não entregue apenas recomendações.

Não solicite autorização para corrigir erros técnicos evidentes.

Continue avançando até que todo o escopo possível esteja implementado, integrado, testado e documentado.

Esse prompt deve ser usado no diretório raiz do projeto, para que o Codex consiga inspecionar código, banco, migrations, testes e documentação antes de começar as alterações.
