# DEPLOY TESTE vs PRODUCAO — Comparativo Detalhado

**Sistema**: ProntoClinic Hub v1.1.0
**Cliente**: POLICLINICA MEDILIFE DIAGNOSTICOS LTDA
**Data**: 03/07/2026
**Versao documento**: 1.0

---

## 1. VISAO GERAL

| Aspecto | FASE 1: TESTE (Homolog) | FASE 2: PRODUCAO |
|---|---|---|
| **Dominio** | `homolog.medilife.com.br` | `medilife.com.br` (ou IP fixo) |
| **Objetivo** | Validar sistema com usuarios reais antes do go-live | Substituir SIGH em producao real |
| **Duracao** | 1 a 2 semanas | 1 semana (cutover) + 2 semanas (estabilizacao) |
| **Banco de dados** | Supabase Cloud (projeto de homolog, separado) | Servidor fisico local (Supabase self-hosted) |
| **Hospedagem** | Vercel (cloud) | Servidor Dell R250 na clinica |
| **Acesso externo** | Cloudflare (DNS public) | Cloudflare Tunnel (proxy reverso seguro) |
| **Dados** | Backup SIGH anonimizado (LGPD-safe) | Backup SIGH COMPLETO (consentimento) |
| **Custo** | ~R$ 100-200/mes | ~R$ 0/mes (apos investimento do servidor) |
| **Risco** | Baixo (ambiente isolado) | Alto (afeta 100+ usuarios e 50k+ pacientes) |
| **Rollback** | Simples (apagar projeto) | Complexo (cutover + dual-run SIGH) |

---

## 2. AMBIENTES — LADO A LADO

### 2.1 Infraestrutura

| Componente | TESTE | PRODUCAO |
|---|---|---|
| **Frontend** | Vercel (CDN global) | Nginx no servidor local + Cloudflare CDN |
| **Backend API** | Supabase Cloud (PostgREST gerenciado) | Supabase self-hosted no servidor |
| **Banco de dados** | Supabase Cloud PostgreSQL | PostgreSQL 16 local (Supabase self-hosted) |
| **Auth** | Supabase Auth Cloud | Supabase Auth local (GoTrue) |
| **Storage** | Supabase Storage Cloud | Disco local + backup NAS |
| **DICOM/PACS** | Orthanc mockado em localhost | Orthanc real em porta 8042 |
| **SSL** | Let's Encrypt via Vercel | Cloudflare Origin Certificate + Full Strict |
| **Dominio** | homolog.medilife.com.br (CNAME vercel-dns) | medilife.com.br (CNAME tunnel ou A para tunnel) |

### 2.2 URLs de acesso

| Recurso | TESTE | PRODUCAO |
|---|---|---|
| Site | https://homolog.medilife.com.br | https://medilife.com.br |
| API REST | https://homolog.supabase.co/rest/v1 | https://api.medilife.com.br/rest/v1 |
| Auth | https://homolog.supabase.co/auth/v1 | https://api.medilife.com.br/auth/v1 |
| Storage | https://homolog.supabase.co/storage/v1 | https://api.medilife.com.br/storage/v1 |
| DICOM | http://localhost:8042 (no servidor de dev) | http://localhost:8042 (no servidor da clinica) |

---

## 3. CONFIGURACAO — DIFERENCAS PRATICAS

### 3.1 Variaveis de ambiente

**TESTE (.env.homolog / Vercel preview env)**:
```bash
VITE_SUPABASE_URL=https://homolog-medilife.supabase.co
VITE_SUPABASE_ANON_KEY=<chave anon publica do projeto homolog>
VITE_APP_NAME=ProntoClinic Hub (HOMOLOG)
VITE_APP_ENV=homolog
VITE_TISS_AMBIENTE=HOMOLOGACAO      # NAO envia para ANS
VITE_TISS_VERSION=3.05.00
VITE_DICOM_BUCKET=dicom-homolog
VITE_ENABLE_TELEMEDICINE=false
VITE_ENABLE_WHATSAPP=false
```

**PRODUCAO (.env.production)**:
```bash
VITE_SUPABASE_URL=https://api.medilife.com.br
VITE_SUPABASE_ANON_KEY=<chave anon publica do Supabase local>
VITE_APP_NAME=ProntoClinic Hub
VITE_APP_ENV=production
VITE_TISS_AMBIENTE=PRODUCAO         # ATENCAO: envia para ANS
VITE_TISS_VERSION=3.05.00
VITE_DICOM_BUCKET=dicom
VITE_ENABLE_TELEMEDICINE=false
VITE_ENABLE_WHATSAPP=false
```

### 3.2 Banco de dados

| Item | TESTE | PRODUCAO |
|---|---|---|
| Migrations aplicadas | 60 migrations (via `supabase db push`) | 60 migrations (via CLI + verificacao manual) |
| Volume de dados | ~1k pacientes (sinteticos) | 50.593+ pacientes reais |
| Origem | scripts/seed-test-data.sql | migrate_sigh_to_postgres.py (completo) |
| RLS | Habilitado | Habilitado (multi-tenant rigoroso) |
| Backups | N/A (Supabase gerencia) | Backup diario + replica off-site |
| Retencao LGPD | 5 anos | 20 anos (CFM 1.821/2007) |

### 3.3 Usuarios

| Item | TESTE | PRODUCAO |
|---|---|---|
| Cadastro inicial | 1 admin + 5 profissionais + 5 pacientes (seed) | 107 usuarios importados do SIGH (criados em auth.users) |
| Senhas | Conhecidas (admin@test.local / admin123) | Definidas via reset de senha no primeiro login |
| Roles | admin, medico, recepcao, lab | admin, medico, recepcao, lab, financeiro |
| Convites | Auto-cadastro habilitado | Convite controlado (admin convida) |

---

## 4. PROCESSO DE DEPLOY — PASSO A PASSO

### 4.1 Deploy de TESTE

```
+----------------------------------------------------+
| 1. Criar projeto Supabase de homolog (5 min)       |
|    - Nome: medilife-homolog                        |
|    - Regiao: sa-east-1 (Sao Paulo)                 |
|    - Plano: Free (ate 500 MB) ou Pro               |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 2. Linkar projeto (1 min)                          |
|    supabase link --project-ref <REF>               |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 3. Aplicar migrations (5 min)                      |
|    supabase db push --include-all                  |
|    (60 migrations, ~3 min de execucao)             |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 4. Aplicar seed de teste (2 min)                   |
|    scripts/seed-test-data.sql                      |
|    (5 pacientes, 5 profissionais, etc.)            |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 5. Criar projeto Vercel de homolog (3 min)        |
|    vercel link --name prontoclinic-hub-homolog     |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 6. Configurar env vars (3 min)                     |
|    vercel env add VITE_SUPABASE_URL preview        |
|    ... (9 vars no total)                           |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 7. Deploy (3 min)                                  |
|    vercel deploy --yes                             |
|    URL gerada: prontoclinic-hub-homolog.vercel.app |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 8. Configurar dominio customizado (5 min)          |
|    vercel domains add homolog.medilife.com.br      |
|    + CNAME no Cloudflare                          |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 9. Smoke tests (10 min)                            |
|    bash scripts/smoke-test.sh --env=homolog        |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| 10. Validacao com equipe MEDILIFE (1-2 semanas)    |
|     - Recepcionistas testam agendamentos           |
|     - Medicos testam prontuarios                   |
|     - TI testa fluxos administrativos              |
+----------------------------------------------------+

TOTAL: ~30 min de deploy + 1-2 semanas de validacao
```

### 4.2 Deploy de PRODUCAO

```
+----------------------------------------------------+
| FASE 1: PREPARACAO (3 dias antes)                  |
| - Servidor fisico entregue e configurado           |
| - Cloudflare Tunnel provisionado                   |
| - Supabase self-hosted up                          |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| FASE 2: BUILD + TRANSFERENCIA (Dia 1)             |
| - npm run build                                    |
| - SCP para servidor                                |
| - Nginx configurado                                |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| FASE 3: MIGRACAO SIGH (Dia 2-3)                   |
| - Backup FINAL SIGH                                |
| - Executar migrate_sigh_to_postgres.py             |
| - Validar contagens (50k pacientes, 555k pront)   |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| FASE 4: VALIDACAO (Dia 4-5)                       |
| - Smoke tests em PROD                              |
| - Testes de carga (50 users simultaneos)           |
| - Validacao com equipe MEDILIFE                   |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| FASE 5: CUTOVER (Sabado 22:00 - 02:00)             |
| 22:00 Bloquear SIGH para novos cadastros           |
| 22:30 Backup FINAL SIGH                           |
| 23:00 Aplicar sync incremental SIGH->ProntoClinic |
| 23:30 Validar contagens finais                    |
| 00:00 Sinalizar DNS para medilife.com.br          |
| 00:15 Teste E2E com paciente real                  |
| 00:30 Backup pos-cutover                          |
| 01:00 Plantao remoto em casa                      |
+----------------------------------------------------+
                          |
                          v
+----------------------------------------------------+
| FASE 6: ESTABILIZACAO (2 semanas)                  |
| - Monitoramento 24/7 primeira semana              |
| - Dual-run SIGH (somente-leitura)                  |
| - Ajustes finos conforme feedback                  |
| - Descomissionar SIGH apos 2 semanas              |
+----------------------------------------------------+

TOTAL: 3 dias de preparacao + 1 dia cutover + 2 semanas estabilizacao
```

---

## 5. CUSTOS COMPARATIVOS

### 5.1 TESTE (1-2 semanas)

| Item | Custo mensal | Por 2 semanas |
|---|---|---|
| Supabase Cloud (Free tier ou Pro) | R$ 0 ou R$ 100 | R$ 0 - R$ 50 |
| Vercel (Hobby tier) | R$ 0 | R$ 0 |
| Dominio homolog (sub-dominio) | R$ 0 | R$ 0 |
| Cloudflare (Free tier) | R$ 0 | R$ 0 |
| **Total TESTE** | **~R$ 0 - R$ 100** | **~R$ 0 - R$ 50** |

### 5.2 PRODUCAO (mensal recorrente, apos investimento)

| Item | Custo mensal | Observacao |
|---|---|---|
| Servidor Dell R250 (amortizado) | R$ 175 | R$ 7.000 / 40 meses |
| Energia eletrica (~150W) | R$ 60 | 150W * 24h * 30d * R$ 0,55/kWh |
| NAS para backup (amortizado) | R$ 50 | R$ 2.400 / 48 meses |
| Cloudflare Pro (recomendado) | R$ 40 | Tunnels avancados + WAF |
| Dominio medilife.com.br | R$ 5 | Renovacao anual R$ 60 |
| Internet da clinica | R$ 0 | Ja existe |
| **Total PRODUCAO** | **~R$ 330/mes** | **~R$ 4.000/ano** |

### 5.3 Comparativo 3 anos

| Opcao | TESTE + PRODUCAO | Custo 3 anos |
|---|---|---|
| 100% local (recomendado) | R$ 0 + R$ 4.000/ano | R$ 12.000 + R$ 7.000 (servidor) = **R$ 19.000** |
| Cloud hibrido | R$ 100 + R$ 230/mes | R$ 100 + R$ 8.280 = **R$ 8.380** (+ R$ 7.000 servidor) |
| Apenas cloud | R$ 100 + R$ 200-450/mes | **R$ 8.000-15.000** (sem servidor) |

---

## 6. RISCOS E MITIGACOES

### 6.1 TESTE

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| Bug critico em homolog | Media | Baixo (afeta apenas teste) | Logs + rollback trivial (apagar projeto) |
| Dados de teste vazarem para public | Baixa | Medio (LGPD) | Senhas fortes + RLS + anonimizacao |
| DNS nao propagar | Media | Baixo | Aguardar ate 48h; em paralelo usar IP |
| Cloudflare Tunnel instavel | Muito baixa | Baixo (afeta apenas homolog) | Fallback via IP da Vercel |

### 6.2 PRODUCAO

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| Servidor fisico falha | Baixa | Critico | NAS + replica off-site + dual-run SIGH |
| Disco enche | Media | Alto | Alerta 80% + limpeza automatica de logs |
| DNS nao resolver | Muito baixa | Alto | IP fixo documentado como fallback |
| Migracao SIGH incompleta | Baixa | Critico | Backup final 22:30 + sync incremental |
| Usuarios nao conseguem logar | Media | Alto | SIGH em modo somente-leitura por 2 semanas |
| Bug nao pego em homolog | Media | Alto | Smoke tests + monitoramento intensivo 24/7 |
| Cloudflare Tunnel cair | Muito baixa | Alto | IP fixo documentado (raro usar) |

---

## 7. CRITERIOS DE PASSAGEM TESTE → PRODUCAO

A fase de homolog so pode ser considerada concluida quando TODOS os criterios abaixo forem atingidos:

### 7.1 Tecnicos
- [ ] 100% dos smoke tests passaram em homolog
- [ ] 0 erros 5xx em 7 dias consecutivos
- [ ] Latencia p95 < 200ms (medida diariamente)
- [ ] 100% dos usuarios importados do SIGH conseguem logar
- [ ] 100% dos dados do SIGH foram migrados e validados
- [ ] Backups diarios executaram com sucesso por 7 dias
- [ ] Logs de auditoria registrando acessos

### 7.2 Funcionais
- [ ] Recepcionista validou fluxo de agendamento (5 cenarios)
- [ ] Medico validou fluxo de prontuario (5 cenarios)
- [ ] Coordenador validou relatorio TISS em homologacao
- [ ] Equipe TI validou backup e restore
- [ ] DPO validou logs de auditoria LGPD

### 7.3 Documentacao
- [ ] Runbook de producao revisado e assinado
- [ ] Checklist de cutover impresso e disponivel
- [ ] Contatos de emergencia atualizados
- [ ] SLA de suporte acordado

### 7.4 Equipe
- [ ] Equipe MEDILIFE treinada (8h de treinamento ja realizado)
- [ ] Plantao TI definido para o cutover (sabado 20h-06h)
- [ ] Coordenador medico disponivel no dia do go-live
- [ ] Canal Slack/Teams de suporte ativo

### 7.5 Aprovacao formal
- [ ] Coord. medico MEDILIFE assinou termo de aceite da homolog
- [ ] DPO MEDILIFE assinou declaracao de conformidade LGPD
- [ ] Tech Lead assinou termo de conclusao da fase de homolog

---

## 8. CHECKLIST FINAL PRE-CUTOVER

### 8.1 7 dias antes
- [ ] homolog validada por equipe MEDILIFE
- [ ] Termo de aceite assinado
- [ ] Servidor fisico entregue e operacional

### 8.2 3 dias antes
- [ ] Cloudflare Tunnel configurado e testado
- [ ] DNS preparado (registro A apontando para Cloudflare)
- [ ] Supabase self-hosted rodando no servidor
- [ ] Migrations aplicadas no banco local

### 8.3 1 dia antes
- [ ] Backup SIGH executado e validado
- [ ] Equipe plantonista confirmada
- [ ] Canal Slack/Teams ativo
- [ ] Documentos legais revisados

### 8.4 Dia do cutover (sabado)
- [ ] 18:00 Equipe chega ao local
- [ ] 20:00 Recepcao para de aceitar novos cadastros no SIGH
- [ ] 22:00 Bloquear SIGH
- [ ] 22:30 Backup FINAL SIGH
- [ ] 23:00 Sync incremental SIGH → ProntoClinic
- [ ] 23:30 Validar contagens
- [ ] 00:00 Sinalizar DNS
- [ ] 00:15 Teste E2E
- [ ] 00:30 Backup pos-cutover
- [ ] 01:00 Plantao remoto
- [ ] 06:00 Fim do plantao presencial

---

## 9. PROXIMOS PASSOS IMEDIATOS

Para iniciar a FASE 1 (TESTE) hoje mesmo:

1. **Criar projeto Supabase de homolog** (5 min)
   - Acessar https://supabase.com/dashboard
   - New project: medilife-homolog (sa-east-1)
   - Anotar URL, anon key e DB password

2. **Criar projeto Vercel de homolog** (5 min)
   - Acessar https://vercel.com/dashboard
   - Import Git repo: luizjuniormedi-ship-it/prontoclinic-hub
   - Renomear para: prontoclinic-hub-homolog

3. **Configurar env vars em ambos** (5 min)
   - Seguir `.env.homolog.example`

4. **Rodar script de setup de homolog** (15 min)
   - `bash scripts/setup_teste_homolog.sh`

5. **Configurar DNS** (5 min, propagacao ate 48h)
   - CNAME homolog.medilife.com.br → cname.vercel-dns.com

6. **Smoke test** (5 min)
   - `bash scripts/smoke-test.sh`

7. **Validacao com equipe MEDILIFE** (1-2 semanas)

---

## 10. DOCUMENTOS RELACIONADOS

- `DEPLOY_TESTE_E_PRODUCAO.md` — documento consolidado (este + runbook)
- `docs/deploy_producao_medilife.md` — runbook detalhado de producao
- `scripts/setup_teste_homolog.sh` — script de deploy de homolog
- `scripts/setup_vercel_env.sh` — script de env vars Vercel
- `CUTOVER_RUNBOOK.md` — runbook de cutover SIGH → ProntoClinic
- `DEPLOY_VERCEL_AUTO.md` — guia de deploy Vercel automatizado
- `DOMAIN_SETUP.md` — guia de dominios Vercel
- `GUIA_100_LOCAL_MEDILIFE.md` — justificativa do modelo local

---

**Versao**: 1.0
**Data**: 03/07/2026
**Autor**: ProntoMedic Team
**Status**: APROVADO PARA EXECUCAO