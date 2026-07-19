# Authorized Runtime Runbook

## Objetivo

Executar o replay e os contratos de runtime do MVP somente em PostgreSQL local descartável. Este runbook não autoriza VPS, SSH, DataSIGH, Supabase hospedado ou publicação.

## Primeiro bloqueio

É obrigatório existir um PostgreSQL local descartável com:

1. baseline MVP reproduzida em banco vazio;
2. duas empresas de teste distintas;
3. um usuário autenticado por empresa;
4. um paciente por empresa;
5. credenciais fornecidas somente no ambiente do operador, nunca em arquivo ou log.

Sem isso, qualquer resultado de RLS seria inconclusivo.

## Plano de execução

```powershell
Set-Location 'C:\Users\Meu Computador\Documents\Codex\2026-07-07\pr\prontoclinic-hub'
\scripts\run-authorized-runtime-bundle.ps1
```

O comando acima é plan-only e deve gerar `00-plan.json` e `README.md`.

Para verificar o contrato local sem conectar ao banco:

```powershell
\scripts\plan-local-postgres-contract.ps1
```

O fixture seed está em `supabase/tests/fixtures_local_runtime.sql`. Ele usa apenas UUIDs e nomes sintéticos e deve ser executado pelo operador no banco descartável, como role proprietária, depois do replay.

Depois que o operador criar o banco local descartável e aplicar a baseline:

```powershell
\scripts\run-authorized-runtime-bundle.ps1 `
  -Execute `
  -DatabaseUrl 'postgresql://USER:PASSWORD@127.0.0.1:5432/DB'
```

O alvo é recusado se não for `localhost` ou `127.0.0.1`. Não use a senha em histórico compartilhado ou relatório.

## Evidências obrigatórias

| Arquivo | Conteúdo | Classificação |
|---|---|---|
| `01-environment.json` | versão, banco e role | runtime |
| `02-replay.log` | ordem e falha SQLSTATE | runtime |
| `03-catalog.json` | `pg_proc`, `proacl`, owner e RLS | runtime |
| `04-tenant-isolation.log` | allow same-company / deny cross-company | runtime |
| `05-constraints.log` | FKs, nulos, duplicidades e owners | runtime |
| `06-summary.json` | resultado e códigos de saída | consolidada |

O seed deve produzir uma linha `fixture_variables` contendo `company_a`, `company_b`, `user_a`, `user_b`, `patient_a_id` e `patient_b_id`. Esses valores são os únicos parâmetros permitidos no contrato de isolamento.

## Critérios de aceite

- replay em banco vazio termina sem erro;
- same-company permite apenas o registro da própria empresa;
- cross-company não retorna nem altera registros;
- funções críticas têm assinatura, owner e `proacl` esperados;
- nenhuma role de aplicação possui `BYPASSRLS`;
- constraints tenant-aware não possuem duplicidades ou nulos incompatíveis;
- evidências não contêm senha, token ou PII desnecessária.

## Não executar

- nenhum SQL em DataSIGH;
- nenhum comando SSH/SCP/VPS;
- nenhum `DROP DATABASE` fora do ambiente descartável criado pelo operador;
- nenhum deploy ou push como parte deste runbook.
