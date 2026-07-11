# Decisoes Tecnicas

## 2026-07-10 - VPS oficial

O deploy oficial sera controlado pela VPS. Vercel/Pages nao devem publicar automaticamente em `main` enquanto houver mais de um ambiente concorrente.

## 2026-07-10 - DataSIGH somente leitura

O DataSIGH e fonte de consulta para migracao e reconciliacao. Nenhum script pode executar INSERT, UPDATE, DELETE, DDL ou procedimento de escrita nessa fonte.

## 2026-07-10 - Fail closed

Falhas de migracao, type-check, build, testes, healthcheck ou verificacao de segredo bloqueiam a publicacao. Warnings nao sao tratados como sucesso funcional.

## 2026-07-10 - Isolamento no backend

O backend customizado e uma fronteira de seguranca. O `company_id` deve ser derivado do perfil autenticado e nunca aceito como autoridade vinda do cliente.

## 2026-07-10 - PostgreSQL 18

O ambiente de producao deve usar PostgreSQL 18 em sistema operacional suportado ou container controlado. Ubuntu 20.04 foi rejeitado pelo instalador e Debian 12 passou a ser a base observada.
