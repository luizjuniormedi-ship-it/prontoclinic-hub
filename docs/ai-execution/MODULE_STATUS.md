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
