# RUNBOOK — Intervenção Manual no Dashboard Supabase

**Projeto:** POLICLINICA MEDILIFE (`rhqgwrarkotjzdcrkbgn`)
**Data:** 2026-06-24
**Status:** BANCO OFFLINE — Hot Standby OFF, disco Free (500MB) esgotado
**Bloqueio técnico:** Não há ação possível via API / CLI / conexão direta
**Última checagem automática:** 14:18:31 (10/10 tentativas HTTP 503)

---

## 1. Diagnóstico já confirmado

Verificações automatizadas que rodei (todas com falha idêntica):

| Verificação | Resultado |
|---|---|
| `GET /rest/v1/units?select=count` | HTTP **503** / `PGRST002` |
| `TCP db.rhqgwrarkotjzdcrkbgn.supabase.co:5432` | Conexão aceita |
| `psql -U postgres` (autenticação) | `57P03 - Hot standby` |
| Polling 10 min (60s entre tentativas) | **10/10 × HTTP 503** |
| Disco do projeto | **500MB Free esgotados** |

**Conclusão técnica:** O Postgres entrou em modo de proteção porque o disco Free (500MB) ficou cheio. O Supabase **não recupera sozinho** — é preciso ação manual via Dashboard.

---

## 2. PASSO-A-PASSO PARA O USUÁRIO (15 min)

### PASSO 1 — Abrir o Dashboard do projeto

1. Abra no navegador:
   `https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn`
2. Faça login se necessário.

---

### PASSO 2 — Tentar Restart Project (caminho mais rápido)

1. No menu lateral, vá em **Settings** (ícone de engrenagem).
2. Clique em **General**.
3. Role até o final da página até ver o card **"Restart project"** (vermelho).
4. Clique em **Restart project** → confirme.

> **Aguarde 2–3 minutos.** O projeto reinicia e libera conexões bloqueadas.
> Os dados são preservados. Só o serviço é reiniciado.

Após o reinício, valide:

```bash
curl -s "https://rhqgwrarkotjzdcrkbgn.supabase.co/rest/v1/units?select=count" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjMwMTIwOSwiZXhwIjoyMDk3ODc3MjA5fQ.3WhaTnlwP_4tKFhM57O7japgwvP_03v2C7zlQaWDfW8"
```

Esperado: `HTTP/1.1 200 OK` com `[{"count":0}]` ou similar.

- **Se retornou 200:** siga para o PASSO 4.
- **Se continuou 503:** siga para o PASSO 3.

---

### PASSO 3 — Liberar espaço via SQL Editor (se Restart não bastou)

O Restart pode falhar se o disco realmente está cheio. Nesse caso, precisamos apagar dados:

1. No menu lateral, vá em **SQL Editor** (ícone de banco de dados).
2. Clique em **New query**.
3. Abra o arquivo `scripts/migrate_resume_via_sql_editor.sql` (gerado por mim).
4. **Cole apenas o BLOCO 1** (Diagnóstico) e clique em **Run**.

Isso vai mostrar:

- Tamanho do banco (deve estar perto de 500MB)
- Contagens atuais
- Top 15 tabelas por tamanho

5. **Cole o BLOCO 2** (soft-delete de appointments antigos) e clique em **Run**.

> Esse comando marca como `lg_ativo = false` todos os appointments
> com data anterior a 2024-01-01. Não apaga dados, só desativa.
> Libera bastante espaço depois do VACUUM.

6. **Cole o BLOCO 3** (`VACUUM (ANALYZE, VERBOSE) public.appointments;`) e clique em **Run**.

> VACUUM pode demorar 1–3 min em projetos Free. Aguarde.

7. Repita o PASSO 2 (Restart project) se ainda estiver 503.

---

### PASSO 4 — Concluir migração de appointments

Quando a API voltar a responder 200, no seu terminal local:

```bash
cd "C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub"
python scripts/migrate_resume_appointments.py
```

Esse script:

1. Detecta quais appointments **já foram migrados** (pela coluna `cd_origem_sigh`).
2. Compara com o total do SIGH (~448.676).
3. Insere apenas as ~312 mil faltantes em chunks de 200.
4. Mostra progresso em tempo real.

**Tempo esperado:** 30–60 minutos (depende da banda).

---

### PASSO 5 — Validação final

```bash
supabase db query "SELECT count(*) FROM public.appointments" --linked
```

Esperado: **~448.676** (ou valor próximo, dependendo da sua contagem original).

Para validação completa, rode a query do BLOCO 4 do `migrate_resume_via_sql_editor.sql`.

---

### PASSO 6 — Upgrade para Pro (recomendado, evita recorrência)

Para não bater no limite de novo:

1. **Settings** → **Billing** → **Upgrade to Pro** ($25/mês).
2. Plano Pro dá **8GB de disco** e mais banda.

---

## 3. Resumo do que já está migrado

| Tabela | Origem | Destino (Supabase) |
|---|---|---|
| `patients` | 50.593 | **50.593** ✓ |
| `professionals` | 1.673 | 144 (parcial) |
| `insurance_companies` | ~80 | migrado ✓ |
| `tiss_xml` | 544 | **544** ✓ |
| `appointments` | 448.676 | **136.657** (~30%) |
| `medical_records` | 0 | 0 (SIGH não tem) |
| `companies` | 1 | 1 ✓ |

**Total de registros migrados com sucesso:** 241.657
**Pendentes:** 312.000 (appointments)

---

## 4. Arquivos que criei para você

| Arquivo | Para quê |
|---|---|
| `scripts/migrate_resume_via_sql_editor.sql` | Comandos SQL prontos para colar no SQL Editor do Dashboard (4 blocos comentados). |
| `RUNBOOK_DASHBOARD_INTERVENTION.md` | Este documento. |

---

## 5. Scripts Python que rodam automaticamente

Já existem no projeto e rodam sem alterações:

- `scripts/migrate_resume_appointments.py` — completa appointments.
- `scripts/validate-against-supabase.py` — valida schema.
- `scripts/validate-migrations-v2.py` — valida contagens.

---

## 6. Se precisar de mim depois

Quando você terminar os passos acima, me chame e eu:

1. Confirmo que a API voltou (HTTP 200).
2. Concluo a migração das 312k appointments.
3. Atualizo o relatório final.
