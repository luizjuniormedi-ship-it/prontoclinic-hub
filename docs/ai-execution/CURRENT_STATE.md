# Estado Atual de Execucao

Atualizado em 2026-07-10.

## Fato tecnico

- Repositorio local: `C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub`.
- Ultimo commit local conhecido: `5435d60`.
- Release funcional conhecida na VPS: `37199ee`.
- A VPS executou build, migracoes e reload do Nginx na fase 1; a mensagem final de falha do wrapper foi causada por CRLF residual no shell remoto, nao por falha da publicacao.
- PostgreSQL e backend precisam de nova verificacao operacional apos a ultima publicacao.
- A verificacao somente leitura de 2026-07-13 confirmou PostgreSQL, backend PM2, Nginx e frontend ativos; login e isolamento entre tenants ainda nao foram provados.
- O healthcheck local confirmou PostgreSQL, mas nao confirmou auth: o processo Node encerrou com `EPERM` do sandbox antes de escutar a porta 8000.

## Hipotese

O fluxo principal pode estar disponivel, mas ainda nao existe prova suficiente de isolamento entre duas empresas, nem prova ponta a ponta do TISS com fonte DataSIGH.

## Risco

O sistema nao esta apto para producao enquanto os testes P0 abaixo nao forem executados contra uma instancia real e a cadeia de deploy nao produzir evidencia reproduzivel.

## Fase atual

`security-hardening`

## Proxima tarefa executavel

Executar healthcheck pos-deploy, validar autenticacao/RBAC e criar evidencia negativa de isolamento por `company_id`.
