# Guia de Instalação

Este guia cobre a instalação completa do ProntoMedic em ambiente de desenvolvimento, homologação e produção.

## Pré-requisitos

### 1. Sistema operacional

- **Linux** (Ubuntu 22.04+ recomendado) — produção
- **macOS** 12+ — desenvolvimento
- **Windows 11 com WSL2** — desenvolvimento

### 2. Software

| Software | Versão | Obrigatório |
|---|---|---|
| Node.js | 20 LTS | Sim |
| npm | 10+ (ou pnpm 8+) | Sim |
| Git | 2.30+ | Sim |
| Supabase CLI | latest | Sim |
| Docker | 24+ | Opcional (Supabase local) |
| Python | 3.12+ | Opcional (scripts de migração SIGH) |
| PostgreSQL client | 16 | Sim (psql para seeds) |

### 3. Contas externas

| Serviço | Função | Plano gratuito |
|---|---|---|
| Supabase | Auth, DB, Storage, Realtime | Sim (free tier) |
| Resend | Envio de e-mail transacional | Sim (100/dia) |
| Twilio | SMS | Não (pay-as-you-go) |
| Z-API | WhatsApp Business API | Não (pay-as-you-go) |
| Daily.co | Telemedicina (opcional) | Sim (limitado) |
| Orthanc | PACS DICOM (opcional) | Sim (self-hosted) |

## Instalação passo a passo

### Passo 1: Clonar o repositório

```bash
git clone https://github.com/seu-usuario/prontoclinic-hub.git
cd prontoclinic-hub
```

### Passo 2: Criar projeto no Supabase

1. Acesse https://supabase.com/dashboard
2. Clique em "New Project"
3. Defina nome, senha do banco e região
4. Aguarde provisionamento (~2 min)
5. Anote:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (NUNCA expor no client)
   - `Project Ref` → referência para CLI

### Passo 3: Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```bash
# Supabase
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-side only

# E-mail (Resend)
RESEND_API_KEY=re_...
VITE_RESEND_FROM="ProntoMedic <noreply@seudominio.com.br>"

# SMS / WhatsApp (Twilio / Z-API)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+55...
ZAPI_INSTANCE_ID=...
ZAPI_TOKEN=...

# DICOM (opcional)
VITE_ORTHANC_URL=http://localhost:8042
ORTHANC_USERNAME=orthanc
ORTHANC_PASSWORD=orthanc

# App
VITE_APP_URL=http://localhost:5173
```

### Passo 4: Aplicar migrations

```bash
# Login no Supabase
supabase login

# Linkar com seu projeto
supabase link --project-ref SEU_PROJECT_REF

# Aplicar migrations (11 migrations)
supabase db push
```

Em seguida, opcionalmente carregue os seeds:

```bash
psql $DATABASE_URL -f supabase/seed_payment_sources.sql
psql $DATABASE_URL -f supabase/seed_insurances.sql
psql $DATABASE_URL -f supabase/seed_categories.sql
psql $DATABASE_URL -f supabase/seed_notification_templates.sql
```

### Passo 5: Instalar dependências

```bash
npm install
# ou
pnpm install
```

### Passo 6: Validar setup

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint

# Testes unitários
npm run test

# Testes E2E
npm run test:e2e
```

### Passo 7: Iniciar dev server

```bash
npm run dev
# Acesse http://localhost:5173
```

## Build de produção

```bash
npm run build      # Gera bundle otimizado em dist/
npm run preview    # Serve bundle localmente para teste
```

A build inclui:
- Geração de ícones PWA (`npm run icons`)
- Bundle Vite minificado
- Service Worker com cache strategy
- Manifest PWA

## Deploy

### Opção 1: Vercel (recomendado)

1. Conecte o repositório no dashboard da Vercel
2. Configure as env vars em Project Settings > Environment Variables
3. Build command: `npm run build`
4. Output directory: `dist`
5. Deploy automático a cada push na `main`

```bash
# Deploy manual via CLI
npm i -g vercel
vercel
```

### Opção 2: Netlify

1. Conecte o repositório no dashboard do Netlify
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Configure as env vars
5. Deploy automático

### Opção 3: Servidor próprio (PM2 + Nginx)

```bash
# No servidor (Ubuntu 22.04+)
git clone https://github.com/seu-usuario/prontoclinic-hub.git /opt/prontomedic
cd /opt/prontomedic
npm ci --production
npm run build
```

Crie `/etc/nginx/sites-available/prontomedic`:

```nginx
server {
  listen 80;
  server_name app.prontomedic.com.br;

  root /opt/prontomedic/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # Cache de assets com hash
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

Ative e reinicie:

```bash
sudo ln -s /etc/nginx/sites-available/prontomedic /etc/nginx/sites-enabled/
sudo certbot --nginx -d app.prontomedic.com.br
sudo systemctl reload nginx
```

### Opção 4: Docker

```dockerfile
# Dockerfile (exemplo)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
docker build -t prontomedic:latest .
docker run -d -p 8080:80 --name prontomedic prontomedic:latest
```

## Pós-deploy

### Checklist de produção

- [ ] HTTPS configurado (Let's Encrypt)
- [ ] Variáveis de ambiente seguras (não commitadas)
- [ ] Backups automáticos do Supabase habilitados
- [ ] Monitoring configurado (Sentry, LogRocket, etc.)
- [ ] Rate limiting configurado
- [ ] CORS do Supabase restrito ao domínio
- [ ] 2FA habilitado para admins
- [ ] Logs centralizados
- [ ] Política de retenção LGPD aplicada
- [ ] Auditoria de acesso ativa (CFM 1.821/2007)

## Troubleshooting

| Problema | Solução |
|---|---|
| `supabase db push` falha | Verifique `DATABASE_URL` e se o projeto está ativo |
| `npm run dev` retorna 5173 in use | Mate o processo: `lsof -ti:5173 \| xargs kill` |
| Build quebra com "out of memory" | Aumente Node memory: `NODE_OPTIONS=--max-old-space-size=4096 npm run build` |
| RLS bloqueando queries | Verifique policies; use service_role key só server-side |
| PWA não instala | Verifique manifest e HTTPS (PWA exige HTTPS) |

## Próximos passos

- Leia [MANUAL.md](MANUAL.md) para usar o sistema
- Leia [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir
- Leia [SECURITY.md](SECURITY.md) para reportar vulnerabilidades
