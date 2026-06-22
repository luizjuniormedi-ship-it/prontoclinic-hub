# Migração SIGH → ProntoClinic Hub

## Visão geral

Este documento descreve a migração completa do banco de dados SIGH (MySQL 5.1
legado) para o ProntoClinic Hub (Supabase / PostgreSQL 16).

| Métrica | Valor |
|---|---|
| Pacientes | 50.593 |
| Profissionais (medicor) | 144 |
| Serviços | 4.953 |
| Convênios | 992 (top 30 por padrão, opção de todos) |
| Planos | 395 |
| Fontes pagadoras | 53 |
| Agendamentos (futuros) | ~120.000 de 448.676 totais |
| Prontuários | 1.524 |
| Laudos | 7.733 |
| Logs de acesso | 19.741 (apenas críticos) |
| Usuários | 108 |
| Grupos RBAC | 14 |
| Categorias CBHPM | 10 (oficiais) |
| Credenciamentos (full) | 48.173 |
| Regras de preço (full) | 3.673 |
| Procedimentos SIGTAP (full) | 4.838 |

- **Duração estimada:** 4-8 horas (padrão), 8-16 horas (full)
- **Downtime:** ZERO — SIGH continua em produção durante toda a migração
- **Janela de cutover:** 30-60 min para redirecionar DNS / ajustar integrações

## Pré-requisitos

1. **Supabase configurado**
   - Projeto criado (Postgres 16)
   - Migrations aplicadas em ordem:
     - `20260101000001_payment_sources.sql`
     - `20260101000002_insurance_companies.sql`
     - `20260101000003_insurance_plans.sql`
     - `20260101000004_professional_insurances.sql`
     - `20260101000005_price_tables.sql`
     - `20260101000006_password_resets.sql`

2. **.env configurado**
   ```env
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

3. **Python deps**
   ```bash
   pip install pymysql supabase python-dotenv
   ```

4. **Helper `db_datasigh.py`** no mesmo nível do `scripts/` ou no PYTHONPATH

5. **Backup do SIGH** (mysqldump completo, mesmo sendo read-only)

6. **Consentimento LGPD assinado pela clínica** — registrar data de assinatura

## Ordem de execução

A ordem abaixo respeita as foreign keys e dependências lógicas.

| # | Entidade | Qtd | Duração | Observação |
|---|---|---|---|---|
| 1 | `companies` | 1 | <1s | Cria empresa "Migrado SIGH" |
| 2 | `payment_sources` | 53 | ~5s | Fonte pagadora (SUS, PARTICULAR, CONVENIO) |
| 3 | `insurance_companies` | 30 (top) | ~10s | Por padrão só top 30. Use `--all-insurance` para 992 |
| 4 | `insurance_plans` | 395 | ~15s | Vinculado a `insurance_companies` |
| 5 | `users` (auth) | 108 | ~2min | Senhas plain-text NUNCA migradas — gera token |
| 6 | `user_profiles` | 108 | ~30s | RBAC mapeado via `_map_role()` |
| 7 | `professionals` | 144 | ~30s | medicor → profissionais (com cpf_hash) |
| 8 | `services_catalog` | 4.953 | ~5min | servicos → services_catalog |
| 9 | `patients` | 50.593 | ~30min | Com anonimização LGPD |
| 10 | `appointments` | ~120k | ~60min | Apenas futuros (DT_AGENDA >= hoje) |
| 11 | `medical_records` | 1.524 | ~2min | Prontuários |
| 12 | `audit_logs` | 19.741 | ~10min | Apenas LG_INSERIDO_API = 1 |

### Comando padrão
```bash
python scripts/migrate_sigh.py --full --consent-date=22/06/2026
```

### Dry-run (somente simulação)
```bash
python scripts/migrate_sigh.py --entity=patients --dry-run --limit=100
```

### Migração de um único módulo
```bash
python scripts/migrate_sigh.py --entity=insurance_companies --all-insurance
```

### Migração completa (full) — todos os 992 convênios + credenciamentos + SIGTAP
```bash
python scripts/seed_sigh_full.py --batch-size=200
```

## Checkpoint / Resume

Cada execução grava `.migration_state.json` em `scripts/`. Em caso de
interrupção (rede, erro, Ctrl-C), basta reexecutar o mesmo comando — o script
pula módulos finalizados e retoma o módulo em andamento a partir do último
`offset` salvo.

```json
{
  "patients": {
    "last_offset": 32100,
    "finished_at": "2026-06-22T15:43:21"
  },
  "appointments": {
    "last_offset": 0,
    "finished_at": null
  }
}
```

Para forçar re-execução, apague o arquivo:
```bash
rm scripts/.migration_state.json
```

## Idempotência

Cada tabela tem `cd_origem_sigh` (quando aplicável) com constraint UNIQUE
junto com `company_id`. A migração usa `upsert(..., on_conflict=...)` no
Supabase — rodar 2x produz o mesmo resultado.

## LGPD

### Anonimização automática

Pacientes com `DT_OBITO != 0` ou `LG_ANONIMIZADO = 1` no SIGH são
automaticamente anonimizados durante a migração:

| Campo | Valor pós-anonimização |
|---|---|
| `nome` | `"PACIENTE ANONIMIZADO"` |
| `cpf` | `NULL` |
| `cpf_hash` | `NULL` |
| `rg` | `NULL` |
| `endereco`, `bairro`, `cidade`, `uf`, `cep` | `NULL` |
| `telefone1`, `telefone2`, `email` | `NULL` |
| `nome_mae`, `nome_pai` | `NULL` |
| `observacao` | `NULL` |
| `lg_anonimizado` | `TRUE` |

Apenas a data de óbito é preservada (mascarada para log), para fins de
auditoria clínica.

### Senhas

Senhas do SIGH são **plain-text** e **nunca** são migradas. Cada usuário
recebe um token de primeiro acesso (TTL 72h) gerado via
`public.create_password_reset(user_id, p_ttl_hours := 72)`. Os tokens ficam em
`logs/password_resets_<timestamp>.csv` para envio em massa via
e-mail marketing.

### Direito ao esquecimento

Para remover um paciente específico após a migração, basta:
```sql
UPDATE public.patients
SET name = 'PACIENTE ANONIMIZADO',
    cpf = NULL, cpf_hash = NULL, rg = NULL,
    email = NULL, phone1 = NULL, phone2 = NULL,
    address = NULL, neighborhood = NULL, city = NULL,
    state = NULL, zip_code = NULL, mother_name = NULL,
    father_name = NULL, notes = NULL,
    lg_anonimizado = TRUE
WHERE id = 'uuid-do-paciente';
```

Recomendação: criar uma função SQL `public.forget_patient(p_id)` e expô-la via
RPC para uso do DPO.

### Log de consentimento

Toda leitura de dados sensíveis (CPF, prontuário, etc) deve ser precedida
de registro de consentimento. A data é gravada em `companies._migration_consent_date`
e em cada `user.user_metadata.consent_date` no `auth`.

## Validação

Após a migração, rode a validação automática:
```bash
python scripts/migrate_sigh.py --entity=patients --batch-size=1 --limit=1
# (a função validate_totals() roda no final do main)
```

### Queries SQL de validação (rodar no Supabase SQL Editor)

```sql
-- 1. Total de pacientes (deve ser ≈ 50.593, com anonimizados)
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE lg_anonimizado) AS anonimizados,
       COUNT(*) FILTER (WHERE cpf_hash IS NOT NULL) AS com_cpf
FROM public.patients;

-- 2. Pacientes duplicados (deve ser 0)
SELECT cpf_hash, COUNT(*)
FROM public.patients
WHERE cpf_hash IS NOT NULL
GROUP BY cpf_hash HAVING COUNT(*) > 1;

-- 3. Agendamentos sem patient_id (devem ser 0 — aponta falha de FK)
SELECT COUNT(*) FROM public.appointments WHERE patient_id IS NULL;

-- 4. Profissionais sem user_profile associado (esperado: 0 ou alguns)
SELECT p.id, p.name, p.crm
FROM public.professionals p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE p.user_id IS NOT NULL AND u.id IS NULL;

-- 5. Convênios ativos vs total
SELECT lg_ativo, COUNT(*) FROM public.insurance_companies GROUP BY lg_ativo;

-- 6. Tokens de reset gerados
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE used) AS usados,
       COUNT(*) FILTER (WHERE dt_exp < NOW()) AS expirados
FROM public.password_resets;

-- 7. Senhas plain-text no Supabase? (deve ser 0)
SELECT COUNT(*) FROM public.user_profiles
WHERE password_plaintext IS NOT NULL;  -- coluna não deve existir

-- 8. Logs de auditoria sensíveis (LGPD: confirmar que existem)
SELECT action_type, COUNT(*)
FROM public.audit_logs
WHERE source = 'SIGH_migration'
GROUP BY action_type;

-- 9. Total de agendamentos futuros (deve bater com a contagem do SIGH)
SELECT DATE(appointment_date) AS dia, COUNT(*)
FROM public.appointments
WHERE appointment_date >= CURRENT_DATE
GROUP BY dia ORDER BY dia;

-- 10. Sanity: company migrada
SELECT id, name, _migration_source, _migration_consent_date
FROM public.companies WHERE _migration_source = 'SIGH';
```

### Queries de validação no SIGH (para comparação)

```sql
-- Total de pacientes ativos
SELECT COUNT(*) FROM pacientes WHERE LG_ATIVO = 1;

-- Total de pacientes com óbito
SELECT COUNT(*) FROM pacientes WHERE DT_OBITO <> 0;

-- Agendamentos futuros
SELECT COUNT(*) FROM agenda WHERE DT_AGENDA >= 20260622;

-- Total de profissionais
SELECT COUNT(*) FROM medicor WHERE LG_ATIVO = 1;

-- Total de convênios ativos
SELECT COUNT(*) FROM convenios WHERE LG_ATIVO = 1;

-- Total de usuários
SELECT COUNT(*) FROM usuarios WHERE LG_ATIVO = 1;
```

## Rollback

1. **SIGH** — nunca é modificado. Continua 100% disponível.
2. **Supabase** — pode ser resetado a qualquer momento:
   ```bash
   # Apaga todos os dados (em ordem reversa de FK)
   psql $SUPABASE_DB_URL -c "
     TRUNCATE audit_logs, password_resets, appointments,
              medical_records, patients, professionals, services_catalog,
              user_profiles, insurance_plans, insurance_companies,
              payment_sources, companies
     RESTART IDENTITY CASCADE;
   "
   ```
3. **Após cutover**, manter SIGH em modo **read-only** por 6 meses para
   auditoria e eventual re-migração.

## Pós-migração

1. **Enviar tokens de primeiro acesso** aos 108 usuários via e-mail marketing.
2. **Treinamento da equipe** no novo sistema (mínimo 2h).
3. **Piloto de 30 dias** com SIGH em paralelo (somente leitura no SIGH).
4. **Cutover final** — desativar SIGH após 30 dias sem divergências.
5. **Backup do Supabase** habilitado (PITR + daily snapshots).
6. **Job de esqueecimento** — implementar cron SQL chamando
   `public.forget_patient()` para DPOs.

## Checklist operacional

- [ ] Consentimento LGPD assinado
- [ ] Backup do SIGH realizado
- [ ] Migrations Supabase aplicadas
- [ ] .env configurado
- [ ] Dry-run executado com `--limit=100` por módulo
- [ ] Migração completa executada
- [ ] Validação SQL rodou com 0 divergências críticas
- [ ] Tokens de reset enviados aos usuários
- [ ] Equipe treinada
- [ ] Piloto 30 dias iniciado
- [ ] SIGH marcado como read-only
- [ ] Cutover final aprovado
- [ ] Job de esqueecimento agendado
