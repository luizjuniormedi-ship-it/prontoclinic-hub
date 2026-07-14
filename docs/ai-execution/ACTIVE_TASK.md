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

## Runner executavel

Use `npm run test:tenant-isolation` com dois usuarios ja existentes em empresas diferentes:

```powershell
$env:E2E_BASE_URL = "http://127.0.0.1:8000"
$env:TENANT_A_EMAIL = "..."
$env:TENANT_A_PASSWORD = "..."
$env:TENANT_B_EMAIL = "..."
$env:TENANT_B_PASSWORD = "..."
npm run test:tenant-isolation
```

O runner usa somente o PostgreSQL do ProntoMedic, nao acessa o DataSIGH e nao cria dados persistentes.
