# Tarefa Ativa

## Identificacao

- Fase: `security-hardening`
- Modulo: Autenticacao, autorizacao e isolamento multiempresa
- Prioridade: P0
- Estado: `in_progress`

## Objetivo

Demonstrar, com evidencia executavel, que um usuario autenticado de uma empresa nao consegue ler, contar, criar ou alterar dados pertencentes a outra empresa.

## Escopo

- Rotas REST proxied pelo `local-auth-server.mjs`.
- Tabelas com `company_id`.
- RPCs explicitamente permitidos.
- Login, refresh e logout.
- Healthcheck local e pos-deploy.

## Fora de escopo nesta tarefa

- Escrita no DataSIGH.
- Migracao destrutiva de dados produtivos.
- Liberacao para usuario final.

## Criterio de conclusao

Testes de sucesso e de negacao passam contra PostgreSQL real, sem bypass administrativo nao documentado, e a evidencia e registrada em `TEST_EVIDENCE.md`.
