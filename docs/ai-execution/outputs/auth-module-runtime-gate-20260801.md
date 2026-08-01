# Módulo 1 - gate de runtime de autenticação (2026-08-01)

## Evidência atual

- Branch canônico: `codex/profile-e2e-closure-20260801`.
- Commit remoto auditado: `9674ccd7eb5ed3c893e26e4550c3d297c8592200`.
- PR 24: aberto, mesclável, draft e não integrado em `main`.
- CI `30709477648`: concluído com sucesso.
- Integration Guard `30709477651`: concluído com sucesso.
- Navegação pública de `/functions/v1/auth-admin`: a SPA respondeu 404 e registrou rota inexistente.
- SSH administrativo read-only: bloqueado por autenticação nesta sessão.
- DataSIGH: não acessado e não alterado.

## Diagnóstico

O código de `auth-admin`, o CORS e o pipeline de publicação estão validados no
branch, mas a função não participa do runtime público atual da VPS. Convite,
reset administrativo, suspensão/reativação e logout global não podem ser
homologados até o PR ser revisado e integrado em `main`, porque o workflow de
produção rejeita deliberadamente commits que não sejam ancestrais de `main`.

## Correção adicional desta rodada

O instalador atômico passou a instalar o trap antes de criar/extrair a release.
Em qualquer falha anterior ou posterior à troca do symlink, ele restaura o
runtime anterior quando necessário e remove a release incompleta. Isso permite
repetir com segurança o mesmo SHA após falha de preparação.

## Próximo gate

1. Revisar e integrar o PR 24 sem bypass dos checks.
2. Confirmar, somente leitura, as cinco RPCs administrativas e seus grants.
3. Confirmar que o snippet Nginx de `/functions/v1/*` está carregado.
4. Executar o workflow manual com o SHA integrado em `main`.
5. Homologar CORS, 401 anônimo e uma jornada QA administrativa com MFA AAL2.
6. Manter produção bloqueada até convite, recuperação, suspensão/reativação e
   revogação global passarem no runtime publicado.
