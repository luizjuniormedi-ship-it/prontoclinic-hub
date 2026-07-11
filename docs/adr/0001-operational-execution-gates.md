# ADR 0001 - Gates de Execucao Operacional

## Contexto

O sistema foi migrado de uma fonte legada e publicado em uma VPS com backend de autenticacao customizado. Houve falhas de login, carregamento de modulos, migracoes e scripts PowerShell/SSH.

## Decisao

Toda etapa operacional sera registrada em `docs/ai-execution/`. A publicacao so pode ser considerada concluida quando build, testes, migracoes, healthcheck, autenticacao e rollback tiverem evidencias reproduziveis. A fonte DataSIGH permanece somente leitura.

## Consequencias

- O processo fica mais lento, mas falhas silenciosas deixam de ser aceitas.
- O estado pode ser retomado por outra sessao sem depender do historico do chat.
- Credenciais permanecem fora do repositorio.
