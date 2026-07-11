# ProntoMedic - Auditoria Inicial

Data: 2026-07-10
Classificacao atual: **NAO APTO PARA USO**

## Arquitetura encontrada

- Frontend React 18, TypeScript, Vite 7, React Query e Supabase JS.
- Backend de autenticacao Node.js customizado (`local-auth-server.mjs`) sob PM2.
- PostgreSQL 18 como banco novo; DataSIGH/MySQL e exclusivamente fonte legada somente leitura.
- Nginx publica o frontend e encaminha API na VPS Debian 12.
- Deploy atual por scripts PowerShell/Bash com backup, migration transacional e troca atomica de release.

## Inventario funcional

Foram encontradas mais de 50 rotas, cobrindo pacientes, profissionais, agenda, call center,
recepcao, prontuario, atendimento, DICOM/PACS, faturamento, TISS, financeiro, laboratorio,
farmacia, enfermagem, internacao, cirurgia, PA, compras, transporte, BI, LGPD e administracao.

Presenca de rota ou componente nao equivale a modulo concluido. Cada modulo permanece sujeito
a validacao de banco, autorizacao, regras, integracao e E2E.

## Evidencias executadas

- Build anterior do commit `1728e42`: aprovado.
- Suite atual: 445 testes aprovados em 32 arquivos.
- Testes de seguranca do backend e TISS adicionados: 8 aprovados.
- ESLint atual: 0 erros e 430 avisos.
- Type-check atual: bloqueado pelo sandbox (`EPERM` antes de iniciar o TypeScript).
- Deploy da fundacao Convenios/TISS: primeira tentativa revertida por papel PostgreSQL ausente;
  correcao criada no commit `fd16cd9`.

## Problemas prioritarios

### P0 - Bloqueadores

- Release atual da VPS ainda nao possui evidencia final do deploy corrigido e de todos os healthchecks.
- Migracao TISS nao esta reconciliada por chave com o DataSIGH; contagem simples nao prova integridade.
- Nao existe evidencia completa de segregacao multiempresa em todos os acessos e mutacoes.
- CI permitia migrations quebradas e deploys automaticos concorrentes fora da VPS.

### P1 - Criticos

- Autenticacao customizada e camada PostgREST exigem auditoria de autorizacao servidor a servidor.
- Modulos operacionais numerosos nao possuem E2E real com banco de teste para todas as jornadas.
- Regras importantes ainda aparecem em services/frontend sem prova de enforcement transacional no servidor.
- Ausencia de pipeline CI/CD obrigatorio antes do deploy.
- Observabilidade, alertas e recuperacao de desastre nao estao comprovados por teste.

### P2 - Altos

- 430 avisos de lint, incluindo `any` e dependencias ausentes em hooks.
- Documentacao operacional e regulatoria exigida esta majoritariamente ausente.
- Cobertura total e teste de migrations em banco limpo/com dados nao foram comprovados nesta rodada.
- Dependencia com vulnerabilidade baixa reportada pelo npm exige triagem, sem `npm audit fix` automatico.

### P3 - Medios/Baixos

- Avisos de chunk por imports estaticos e dinamicos simultaneos.
- Padronizacao incremental de tipos, componentes e mensagens.

## Decisoes preservadas

- Migracao incremental; nenhuma reescrita integral.
- DataSIGH estritamente somente leitura.
- PostgreSQL como fonte oficial do ProntoMedic.
- Deploy com backup, migration transacional e publicacao atomica.
- Credenciais fora do Git e nunca impressas em relatorios.

## Correcoes iniciadas nesta rodada

- RPC alterada para deny-by-default.
- Escopo `company_id` derivado do perfil aplicado em HEAD, GET, contagem, POST e PATCH.
- Rotacao de refresh token passou a revogar o token anterior em transacao.
- Logout passou a revogar sessoes do usuario.
- Corpo HTTP limitado a 1 MB.
- Deploys legados Vercel/Pages alterados para acionamento manual.
- CI alterado para PostgreSQL 18 e migrations com `ON_ERROR_STOP` em transacao.

Essas correcoes ainda exigem teste de integracao com duas empresas e deploy controlado antes de
reduzir a classificacao dos respectivos riscos.

## Sequencia de conclusao

1. Infraestrutura, deploy, CI/CD, backup e rollback.
2. Banco, migrations e reconciliacao por chave.
3. Autenticacao, RBAC e segregacao multiempresa/unidade.
4. Cadastros estruturantes.
5. Agenda/call center e recepcao.
6. Convenios, elegibilidade, autorizacoes e guias.
7. Prontuario, atendimento e laudos.
8. Faturamento, TISS, financeiro e repasses.
9. Demais modulos conforme dependencia e uso real.
10. Auditoria independente, homologacao e release.

## Criterio de prontidao

Nenhum modulo sera marcado como validado sem frontend, backend, banco, permissao, auditoria,
tratamento de falha e E2E real aprovados. Nenhum P0 ou P1 pode permanecer para producao.
