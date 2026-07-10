# ProntoMedic Enterprise - Plano Mestre

## Funcao Principal

O ProntoMedic Enterprise e uma plataforma completa de gestao clinica e hospitalar para clinicas, policlinicas, hospitais-dia, centros medicos, unidades de diagnostico, pronto atendimento e redes de saude.

O sistema deve operar a jornada completa do paciente, desde a captacao do lead ate cadastro, agendamento, confirmacao, recepcao, triagem, atendimento, prontuario, exames, farmacia, faturamento, financeiro, entrega de resultados, retorno, relacionamento, indicadores, auditoria e inteligencia artificial.

O objetivo nao e criar telas isoladas. O objetivo e entregar software comercial real, integrado, auditavel, seguro, modular, testado e pronto para operacao.

## Regra Principal

O projeto deve evoluir modulo por modulo.

E proibido iniciar um novo modulo enquanto o modulo atual nao estiver completamente finalizado, testado e validado.

Um modulo so pode ser considerado finalizado quando cumprir:

- Levantamento funcional completo.
- Regras de negocio descritas.
- Jornada operacional definida.
- Banco de dados e migrations aplicados.
- Backend/API implementado.
- Frontend/telas implementadas.
- Integracoes com modulos anteriores funcionando.
- Permissoes e RBAC aplicados.
- Logs e auditoria funcionando.
- Validacoes de formulario e backend aplicadas.
- Testes unitarios, integracao e fluxo real executados.
- Erros criticos corrigidos.
- Checklist final aprovado.

## Fase 0 - Arquitetura Global

Antes de expandir qualquer modulo, consolidar a arquitetura global:

- Mapa completo dos modulos e dependencias.
- Jornada ponta a ponta do paciente.
- Modelo de dados mestre.
- Eventos de integracao entre modulos.
- Matriz RBAC por perfil, modulo e acao.
- Estrategia de arquitetura: monolito modular local primeiro, com possibilidade SaaS.
- Estrategia de migrations e versionamento.
- Estrategia de testes.
- Estrategia de backup e recuperacao.
- Observabilidade: logs, auditoria, metricas e rastreamento.
- Plano de escalabilidade.
- Regras LGPD e seguranca.

## Jornada Central Do Paciente

Lead ou paciente existente
-> CRM e origem
-> Cadastro
-> Convenio/elegibilidade
-> Agendamento
-> Confirmacao por WhatsApp
-> Recepcao e check-in
-> Triagem
-> Atendimento medico
-> Prontuario eletronico
-> Prescricao, solicitacao de exames ou procedimentos
-> Farmacia, laboratorio, imagem ou internacao
-> Faturamento
-> Financeiro
-> Entrega de resultado/documentos
-> Retorno
-> Pesquisa NPS
-> Campanhas e relacionamento
-> BI e auditoria

## Ordem Oficial Dos Modulos

1. Base do sistema / Administrativo
2. Cadastro de pacientes
3. Convenios e procedimentos
4. Agendamento
5. Recepcao
6. Atendimento medico / Prontuario eletronico
7. Enfermagem
8. Farmacia / Medicamentos e materiais
9. Exames / Laboratorio / LIS
10. Imagem / PACS / DICOM
11. Faturamento e glosas
12. Financeiro
13. Internacao
14. Centro cirurgico
15. Telemedicina
16. WhatsApp / Comunicacao
17. Portal do paciente
18. BI / Indicadores / Gestao
19. Inteligencia artificial
20. Auditoria final e go-live

## Modulos Transversais Obrigatorios

Estes temas atravessam todos os modulos:

- Autenticacao.
- Autorizacao por perfil.
- Auditoria.
- LGPD.
- Logs.
- Backup.
- Notificacoes.
- Integracao entre modulos.
- Rastreabilidade.
- Segurança.
- BI.
- IA assistiva com controle humano.

## Padrao De Entrega Por Modulo

Cada modulo deve seguir a mesma sequencia:

1. Planejamento funcional.
2. Banco de dados.
3. Backend/API.
4. Frontend.
5. Integracao com modulos anteriores.
6. Validacoes.
7. Logs e auditoria.
8. Testes.
9. Correcao de erros.
10. Checklist final.
11. Validacao antes de seguir.

## Padrao De Qualidade

Nunca entregar:

- Tela falsa.
- Mock como solucao final.
- Botao sem funcao.
- Backend ficticio.
- Banco incompleto.
- Fluxo quebrado.
- Dados duplicados.
- Regra de permissao ignorada.
- Integracao pendente escondida.
- Toast "em desenvolvimento" em funcao central.
- Modulo novo com erro critico no modulo anterior.

## Checklist Final De Cada Modulo

Antes de declarar um modulo pronto, responder:

- Banco finalizado?
- Migrations aplicadas?
- Backend finalizado?
- API testada?
- Frontend finalizado?
- Permissoes funcionando?
- Logs funcionando?
- Auditoria funcionando?
- Integracoes funcionando?
- Testes passaram?
- Performance validada?
- Seguranca validada?
- Documentacao concluida?
- Existe alguma pendencia?

Somente se todas as respostas criticas forem positivas, o projeto pode avancar para o proximo modulo.

## Estado Atual

O projeto ja possui uma base implementada com React, Vite, TypeScript, servidor local de autenticacao, PostgreSQL local, migracoes e varios modulos iniciados.

O proximo trabalho deve ser uma auditoria da Fase 0 e do Modulo 1 para identificar:

- O que ja esta pronto.
- O que esta parcial.
- O que esta quebrado.
- O que esta duplicado.
- O que precisa ser corrigido antes de seguir para novos modulos.

