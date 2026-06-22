# Guia de Deploy — ProntoClinic Hub

Este guia cobre quatro opções de deploy, da mais simples (Vercel) à mais controlada (VPS próprio).

## Opção 1: Vercel (Recomendado)

A maneira mais rápida de colocar o ProntoClinic Hub em produção. Build estático do Vite é suportado nativamente.

### Pré-requisitos

- Conta Vercel (free tier OK)
- Repositório no GitHub
- Projeto Supabase criado e configurado
- Domínio próprio (opcional)

### Passo a passo

#### 1. Conectar o repositório

1. Acesse [vercel.com](https://vercel.com) e faça login.
2. Clique em **Add New → Project**.
3. Selecione **Import Git Repository** e autorize o Vercel a ler seu GitHub.
4. Escolha o repo `prontoclinic-hub`.
5. Configure o framework como **Vite**.
6. Confirme:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm ci`

#### 2. Configurar variáveis de ambiente

Em **Settings → Environment Variables**, adicione (para Production, Preview e Development):

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | sim | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | sim | Anon key do Supabase |
| `VITE_RESEND_API_KEY` | sim (e-mail) | API key do Resend |
| `VITE_ZAPI_INSTANCE_ID` | sim (WhatsApp) | ID da instância Z-API |
| `VITE_ZAPI_TOKEN` | sim (WhatsApp) | Token Z-API |
| `VITE_TWILIO_ACCOUNT_SID` | opcional | Twilio SID para SMS |
| `VITE_TWILIO_AUTH_TOKEN` | opcional | Twilio token |
| `VITE_TWILIO_FROM` | opcional | Número Twilio remetente |
| `VITE_DAILY_API_KEY` | opcional | Daily.co para telemedicina |
| `VITE_DAILY_DOMAIN` | opcional | Domínio Daily.co |
| `VITE_ORTHANC_URL` | sim (PACS) | URL do Orthanc |
| `VITE_ORTHANC_USER` | sim (PACS) | Usuário Orthanc |
| `VITE_ORTHANC_PASS` | sim (PACS) | Senha Orthanc (NUNCA `orthanc`) |
| `VITE_DICOM_BUCKET` | sim (PACS) | Bucket DICOM no Supabase Storage |
| `VITE_TISS_VERSION` | sim | Versão TISS (default `3.05.00`) |
| `VITE_TISS_AMBIENTE` | sim | `HOMOLOGACAO` ou `PRODUCAO` |
| `VITE_TISS_CERT_PATH` | opcional | Caminho do certificado A1 |
| `VITE_TISS_CERT_PASSWORD` | opcional | Senha do certificado |

> **Importante**: o build do Vite embarca as variáveis `VITE_*` no bundle. Após mudar uma env var, faça **redeploy**.

#### 3. Deploy

1. Clique em **Deploy**.
2. Aguarde 2 a 5 minutos (build + cold start das Edge Functions).
3. URL padrão: `https://prontoclinic-hub.vercel.app` (ou o nome que você escolheu).

#### 4. Domínio customizado

1. **Settings → Domains → Add**.
2. Informe `app.suaclinica.com.br`.
3. Configure o DNS conforme instruído:
   - **CNAME** `app` → `cname.vercel-dns.com` (subdomínio), ou
   - **A record** no apex → `76.76.21.21`.
4. Aguarde propagação (até 48 h, geralmente minutos).
5. Vercel provisiona automaticamente o certificado Let's Encrypt.

#### 5. Preview Deploys

Cada pull request gera um **Preview Deployment** com URL própria. Use para validar mudanças com a equipe antes de promover para produção.

#### 6. Worker de notificações

O worker Node.js (que dispara e-mails/WhatsApp/SMS) **não** roda na Vercel. Faça deploy dele em Railway, Fly.io ou um VPS (veja Opção 3 ou 4).

---

## Opção 2: Netlify

Quase idêntica à Vercel.

### Passo a passo

1. Acesse [netlify.com](https://netlify.com) → **Add new site → Import an existing project**.
2. Conecte ao GitHub e selecione o repo.
3. Configure:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Em **Site settings → Build & deploy → Environment**, adicione as mesmas variáveis da Opção 1.
5. Clique **Deploy site**.
6. Para domínio próprio: **Domain settings → Add custom domain** + DNS.

**Vantagem**: forms nativos, identity (pode substituir Supabase Auth para casos simples). **Desvantagem**: Edge Functions limitadas comparadas à Vercel.

---

## Opção 3: Docker + VPS

Para quem quer controle total e rodar o worker Node.js junto com o app.

### Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### nginx.conf

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Headers de segurança
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co https://viacep.com.br wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

  # Compressão
  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;
  gzip_min_length 1024;

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
  }

  # Cache de assets com hash
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Service worker
  location = /sw.js {
    add_header Cache-Control "no-cache";
    add_header Service-Worker-Allowed "/";
  }

  # Manifest PWA
  location = /manifest.webmanifest {
    add_header Cache-Control "public, max-age=3600";
  }
}
```

### docker-compose.yml

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - worker

  worker:
    image: node:20-alpine
    restart: unless-stopped
    working_dir: /app
    volumes:
      - .:/app
    command: sh -c "npm ci && node dist/worker/notifications.js"
    environment:
      SUPABASE_URL: ${VITE_SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      RESEND_API_KEY: ${VITE_RESEND_API_KEY}
      ZAPI_INSTANCE_ID: ${VITE_ZAPI_INSTANCE_ID}
      ZAPI_TOKEN: ${VITE_ZAPI_TOKEN}
      TWILIO_ACCOUNT_SID: ${VITE_TWILIO_ACCOUNT_SID}
      TWILIO_AUTH_TOKEN: ${VITE_TWILIO_AUTH_TOKEN}
      TWILIO_FROM: ${VITE_TWILIO_FROM}
    env_file:
      - .env

  # Postgres só para dev local (em prod use Supabase gerenciado)
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    profiles: ["local"]

volumes:
  pgdata:
```

### Deploy

```bash
ssh usuario@servidor
git clone https://github.com/sua-org/prontoclinic-hub.git
cd prontoclinic-hub

# Configurar env
cp .env.example .env
nano .env   # preencher TODAS as variáveis

# Subir app + worker
docker compose up -d --build

# Verificar logs
docker compose logs -f app
docker compose logs -f worker

# Configurar HTTPS (Let's Encrypt)
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d app.suaclinica.com.br
```

---

## Opção 4: Servidor Próprio (PM2 + Nginx)

Mais leve que Docker, mas exige Node.js e Nginx já instalados.

### Pré-requisitos no servidor

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

# PM2 global
sudo npm install -g pm2

# Build do frontend
git clone https://github.com/sua-org/prontoclinic-hub.git
cd prontoclinic-hub
cp .env.example .env && nano .env
npm ci
npm run build
```

### ecosystem.config.js (PM2)

```javascript
module.exports = {
  apps: [
    {
      name: 'prontoclinic-web',
      script: 'npx',
      args: 'serve dist -l 3000',
      instances: 1,
      autorestart: true,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'prontoclinic-worker',
      script: './dist/worker/notifications.js',
      instances: 1,
      autorestart: true,
      env_file: '.env'
    }
  ]
};
```

### Comandos PM2

```bash
# Iniciar
pm2 start ecosystem.config.js

# Salvar para auto-start no boot
pm2 save
pm2 startup systemd

# Monitorar
pm2 monit

# Logs
pm2 logs prontoclinic-worker --lines 200

# Reload sem downtime
pm2 reload prontoclinic-web
```

### Nginx (sites-available/app)

```nginx
server {
  listen 80;
  server_name app.suaclinica.com.br;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name app.suaclinica.com.br;

  ssl_certificate /etc/letsencrypt/live/app.suaclinica.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/app.suaclinica.com.br/privkey.pem;

  root /var/www/prontoclinic-hub/dist;
  index index.html;

  # Headers (mesmos do nginx.conf acima)
  # ... (repetir bloco add_header do exemplo Docker)

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### HTTPS com Let's Encrypt

```bash
sudo certbot --nginx -d app.suaclinica.com.br
```

---

## Pós-Deploy Checklist

Antes de abrir para usuários, valide TODOS os itens abaixo:

- [ ] HTTPS configurado (Let's Encrypt ou Vercel/Netlify)
- [ ] HSTS ativo (`max-age=63072000`)
- [ ] CSP strict sem `unsafe-inline` em produção
- [ ] `X-Frame-Options: DENY` (anti-clickjacking)
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] Backup automático do Supabase (Point-in-Time Recovery habilitado)
- [ ] Monitoramento configurado (Sentry + UptimeRobot)
- [ ] Logs centralizados (papertrail / logtail / CloudWatch)
- [ ] Worker de notificações rodando (PM2 / Docker / Railway)
- [ ] Variáveis de ambiente preenchidas em produção
- [ ] **Nenhuma** credencial default (`orthanc/orthanc`, `postgres/postgres`, etc)
- [ ] Domínio apontando e SSL válido (ssllabs.com = A ou A+)
- [ ] Smoke test E2E passando em staging
- [ ] Teste de carga básico (k6 / Artillery) — 100 RPS sem erro
- [ ] Runbook de incidente documentado
- [ ] Política de retenção de logs definida
- [ ] Política de backup testada (restore real pelo menos uma vez)
- [ ] LGPD: DPO definido, política de privacidade publicada, consentimento explícito ativo
- [ ] Termos de uso publicados
- [ ] DNS CAA record configurado restringindo emissores de certificado

---

## Rollback

### Vercel / Netlify

**Opção A**: reverter via Git

```bash
git revert HEAD
git push  # dispara novo deploy
```

**Opção B**: promover um deploy anterior via dashboard (Deployments → Promote to Production).

### Docker

```bash
docker compose down
git checkout <tag-anterior>
docker compose up -d --build
```

### PM2 + Servidor Próprio

```bash
cd /var/www/prontoclinic-hub
git fetch --tags
git checkout <tag-anterior>
npm ci && npm run build
pm2 reload prontoclinic-web
```

### Supabase (migrations)

Se a migration foi problemática:

```bash
# Listar migrations aplicadas
supabase migration list

# Reverter manualmente (criar migration de rollback!)
supabase db reset --linked  # CUIDADO: apaga dados em dev
```

> **Nunca** edite migrations já aplicadas. Crie uma nova migration de rollback.

---

## Ambientes recomendados

| Ambiente | URL | Branch | Banco |
|---|---|---|---|
| Local | `http://localhost:5173` | `main` / feature branches | Supabase local (Docker) |
| Staging / Homologação | `https://staging.suaclinica.com.br` | `develop` | Supabase projeto `staging` |
| Produção | `https://app.suaclinica.com.br` | `main` | Supabase projeto `production` (PITR habilitado) |

Cada ambiente tem suas próprias env vars e credenciais TISS (`HOMOLOGACAO` vs `PRODUCAO`).

---

## Próximos passos

- Configurar **CI/CD** (GitHub Actions) para build/test/deploy automático (veja `.github/workflows/ci.yml`).
- Configurar **monitoramento sintético** (Sentry + UptimeRobot).
- Configurar **alertas** no Supabase para uso de CPU/connections.
- Documentar **runbook de incidente** em `docs/RUNBOOK.md`.
- Revisar **custos** mensalmente: Supabase, Vercel, Resend, Z-API, Twilio, Orthanc (se hospedado).