# F1 Runtime Gate - Runbook do Operador

## Objetivo

Executar a prova de login, RLS e isolamento entre duas empresas no ambiente de homologacao. Este fluxo nao acessa nem altera o DataSIGH.

## Pre-condicoes

- Ambiente de homologacao isolado e acessivel por HTTPS ou URL interna protegida.
- Usuario A vinculado a uma empresa.
- Usuario B vinculado a outra empresa diferente.
- Cada usuario deve conseguir autenticar no ambiente de homologacao.
- O usuario A precisa possuir pelo menos um paciente controlado para a leitura positiva.

## Secrets do repositorio

Cadastrar em `Settings > Secrets and variables > Actions` os seis Secrets abaixo. Nunca colocar valores no codigo, commit, issue ou log:

| Secret | Conteudo |
|---|---|
| `PRONTOMEDIC_E2E_BASE_URL` | URL base do ambiente de homologacao |
| `PRONTOMEDIC_ANON_KEY` | chave anonima do ambiente |
| `PRONTOMEDIC_TENANT_A_EMAIL` | e-mail do usuario da empresa A |
| `PRONTOMEDIC_TENANT_A_PASSWORD` | senha do usuario da empresa A |
| `PRONTOMEDIC_TENANT_B_EMAIL` | e-mail do usuario da empresa B |
| `PRONTOMEDIC_TENANT_B_PASSWORD` | senha do usuario da empresa B |

## Execucao

1. Abrir o workflow `F1 runtime gate` no GitHub Actions.
2. Selecionar `Run workflow` na branch do PR.
3. Aguardar o job `Tenant isolation integration proof`.
4. Baixar o log do job e registrar o run id em `TEST_EVIDENCE.md`.

## Aceite

O gate somente passa quando todas as verificacoes retornarem `PASS`:

- login dos dois usuarios;
- perfis pertencem a empresas diferentes;
- usuario A le o proprio paciente;
- usuario B nao le nem conta o paciente de A;
- usuario B nao insere paciente com `company_id` de A;
- usuario B nao altera paciente de A;
- o registro de A permanece inalterado;
- usuario B nao envia `company_id` explicito de A.

Qualquer `FAIL`, segredo ausente ou empresa igual bloqueia a release. Nao executar `--apply`, backfill, migration remota ou qualquer escrita no DataSIGH para tentar corrigir o resultado.
