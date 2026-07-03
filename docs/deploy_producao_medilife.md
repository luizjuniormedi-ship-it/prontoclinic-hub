# RUNBOOK DE DEPLOY EM PRODUCAO — ProntoClinic Hub v1.1.0

**Cliente**: POLICLINICA MEDILIFE DIAGNOSTICOS LTDA
**Sistema**: ProntoClinic Hub v1.1.0
**Ambiente**: Servidor fisico local (Dell R250) na clinica, em Sao Goncalo/RJ
**Dominio**: medilife.com.br (ou IP fixo)
**Banco**: PostgreSQL local + Supabase self-hosted (recomendado) ou Supabase Cloud gerenciado
**Data de criacao**: 03/07/2026
**Versao**: 1.0
**Pre-requisito**: Fase de homolog (homolog.medilife.com.br) validada por 1-2 semanas.

---

## 0. SUMARIO EXECUTIVO

Este runbook descreve o deploy em **producao real** do ProntoClinic Hub no servidor fisico local da MEDILIFE. Foi desenhado para ser executado em **1 semana** apos a fase de homolog estar validada.

| Item | Valor |
|---|---|
| Stack frontend | Vite 7 + React 18 + TypeScript (build estatico) |
| Stack backend | PostgreSQL 16 (local) + Supabase self-hosted |
| Hospedagem frontend | Nginx no servidor local + Cloudflare Tunnel |
| Hospedagem backend | Mesmo servidor (porta 8000) + Cloudflare Tunnel |
| SSL | Cloudflare (Full Strict) com Origin Certificate |
| Backup | NAS local + replicacao off-site |
| Janela de cutover | Sabado 22:00 - 02:00 (menor uso clinico) |
| Equipe | 1 Tech Lead + 1 DBA + 1 Coordenador Medico |

---

## 1. PRE-REQUISITOS ANTES DO DEPLOY EM PRODUCAO

### 1.1 Servidor fisico entregue e configurado

- [ ] Servidor Dell PowerEdge R250 entregue na clinica
- [ ] 32 GB RAM, 2 TB SSD (configuracao minima recomendada)
- [ ] Ubuntu Server 22.04 LTS instalado
- [ ] IP fixo configurado (LAN: 192.168.1.10, sugerido)
- [ ] Acesso SSH do time TI configurado (chave publica)
- [ ] DNS interno: `prontoclinic.medilife.local` apontando para o servidor

### 1.2 Fase de homolog validada

- [ ] homolog.medilife.com.br testado por no minimo 7 dias
- [ ] Smoke tests passaram 100%
- [ ] Usuarios-chave (medicos, recepcao) validaram fluxos principais
- [ ] Backup do SIGH foi testado em homolog (dados anonimizados)
- [ ] Coordenador medico assinou termo de aceite da homolog

### 1.3 Equipe disponivel no cutover

- [ ] Tech Lead (responsavel pelo deploy)
- [ ] DBA SIGH (responsavel pelo backup final)
- [ ] Coordenador medico (autoriza o go-live)
- [ ] Recepcao disponivel para testes em tempo real
- [ ] Canal Slack/Teams `#cutover-producao-medilife` ativo

### 1.4 Documentos legais prontos

- [ ] Contrato de manutencao assinado
- [ ] DPO (Encarregado de Dados) designado pela MEDILIFE
- [ ] Politica de privacidade atualizada (LGPD)
- [ ] Termo de consentimento de pacientes pronto
- [ ] Backup da homologacao documentado

---

## 2. ARQUITETURA DE PRODUCAO

```
                              [Internet]
                                  |
                                  v
                    [Cloudflare Edge / DNS]
                                  |
                                  v
              +----------- Cloudflare Tunnel -----------+
              |                                          |
              v                                          v
   +-------------------+                    +----------------------+
   | medilife.com.br   |                    |  api.medilife.com.br |
   | (frontend SPA)    |                    |  (Supabase REST)     |
   +---------+---------+                    +----------+-----------+
             |                                         |
             v                                         v
   +---------+-----------------------------------------+---------+
   |              Servidor Fisico MEDILIFE (Dell R250)           |
   |  Ubuntu 22.04 LTS                                           |
   |                                                             |
   |  [Nginx :80/:443]   <-->   [Supabase :8000]                 |
   |       (frontend build)          (PostgREST + Auth + Storage) |
   |                                |                            |
   |                                v                            |
   |                       [PostgreSQL :5432]                    |
   |                       (dados LGPD)                          |
   |                                                             |
   |  [Orthanc :8042]   <-->   [/dicom/ bucket local]            |
   |  (PACS DICOM local)         (filesystem)                    |
   |                                                             |
   |  [Cron jobs]                                                 |
   |  - backup-diario.sh (02:00)                                  |
   |  - backup-replica-offsite.sh (03:00)                         |
   |  - lgpd-retention.sh (04:00)                                 |
   |  - health-check.sh (*/15min)                                 |
   +-------------------------------------------------------------+
                                  |
                                  v
                     [NAS local + replicacao off-site]
```

---

## 3. FASE 1 — PREPARACAO (3 dias antes)

### 3.1 Validar servidor fisico

```bash
ssh admin@prontoclinic.medilife.local
# Verificar hardware
sudo lshw -short
df -h
free -h
nproc

# Verificar conectividade
ping -c 4 8.8.8.8
nslookup google.com
curl -s -I https://cloudflare.com
```

### 3.2 Instalar dependencias base (se ainda nao feito)

```bash
# Script: scripts/setup-local-server.sh (ja existente em infra/)
cd /opt/prontoclinic
bash setup-local-server.sh
```

Servicos instalados:
- PostgreSQL 16
- Nginx
- Cloudflared (para Tunnel)
- Orthanc (PACS DICOM)
- Node.js 20 LTS (apenas para build do frontend)
- Python 3.11 + pip
- Cron

### 3.3 Configurar DNS e Cloudflare Tunnel

1. No dashboard Cloudflare (medilife.com.br ja adicionado):
   - Zero Trust > Tunnels > Create a tunnel: `prontoclinic-prod`
   - Copiar o token do tunnel
2. No servidor:

```bash
sudo cloudflared service install <TOKEN_DO_TUNNEL>
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

3. Configurar rotas do tunnel:

```yaml
# /etc/cloudflared/config.yml
tunnel: prontoclinic-prod
credentials-file: /etc/cloudflared/.cert.json

ingress:
  - hostname: medilife.com.br
    service: http://localhost:80
  - hostname: www.medilife.com.br
    service: http://localhost:80
  - hostname: api.medilife.com.br
    service: http://localhost:8000
  - service: http_status:404
```

### 3.4 Provisionar Supabase local (self-hosted)

```bash
# Clonar repo do Supabase
cd /opt
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker

# Copiar e customizar env
cp .env.example .env
nano .env  # Editar senhas, JWT_SECRET, etc.

# Subir servicos
docker compose up -d
```

Servicos ativos:
- `postgres` (porta 5432)
- `postgrest` (porta 3000 -> exposto como 8000)
- `auth` (GoTrue, porta 9999)
- `storage` (porta 5000)
- `realtime` (porta 4000)
- `nginx` (proxy, porta 8000)
- `studio` (porta 3000, dashboard admin)

### 3.5 Aplicar migrations no banco local

```bash
cd /opt/prontoclinic/supabase/migrations
PGPASSWORD=$DB_PASSWORD psql -h localhost -U postgres -d postgres -f 00000_extensions.sql
# ... aplicar todas as 60 migrations em ordem ...

# Ou via CLI
supabase db push --include-all --db-url "postgresql://postgres:$DB_PASSWORD@localhost:5432/postgres"
```

---

## 4. FASE 2 — BUILD E DEPLOY DO FRONTEND (Dia 1)

### 4.1 Gerar build de producao

Na maquina de desenvolvimento (com .env.production correto):

```bash
cd "C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub"

# Configurar .env.production com valores de PRODUCAO
cp .env.production.local .env.production
# Editar .env.production:
#   VITE_SUPABASE_URL=https://api.medilife.com.br
#   VITE_SUPABASE_ANON_KEY=<chave publica do Supabase local>
#   VITE_APP_ENV=production
#   VITE_TISS_AMBIENTE=PRODUCAO

# Build
npm ci
npm run build
# Resultado em dist/
```

### 4.2 Transferir build para o servidor

```bash
# Compactar
tar -czf dist-prod.tar.gz dist/

# Transferir via SCP
scp dist-prod.tar.gz admin@prontoclinic.medilife.local:/tmp/

# No servidor
ssh admin@prontoclinic.medilife.local
sudo mkdir -p /var/www/prontoclinic
sudo tar -xzf /tmp/dist-prod.tar.gz -C /var/www/prontoclinic/
sudo chown -R www-data:www-data /var/www/prontoclinic
```

### 4.3 Configurar Nginx

```nginx
# /etc/nginx/sites-available/prontoclinic
server {
    listen 80;
    server_name medilife.com.br www.medilife.com.br;
    root /var/www/prontoclinic;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache agressivo para assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Sem cache para index.html (sempre fresh)
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        expires 0;
    }

    # Service Worker sem cache
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        expires 0;
    }

    # Headers de seguranca
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/prontoclinic /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. FASE 3 — MIGRACAO DE DADOS (Dia 2-3)

### 5.1 Backup FINAL do SIGH

```bash
# No servidor SIGH legado
mysqldump -u root -p --single-transaction --routines --triggers --events \
  sigh_producao | gzip > /backup/sigh_final_$(date +%Y%m%d).sql.gz
```

### 5.2 Anonimizar dados para PRODUCAO

**ATENCAO LGPD**: O backup do SIGH contem dados sensiveis. Para producao:
- Manter dados reais (consentimento do paciente registrado)
- Configurar RLS para isolar por empresa_id
- Logs de auditoria devem registrar TODO acesso

```bash
# Script: scripts/migrate_sigh.py (ja existente)
cd /opt/prontoclinic
python3 scripts/migrate_sigh_to_postgres.py \
  --source "mysql://user:pass@sigh-host/sigh_producao" \
  --target "postgresql://postgres:$DB_PASSWORD@localhost:5432/postgres" \
  --company-id "uuid-da-empresa-medilife" \
  --batch-size 1000 \
  --audit
```

### 5.3 Validar contagens

```sql
-- No psql local
SELECT
  (SELECT COUNT(*) FROM patients) AS pacientes,
  (SELECT COUNT(*) FROM professionals) AS profissionais,
  (SELECT COUNT(*) FROM appointments) AS agendamentos,
  (SELECT COUNT(*) FROM medical_records) AS prontuarios,
  (SELECT COUNT(*) FROM insurance_companies) AS convenios;
```

Comparar com os totais do SIGH:
- 50.593+ pacientes
- 1.673 profissionais
- 555k+ prontuarios historicos

---

## 6. FASE 4 — VALIDACAO (Dia 4-5)

### 6.1 Smoke tests em PRODUCAO

```bash
bash scripts/smoke-test.sh --env=production
```

Checks:
- [ ] Site carrega em https://medilife.com.br (HTTP 200)
- [ ] Login funciona (admin@medilife.com.br)
- [ ] Listar pacientes retorna dados
- [ ] Criar agendamento funciona
- [ ] Buscar prontuario funciona
- [ ] Upload DICOM funciona (testar com Orthanc local)
- [ ] Gerar relatorio TISS em homologacao (NAO enviar para ANS ainda)

### 6.2 Testes de carga leves

```bash
# 50 usuarios simultaneos
hey -n 1000 -c 50 https://medilife.com.br/
hey -n 500 -c 25 https://api.medilife.com.br/rest/v1/patients
```

Metas:
- Latencia p95 frontend: < 200ms (LAN)
- Latencia p95 API: < 100ms
- 0 erros 5xx

### 6.3 Validacao com equipe MEDILIFE

- [ ] Recepcionista faz 5 agendamentos reais (com dados reais)
- [ ] Medico abre prontuario e assina digitalmente
- [ ] Coordenador valida 1 relatorio TISS
- [ ] DPO valida que logs de auditoria estao ativos

---

## 7. FASE 5 — GO-LIVE (Sabado 22:00 - 02:00)

### 7.1 Comunicacao pre-cutover (6h antes)

- Email + Teams para todas as clinicas: "Sistema SIGH sera substituido a partir das 22:00"
- Recepcao para de aceitar novos agendamentos no SIGH as 20:00
- Plantao TI presencial das 20:00 ate 06:00

### 7.2 Cutover passo-a-passo

```bash
# 22:00 - Bloquear SIGH para novos cadastros
ssh sigh-host "mysql -u root -p -e \"UPDATE config SET valor='BLOQUEADO' WHERE chave='novos_cadastros';\""

# 22:30 - Backup FINAL SIGH
ssh sigh-host "mysqldump -u root -p sigh_producao | gzip > /backup/sigh_ULTIMO_$(date +%Y%m%d_%H%M).sql.gz"

# 23:00 - Aplicar migrations finais + dados restantes
ssh admin@prontoclinic.medilife.local
cd /opt/prontoclinic
python3 scripts/migrate_sigh_to_postgres.py --incremental --last-sync=2026-07-03T20:00:00

# 23:30 - Validar contagens finais
PGPASSWORD=$DB_PASSWORD psql -h localhost -U postgres -d postgres -c "
  SELECT 'patients' AS tabela, COUNT(*) FROM patients
  UNION ALL SELECT 'appointments', COUNT(*) FROM appointments
  UNION ALL SELECT 'professionals', COUNT(*) FROM professionals
  UNION ALL SELECT 'medical_records', COUNT(*) FROM medical_records;
"

# 00:00 - SINALIZAR DNS para medilife.com.br
# No Cloudflare Dashboard:
#   - Remover registro antigo SIGH
#   - Apontar A para IP do Cloudflare Tunnel (proxied)

# 00:15 - Validar DNS
dig medilife.com.br
curl -I https://medilife.com.br
# Esperado: HTTP 200 + Cloudflare proxy

# 00:30 - Teste E2E com paciente real
# Recepcionista faz login + cria agendamento
# Medico acessa prontuario

# 01:00 - Backup pos-cutover
bash /opt/prontoclinic/scripts/backup-diario.sh

# 01:30 - Equipe em casa, monitoramento remoto
# Grafana/Prometheus rodando, alertas configurados

# 06:00 - Fim do plantao, verificacao final
```

### 7.3 Rollback (se necessario)

Se algo der errado nas primeiras 2h:

```bash
# 1. Reverter DNS no Cloudflare (apontar para IP do SIGH legado)
# 2. SIGH ja tem todos os dados (backup das 22:30)
# 3. Comunicar usuarios via Teams
# 4. Investigar causa raiz nas proximas 24h
```

---

## 8. FASE 6 — POS GO-LIVE (Semana seguinte)

### 8.1 Monitoramento

```bash
# Grafana: https://grafana.medilife.local (acesso VPN)
# Dashboards:
#  - Uptime do site
#  - Latencia API
#  - Tamanho do banco (crescimento diario)
#  - Erros 5xx (alerta se > 0)
#  - Backup jobs (alerta se falha)
```

Alertas:
- Site offline > 2 min → SMS para TI
- Backup falhou → email para DPO + TI
- Disco > 80% → email para TI
- Disco > 90% → SMS para TI
- Erro 5xx recorrente → SMS para Tech Lead

### 8.2 Backup diario (ja configurado)

- 02:00 — `backup-diario.sh` → `/backup/postgres_diario/`
- 03:00 — `backup-replica-offsite.sh` → NAS secundario
- Retencao: 30 dias local, 90 dias off-site

### 8.3 Sincronizacao SIGH → ProntoClinic (dual-run)

Durante 2 semanas apos go-live, manter SIGH em modo somente-leitura para consulta historica. Dados novos sao escritos APENAS no ProntoClinic.

### 8.4 Descomissionar SIGH (apos 2 semanas)

- [ ] Validar que todos os usuarios ativos usam ProntoClinic
- [ ] Backup final SIGH (ja temos o das 22:30 do cutover)
- [ ] Desligar servidor SIGH (NAO deletar imediatamente, manter 30 dias)
- [ ] Apos 30 dias: deletar dados SIGH ou migrar para arquivo morto

---

## 9. CRONOGRAMA CONSOLIDADO

| Dia | Atividade | Responsavel | Duracao |
|---|---|---|---|
| Dia -3 | Validar servidor + instalar deps | Tech Lead | 4h |
| Dia -2 | Configurar Cloudflare Tunnel + DNS | Tech Lead | 2h |
| Dia -1 | Aplicar migrations + dados demo em prod | Tech Lead + DBA | 6h |
| Dia 0 (sabado 22h) | Cutover | Equipe completa | 4h |
| Dia +1 | Monitoramento intensivo + suporte | TI | 12h |
| Dia +2..+7 | Acompanhamento diario | TI | 1h/dia |
| Dia +7..+14 | Dual-run SIGH/ProntoClinic | Recepcao + Medicos | continuo |
| Dia +14 | Descomissionar SIGH | Tech Lead | 2h |

**Total**: 1 semana de cutover + 2 semanas de estabilizacao.

---

## 10. CRITERIOS DE ACEITE

### Funcionais
- [ ] Login funciona para 100% dos usuarios importados do SIGH
- [ ] Todos os 50k+ pacientes estao acessiveis
- [ ] Todos os 555k+ prontuarios estao acessiveis
- [ ] Todos os 1.6k+ profissionais estao cadastrados
- [ ] Agendamentos do dia aparecem corretamente
- [ ] DICOM funciona (testar com estudo real)
- [ ] TISS gera XML valido (homologacao, NAO enviar para ANS)

### Nao-funcionais
- [ ] Latencia p95 frontend < 200ms
- [ ] Latencia p95 API < 100ms
- [ ] Uptime > 99.5% (medido mensalmente)
- [ ] Backup diario executado por 7 dias consecutivos
- [ ] Logs de auditoria registrando todos os acessos

### LGPD
- [ ] DPO designado e comunicado
- [ ] Logs de auditoria ativos e protegidos
- [ ] Backup criptografado (AES-256)
- [ ] Acesso ao servidor fisico restrito (sala cofre ou trancada)
- [ ] Politica de privacidade atualizada
- [ ] Termo de consentimento aplicado

### Operacionais
- [ ] Equipe MEDILIFE treinada (8h de treinamento ja ministrado)
- [ ] Documentacao de usuario final entregue
- [ ] Canal de suporte ativo (email + Teams)
- [ ] SLA de suporte: 4h para critico, 24h para outros

---

## 11. RISCOS E MITIGACOES

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| Servidor fisico falha | Baixa | Alto | NAS local como replica + cloud backup |
| Cloudflare Tunnel cai | Muito baixa | Medio | DNS tem fallback IP fixo (raro de usar) |
| Disco enche | Media | Alto | Alerta em 80% + limpeza automatica de logs |
| Backup falha | Baixa | Critico | Monitoramento + alarme + validacao automatica |
| Usuarios nao conseguem logar | Media | Alto | SIGH em modo somente-leitura por 2 semanas |
| Dados SIGH incompletos | Baixa | Critico | Backup final as 22:30 do cutover + sync incremental |

---

## 12. CONTATOS

| Papel | Nome | Telefone | Email |
|---|---|---|---|
| Tech Lead | _preencher_ | _preencher_ | _preencher_ |
| DBA SIGH | _preencher_ | _preencher_ | _preencher_ |
| DPO MEDILIFE | _preencher_ | _preencher_ | _preencher_ |
| Coordenador Medico | _preencher_ | _preencher_ | _preencher_ |

---

**APROVADO POR**:
- [ ] Tech Lead: _________________ Data: ___/___/______
- [ ] Coordenador Medico MEDILIFE: _________________ Data: ___/___/______
- [ ] DPO MEDILIFE: _________________ Data: ___/___/______