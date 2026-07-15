# Gate Status - 2026-07-14

## Rodada concluida

- Commit: `03344df6d52ce8f1859b702497a2621e21b361d8`
- F1 Runtime Gate: `29368282977` - PASS
- CI: `29368282978` - PASS
- Agendamento: trigger `enforce_appointment_session_tenant` rejeita escrita cujo `company_id` diverge do tenant da sessao autenticada.
- Fixtures internos: o teste usa `service_role` apenas no setup e restaura `authenticated` antes do fluxo funcional.
- DataSIGH: nenhuma escrita, alteracao ou transmissao.
- VPS: nenhuma alteracao ou deploy executado.

## Pendencias bloqueantes

1. Homologacao real de login e saude na VPS.
2. Reconciliacao somente leitura com DataSIGH, com evidencia de conectividade e comparacao.
3. Execucao documentada de backup, restore e rollback.
4. Evidencia de runtime PostgreSQL/owner/BYPASSRLS e replay na VPS.
5. Auditoria de paridade RLS entre checkout local e remoto.

O produto permanece **NAO APTO PARA PRODUCAO** ate esses gates externos serem comprovados.

## Auditoria owner/BYPASSRLS

- F1 Runtime Gate: `29376855228` - PASS.
- CI: `29376855298` - PASS.
- O replay verifica que proprietarios nao-superusuarios das tabelas protegidas nao possuem `BYPASSRLS`.
- O superusuario `postgres` do ambiente efemero e diferenciado explicitamente; isso nao constitui prova de configuracao da VPS.
- A validacao real do owner/BYPASSRLS na VPS continua pendente.

## Bloqueio runtime VPS identificado por leitura

- SSH: PASS; Nginx root: HTTP 200; `/auth/v1/settings`: HTTP 200; PM2 `prontomedic-auth`: online.
- PostgreSQL local: aceitando conexoes; banco auditado: `prontoclinic`.
- Roles esperados ausentes: `anon`, `authenticated`, `service_role`, `app_owner`.
- RLS desativado nas tabelas auditadas: `billings`, `companies`, `insurance_authorizations`, `insurance_eligibility_checks`, `professionals`, `user_profiles`.
- Tabelas auditadas pertencem ao superusuario `postgres` com `BYPASSRLS`.
- Nenhuma mutacao foi executada na VPS ou no DataSIGH.

**Conclusao:** a VPS esta respondendo, mas o runtime do banco nao corresponde ao baseline validado no GitHub. O gate de producao permanece bloqueado ate replay controlado das migrations e nova auditoria RLS/roles.

## Atualizacao VPS - 2026-07-14

- Role de runtime `app_prontomedic`: criado/configurado como LOGIN, NOSUPERUSER e NOBYPASSRLS.
- Grants minimos: CONNECT no banco `prontoclinic`, USAGE em `public`/ `auth`, SELECT em `auth.users`, `public.user_profiles`, `public.roles` e `public.role_permissions`.
- Conexao efetiva como `app_prontomedic`: PASS.
- Health `/auth/v1/settings`: HTTP 200; frontend: HTTP 200; login smoke: HTTP 200; PM2 reiniciado e online.
- Escopo da mutacao: somente role/grants do PostgreSQL ProntoMedic; nenhum replay de schema/RLS.
- DataSIGH: nenhuma leitura nova neste passo, nenhuma escrita, alteracao ou transmissao.
- Pendencias que permanecem: roles `anon/authenticated/service_role/app_owner`, RLS global, owner/BYPASSRLS real, backup/restore/rollback e reconciliacao somente leitura DataSIGH.

**Conclusao atual:** login/health da VPS foi desbloqueado, mas o produto continua **NAO APTO PARA PRODUCAO** enquanto os gates de isolamento, backup e reconciliacao nao tiverem evidencia executavel.


## Backup e restore descartavel na VPS - 2026-07-14

- Backup customizado do banco `prontoclinic` criado em `/var/backups/prontomedic/prontoclinic-20260714-212732.dump`.
- Tamanho: 117437778 bytes; SHA-256: `95d990339478b77b8b93d0fa3feadc04ac79caf1781024a311ad10b0796f5e88`; modo 600.
- Restore executado em `prontoclinic_restore_check_20260714` com 3.018 entradas de catalogo.
- Contagens restauradas: `auth.users=99`, `user_profiles=99`.
- Banco temporario removido ao final; banco operacional nao recebeu DDL/DML nesta prova.
- DataSIGH: nenhuma conexao, leitura, escrita ou transmissao neste passo.

**Conclusao:** backup e restore descartavel comprovados. Permanecem bloqueados o replay de schema/RLS na base operacional, paridade RLS e reconciliacao somente leitura do DataSIGH.
