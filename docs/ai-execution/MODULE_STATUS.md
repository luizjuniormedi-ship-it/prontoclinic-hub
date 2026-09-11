# Status dos Modulos

## Evidencia local da base administrativa - 2026-09-09

Esta rodada nao homologa a VPS. Evidencias antigas de deploy nao comprovam o SHA atual.

| Requisito | Implementacao existente | Evidencia desta rodada | Gate restante |
|---|---|---|---|
| Empresas e unidades | CompaniesPage / catalogCompaniesUnitsService | 4 testes de servico aprovados | CRUD e isolamento autenticados em QA |
| Usuarios administrativos | AdminUsersPage / authAdminService / auth-admin | 2 testes UI, 9 de servico e 3 de contrato aprovados | Convite, recuperacao, suspensao, reativacao e logout com MFA AAL2 |
| Permissao de rotas | ProtectedRoute / configuracao administrativa | 10 testes de permissoes aprovados | Negativas no backend entre empresas e unidades |
| Resposta administrativa valida | authAdminService | Respostas sem ok=true e convites sem userId rejeitados | Smoke autenticado contra a funcao publicada |

Rodada ampliada: 41 testes locais aprovados em 7 arquivos, incluindo MFA/sessao e recuperacao da UI apos falha administrativa. A tela administrativa agora tem 4 testes. Testes com mocks e inspecao de contrato nao substituem replay PostgreSQL nem jornada real.
Proxima etapa: comprovar autorizacao no backend e ambiente QA isolado antes de liberar a base administrativa.
Nenhuma dependencia externa incorporada, deploy executado ou acesso ao DataSIGH realizado.

| Modulo | Estado | Bloqueio principal |
|---|---|---|
| Autenticacao | Runtime publicado | Falta homologacao mutativa remota com tenant QA descartavel e MFA AAL2 |
| Autorizacao/RBAC | CI e replay aprovados | Falta prova autenticada negativa entre empresas na VPS com identidades QA isoladas |
| Convenios | Parcial | Regras e contratos precisam homologacao funcional |
| TISS | Bloqueado | Dry-run DataSIGH e protocolos/glosas reais |
| Agendamento | Parcial | Validacao de elegibilidade/autorizacao ponta a ponta |
| Recepcao | Parcial | Check-in, guias e permissao por perfil |
| Atendimento | Parcial | Fluxo assistencial e datas sem regressao |
| Faturamento | Parcial | Validacao de guia, autorizacao e risco de glosa |
| Prontuario | Bloqueado | Carregamento infinito reportado anteriormente |
| Financeiro | Bloqueado | Carregamento infinito reportado anteriormente |
| Cadastros mestres | Bloqueado | Contagens zeradas reportadas anteriormente |

Nenhum modulo marcado como parcial ou bloqueado deve ser apresentado como 100% funcional.

## Gate HTTP multiempresa - 2026-09-10

As referencias a runtime publicado acima sao historicas, nao uma verificacao da VPS nesta rodada.

- Backend existente: HEAD reutiliza o parser de filtros, autorizacao e identidade RLS de GET. Erros de contagem deixam de retornar sucesso com zero.
- Harness existente: fixture da segunda empresa sintetica, login administrativo com MFA e matriz HTTP GET/HEAD/COUNT/POST/PATCH nas duas direcoes, com controles positivos e readback pelo proprietario.
- CI existente: etapa dedicada ao teste `e2e/company-http-isolation.spec.ts` no banco descartavel.
- Verificacao local: 1141 testes unitarios aprovados em 143 arquivos; type-check normal e estrito, build e lint sem erros aprovados.
- Bloqueio de infraestrutura resolvido: PostgreSQL 16 descartavel no Docker em loopback:54322, banco migrations_second com baseline completo e backend existente em 18000.
- Primeira execucao detectou contexto B sem unidade. O teste agora seleciona explicitamente a unidade de cada empresa pela UI, sem mudar permissoes do produto.
- Matriz E2E integral aprovada duas vezes nesta rodada apos restauracao da fixture: 50.3s e 49.0s. GET/HEAD/COUNT/POST/PATCH com controles positivos, contagem paginada e readback A/B, login e MFA reais locais.
- Evidencia: playwright-artifacts/results-company-http-isolation-local.json, playwright-artifacts/junit-company-http-isolation-local.xml e playwright-report-company-http-isolation-local/index.html. Execucao sobre checkout com alteracoes locais, nao SHA publicado.
- Revisao independente do PR continua pendente. As alteracoes desta rodada nao foram publicadas e precisam de novo CI para o SHA que as integrar.
- Nenhum acesso DataSIGH, deploy, XML real ou criacao de identidade real.

O gate HTTP de pacientes entre as duas empresas sinteticas esta APROVADO LOCALMENTE em PostgreSQL 16. Nao equivale a homologacao de todas as tabelas ou da VPS; essas validacoes continuam pendentes.
