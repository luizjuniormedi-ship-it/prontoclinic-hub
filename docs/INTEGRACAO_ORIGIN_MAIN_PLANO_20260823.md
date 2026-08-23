# Integração ProntoMedic com `origin/main`

## Estado auditado

- Base limpa: `origin/main` em `281b24fc262a46890f19f42204cd132e7cdf7bd9`.
- Checkout de referência: `rescue/module-waves-20260728` em `9912c9c76c7caf44d69e6cf5ceefee04d263bd52`.
- Divergência observada: remoto 382 commits à frente; referência local 4 commits à frente.
- A simulação de merge encontrou conflitos de produto em autenticação, Agenda, Recepção, Faturamento, TISS, migrations e pipeline.
- O checkout de referência permaneceu sujo e não foi resetado, rebaseado ou mesclado.
- `origin/main` tem 224 migrations; a referência local tem 144, com 47 migrations comuns de conteúdo diferente e timestamp duplicado no vínculo TISS local.

## Decisão arquitetural

`origin/main` é a base de integração. A branch de referência não será mesclada integralmente. Cada mudança será portada como patch pequeno, revisado e validado no domínio correspondente. Worktree temporário é apenas área de integração e não um segundo produto.

## Evidência do baseline remoto

- `npm run type-check`: aprovado.
- `npm run test -- --run`: 138 arquivos, 1.086 testes aprovados e 1 ignorado.
- O baseline remoto já possui `appointment_id` no contrato financeiro e o gerador TISS canônico via `m16_generate_monthly_batch_secure`.
- A cadeia remota canônica inclui `20260727020300_module16_tiss_scoped_prerequisites.sql`, `20260727020432_module16_tiss_runtime_closure.sql`, `20260812211247_tiss_account_materialization_contract.sql` e `20260813001000_canonical_reception_billing_tiss_handoff.sql`.
- Portanto, não portar `financialService.ts` ou `tissService.ts` inteiros do checkout local: isso reintroduziria divergências e o fluxo mensal legado.
- Patch de dependências aplicado no worktree: `react-router-dom/react-router 6.30.6`, `@remix-run/router 1.23.4` e `nanoid 3.3.18` transitivo.
- Após `npm ci --ignore-scripts`: type-check aprovado, 1.086 testes aprovados/1 ignorado e build aprovado.

## Ondas obrigatórias

1. Autenticação, permissões e configuração.
2. Agenda e contrato único de `appointment_id`.
3. Recepção, check-in, pré-conta e autorização de convênio.
4. Faturamento e conta canônica.
5. TISS e materialização de guia/XML.
6. CI, migrations, replay, backup/restore/rollback e homologação remota.

Cada onda deve ter revisão independente, type-check, testes focados, suíte completa e evidência antes da próxima.

## Itens deliberadamente não portados

- `artifacts/`, arquivos `.tar.gz`, `scripts/__pycache__/` e dumps temporários.
- `state.json` da raiz enquanto houver duplicidade com `docs/ai-execution/state.json`.
- Scripts de VPS/DICOM, backup, rollback e replay no patch funcional.
- `deploy-vercel.yml` sem decisão explícita de pipeline.
- Migrations antigas ou candidatas históricas de Recepção/TISS sem validação de ordem e hash.
- `20260711160100_tiss_appointment_link.sql` e `20260820234643_appointment_series_insurance_contract.sql` não serão copiados diretamente; a primeira é obsoleta no baseline remoto e a segunda precisa ser reescrita contra o schema remoto antes de qualquer proposta.

## Gates ainda bloqueados

- Validadores de migration/RPC/RLS e manifesto do checkout local ainda não existem em `origin/main`.
- TISS externo (endpoint, XSD, certificado e credenciais) não está homologado.
- Replay remoto, backup/restore/rollback e homologação VPS não foram executados.
- DataSIGH permanece somente leitura e intocado.
- Permanece uma vulnerabilidade baixa de `esbuild` transitivo do Vite e duas moderadas ligadas ao Router 6; Router 7 e Vite 8 exigem ondas separadas por risco de breaking change.

## Critério de avanço

Nenhum merge amplo, deploy ou publicação será feito enquanto a onda correspondente não tiver patch mínimo, revisão, suíte completa e evidência. O próximo patch permitido é somente o de autenticação/configuração; depois Agenda, Recepção, Faturamento e TISS, nessa ordem.
