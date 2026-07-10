# PRONTOMEDIC â€” CRONOGRAMA TÃ‰CNICO VPS (Ã€ PROVA DE ERROS)

> **Regra de execuÃ§Ã£o:** cada fase sÃ³ avanÃ§a quando a anterior passa nos checkpoints.  
> **Checkpoint = comando que retorna true/false, nÃ£o opiniÃ£o.**

---

## FASE 0 â€” PREPARAÃ‡ÃƒO DA VPS (Dia 1)

**Objetivo:** Servidor pronto para receber o sistema. Zero dependÃªncia da mÃ¡quina atual.

### 0.1 â€” Provisionar VPS
- [ ] SO: Ubuntu 24.04 LTS (ou Debian 12)
- [ ] MÃ­nimo: 4 vCPU, 8 GB RAM, 80 GB SSD
- [ ] IP fixo + domÃ­nio configurado (ex: `prontomedic.medilife.com.br`)

### 0.2 â€” Instalar stack base
```bash
# PostgreSQL 16
sudo apt install postgresql-16 postgresql-contrib

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install nodejs

# Nginx (proxy reverso + HTTPS)
sudo apt install nginx certbot python3-certbot-nginx

# Git
sudo apt install git
```

### 0.3 â€” Criar banco e usuÃ¡rio
```sql
CREATE ROLE app_prontomedic WITH LOGIN PASSWORD '<SENHA_FORTE_GERADA>';
CREATE DATABASE prontoclinic OWNER app_prontomedic;
\c prontoclinic
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
```

### 0.4 â€” Firewall
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Let's Encrypt)
sudo ufw allow 443/tcp   # HTTPS
# PostgreSQL NÃƒO abre porta externa â€” sÃ³ localhost
sudo ufw enable
```

### Checkpoint Fase 0
```bash
# Todos devem retornar sucesso:
systemctl is-active postgresql   # active
systemctl is-active nginx        # active
node --version                   # v22.x
psql -U app_prontomedic -d prontoclinic -c "SELECT 1"  # 1
sudo ufw status                  # 22, 80, 443 allowed
```

---

## FASE 1 â€” TRANSFERÃŠNCIA DO BANCO (Dia 1-2)

**Objetivo:** Banco rodando na VPS com todos os dados do SIGH.

### 1.1 â€” Dump da mÃ¡quina local
```bash
# Na mÃ¡quina Windows atual:
pg_dump -h 127.0.0.1 -U postgres -d prontoclinic \
  --format=custom --file=prontomedic_vps.dump --verbose
```

### 1.2 â€” Restore na VPS
```bash
# Copia o dump pra VPS (scp ou upload)
scp prontomedic_vps.dump user@vps:/tmp/

# Restaura
pg_restore -h 127.0.0.1 -U app_prontomedic -d prontoclinic \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/prontomedic_vps.dump
```

### 1.3 â€” Corrigir ownership pÃ³s-restore
```sql
-- Todas as tabelas ficam com owner app_prontomedic
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public')
  LOOP EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO app_prontomedic'; END LOOP;
END $$;
```

### Checkpoint Fase 1
```bash
psql -U app_prontomedic -d prontoclinic -c "
SELECT count(*) FROM patients;      -- 83624
SELECT count(*) FROM appointments;   -- 248069
SELECT count(*) FROM financial_transactions;  -- 13589
SELECT count(*) FROM reports;        -- 7714
"
# Todos os counts devem bater com a mÃ¡quina local
```

---

## FASE 2 â€” DEPLOY DA APLICAÃ‡ÃƒO (Dia 2)

**Objetivo:** Sistema rodando na VPS, acessÃ­vel via HTTPS.

### 2.1 â€” Clonar e configurar
```bash
cd /opt
git clone <repo_url> prontomedic
cd prontomedic
npm ci --production
```

### 2.2 â€” Configurar .env.production
```env
VITE_SUPABASE_URL=https://prontomedic.medilife.com.br/api
VITE_SUPABASE_ANON_KEY=prontomedic-vps-key-2026
DATABASE_URL=postgresql://app_prontomedic:<SENHA>@127.0.0.1:5432/prontoclinic
JWT_SECRET=<GERAR_NOVO_SECRET_32_CHARS>
PORT=8000
```

### 2.3 â€” Build do frontend
```bash
npm run build
# Serve via Nginx, nÃ£o vite preview
```

### 2.4 â€” Nginx reverse proxy
```nginx
server {
    listen 443 ssl;
    server_name prontomedic.medilife.com.br;
    ssl_certificate /etc/letsencrypt/live/prontomedic.medilife.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/prontomedic.medilife.com.br/privkey.pem;

    # Frontend (arquivos estÃ¡ticos)
    location / {
        root /opt/prontomedic/dist;
        try_files $uri /index.html;
    }

    # Backend API (proxy reverso)
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2.5 â€” Systemd service (auth server sempre no ar)
```ini
# /etc/systemd/system/prontomedic-api.service
[Unit]
Description=ProntoMedic Auth Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/prontomedic
ExecStart=/usr/bin/node /opt/prontomedic/local-auth-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable prontomedic-api
sudo systemctl start prontomedic-api
```

### Checkpoint Fase 2
```bash
# Todos 200:
curl -k https://localhost/api/auth/v1/settings
curl -k https://localhost/
sudo systemctl is-active prontomedic-api   # active
```

---

## FASE 3 â€” SEGURANÃ‡A MÃNIMA (Dia 2-3)

**Objetivo:** NinguÃ©m consegue acessar dados sem autorizaÃ§Ã£o.

### 3.1 â€” Trocar todas as senhas de usuÃ¡rio
```sql
-- Gera senha aleatÃ³ria para cada usuÃ¡rio (bcrypt)
UPDATE auth.users
SET encrypted_password = crypt(
  encode(gen_random_bytes(6), 'hex'),  -- senha aleatÃ³ria 12 chars hex
  gen_salt('bf', 10)
)
WHERE email != 'admin@prontomedic.local';

-- Admin mantÃ©m senha conhecida (trocar manualmente depois)
UPDATE auth.users
SET encrypted_password = crypt('SENHA_ADMIN_FORTE_2026', gen_salt('bf', 10))
WHERE email = 'admin@prontomedic.local';
```

### 3.2 â€” ForÃ§ar reset de senha no primeiro login
- Adicionar flag `must_change_password` na tabela `user_profiles`
- Adicionar verificaÃ§Ã£o no `fetchUserProfile()` do useAuth.tsx

### 3.3 â€” Configurar backups automÃ¡ticos
```bash
# /etc/cron.d/prontomedic-backup
0 3 * * * postgres pg_dump -U app_prontomedic -d prontoclinic --format=custom --file=/backups/prontomedic_$(date +\%Y\%m\%d).dump
0 4 * * * postgres find /backups -name '*.dump' -mtime +7 -delete
```

### 3.4 â€” Monitoramento bÃ¡sico
```bash
# Healthcheck a cada 5 minutos
*/5 * * * * curl -sf https://localhost/api/auth/v1/settings || systemctl restart prontomedic-api
```

### Checkpoint Fase 3
```bash
# Senha padrÃ£o NÃƒO funciona mais:
curl -X POST https://localhost/api/auth/v1/token?grant_type=password \
  -d '{"email":"adriana-marmo@hotmail.com","password":"<SENHA_FORA_DO_GIT>"}'  # deve 400

# Backup roda:
ls -la /backups/  # pelo menos 1 arquivo .dump
```

---

## FASE 4 â€” VALIDAÃ‡ÃƒO FUNCIONAL (Dia 3-4)

**Objetivo:** Comprovar que cada mÃ³dulo funciona na VPS.

### 4.1 â€” Testes automatizados (rodar da mÃ¡quina local contra a VPS)
```bash
# Ajustar BASE=http://VPS_IP:8000 e rodar:
python -m scripts.teste_enforcement   # 20/20
python -m scripts.teste_dia_real      # 24/24
```

### 4.2 â€” Checklist manual por mÃ³dulo

| MÃ³dulo | Rota | O que testar | OK? |
|--------|------|-------------|:---:|
| Login | `/login` | Logar com admin | â˜ |
| Pacientes | `/patients` | Buscar paciente, criar novo | â˜ |
| Agenda | `/schedule` | Ver agenda, criar/cancelar | â˜ |
| RecepÃ§Ã£o | `/reception` | Check-in, chamar senha | â˜ |
| ProntuÃ¡rio | `/records` | Abrir, criar, assinar | â˜ |
| FarmÃ¡cia | `/pharmacy` | Buscar medicamento, dispensar | â˜ |
| LaboratÃ³rio | `/lab` | Criar pedido, lanÃ§ar resultado | â˜ |
| Financeiro | `/financial` | Ver lanÃ§amentos, marcar pago | â˜ |
| Faturamento | `/billing` | Ver contas, glosa preventiva | â˜ |
| Laudos | `/dicom/reports` | Listar, abrir, assinar | â˜ |
| Admin/Users | `/admin/users` | Listar, editar perfil | â˜ |
| Admin/Perms | `/admin/permissions` | Matriz de permissÃµes | â˜ |

---

## FASE 5 â€” ENTREGA AO CLIENTE (Dia 5)

### 5.1 â€” Criar manual rÃ¡pido (1 pÃ¡gina por mÃ³dulo)
- Como logar
- Como cadastrar paciente
- Como agendar consulta
- Como fazer check-in
- Como registrar atendimento (prontuÃ¡rio)
- Como emitir guia (quando implementado)
- Como receber pagamento
- Como gerar relatÃ³rio

### 5.2 â€” Criar usuÃ¡rios finais
- Cada funcionÃ¡rio da clÃ­nica recebe login + senha individual
- Perfil correto atribuÃ­do (recepÃ§Ã£o, mÃ©dico, enfermagem, etc)

### 5.3 â€” SessÃ£o de treinamento
- 2h com a equipe da recepÃ§Ã£o (fluxo paciente â†’ agenda â†’ check-in)
- 1h com mÃ©dicos (prontuÃ¡rio, prescriÃ§Ã£o, laudo)
- 1h com financeiro (lanÃ§amentos, recebimentos, TISS)

---

## CRONOGRAMA VISUAL

```
DIA 1    DIA 2       DIA 3       DIA 4       DIA 5
â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ
FASE 0   FASE 1+2    FASE 3      FASE 4      FASE 5
VPS      Banco +     SeguranÃ§a   ValidaÃ§Ã£o   Entrega
setup    Deploy      Senhas      Funcional   Cliente
         + Nginx     Backup      Testes      Treina-
         + HTTPS     Monitor     Manuais     mento
```

---

## REGRAS ANTI-ERRO

1. **Cada checkpoint Ã© um comando, nÃ£o opiniÃ£o.** Se `curl` nÃ£o retorna 200, a fase nÃ£o passou.
2. **Rollback sempre possÃ­vel.** Se Fase 2 falhar, Fases 0-1 continuam Ã­ntegras.
3. **Senha padrÃ£o Ã© removida ANTES de expor a VPS Ã  internet.** Fase 3 antes do DNS pÃºblico.
4. **HTTPS antes de qualquer login real.** Sem exceÃ§Ã£o.
5. **Backup antes de qualquer ALTER TABLE ou migration nova na VPS.**

---

## ARQUIVOS QUE VOCÃŠ PRECISA LEVAR PARA A VPS

| Arquivo | ConteÃºdo |
|---------|----------|
| `prontomedic_vps.dump` | Banco completo (pg_dump) |
| `local-auth-server.mjs` | Backend auth + REST + RBAC |
| `dist/` | Frontend buildado |
| `.env.production` | ConfiguraÃ§Ã£o da VPS |
| `nginx-prontomedic.conf` | Config do Nginx |
| `prontomedic-api.service` | Systemd unit |
| `scripts/*.py` | Scripts de migraÃ§Ã£o e teste |
