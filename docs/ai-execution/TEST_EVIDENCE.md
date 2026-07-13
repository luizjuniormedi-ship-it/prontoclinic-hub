# Evidencias de Teste

## Ultima evidencia local registrada

- Testes: 32 arquivos, 447 testes aprovados.
- Build: aprovado pelo `tsc -b` e `vite build`.
- Lint: 0 erros e 430 warnings.
- Sintaxe do backend: `node --check local-auth-server.mjs` aprovado.
- Testes de invariantes de seguranca: 5 aprovados.
- Healthcheck local: PostgreSQL respondeu; auth em `127.0.0.1:8000` indisponivel. A execucao direta do Node retornou `EPERM` no caminho Windows com espaco dentro deste sandbox.

## Evidencia da rodada atual

- Guard de isolamento do proxy: 4 testes aprovados (`npm run test:security`).
- Suíte unitária: 32 arquivos, 476 testes aprovados (`npm run test`).
- Cobertura: 32 arquivos, 476 testes aprovados; todos os thresholds por serviço atendidos (`npm run test:unit:coverage`).
- Cobertura dirigida adicionada para pacientes, tabelas de preço, convênios, LGPD, e-mail e DICOM.
- Type-check: aprovado (`npm run type-check`).
- Build: aprovado (`npm run build`); permanecem apenas avisos de chunk dinâmico já existentes.
- Lint: concluído sem erros; 485 warnings históricos permanecem registrados.
- Commit desta rodada: `4c526c8` na branch `codex/tenant-scope-hardening-d551c8e`.
- Correção aplicada: `PATCH` não pode alterar `company_id`; inserções continuam derivando o tenant do perfil autenticado.
- Correção do CI: a etapa de migração agora usa diretamente `DATABASE_URL`, incluindo a porta publicada `54322` do serviço PostgreSQL; antes, o comando ignorava essa variável e tentava conectar em `localhost:5432`.

## Evidencia VPS somente leitura

- Data da verificação: 2026-07-13.
- PostgreSQL escutando em `127.0.0.1:5432`.
- Backend `prontomedic-auth` online no PM2 e escutando em `0.0.0.0:8000`.
- `GET /auth/v1/settings`: HTTP 200.
- Frontend via Nginx: HTTP 200.
- `nginx -t`: sintaxe válida.

Essa evidencia confirma disponibilidade da infraestrutura, mas nao substitui login real, teste negativo entre dois tenants ou rollback reproduzivel.

- Runner P0 adicionado em `scripts/tenant-isolation-integration.mjs`; execucao contra dois usuarios reais ainda pendente de credenciais autorizadas para tenants distintos.

## Evidencia VPS registrada pelo usuario

- SSH funcional com a chave de reset.
- Release `37199ee` criada.
- Build concluido.
- Migracoes executadas.
- Contagens observadas: 992 convenios, 395 planos, 313 XML TISS, 6 protocolos, 3 glosas.
- Nginx validado e recarregado.
- Wrapper apresentou erro posterior de CRLF; o shell de deploy foi corrigido localmente.

## Evidencia ausente

- Healthcheck final do backend apos a ultima publicacao.
- Login real com perfil operacional.
- Teste negativo de isolamento entre empresas.
- Dry-run real de reconciliacao DataSIGH.
- CI verde no commit mais recente (a execução ainda não foi associada pelo GitHub ao SHA `4c526c8`).
- O replay do CI confirmou a correção da porta, da ordem das tabelas e das roles, e encontrou `auth.uid()` ausente no PostgreSQL limpo. A compatibilidade agora cria a função inerte apenas quando ela não existe, preservando a implementação Supabase; novo CI ainda pendente.
- O replay seguinte chegou ao módulo de agendamento e encontrou `professional_schedules` referenciada sem migration de criação; foi adicionada uma fundação idempotente para as janelas de disponibilidade.
- O replay seguinte chegou à recepção e encontrou as tabelas operacionais de autorização/elegibilidade ausentes; foi adicionada a fundação idempotente que alimenta o registro central de convênios.
- O replay seguinte chegou ao ledger oficial de Convênios e identificou `quantity_used` ausente no registro operacional; a coluna foi adicionada para controlar autorizado versus utilizado.
