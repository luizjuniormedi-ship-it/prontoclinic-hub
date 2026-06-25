# Deploy ProntoClinic Hub - Vercel (CI/CD Automatizado)

**Status (2026-06-25):** Site online em https://prontoclinic-hub.vercel.app/ (HTTP 200, deploy automatico via Vercel GitHub App).
**Workflow CI/CD:** `.github/workflows/deploy.yml` (Pronto para Vercel Action).
**Stack:** Vite 7 + React 18 + Supabase + Vercel Edge (gru1).

---

## Sumario

1. [Estado atual](#estado-atual)
2. [Secrets necessarios no GitHub](#1-secrets-necessarios-no-github)
3. [Como gerar o VERCEL_TOKEN](#2-como-gerar-o-vercel_token)
4. [Como obter ORG_ID e PROJECT_ID](#3-como-obter-org_id-e-project_id)
5. [Configurar env vars na Vercel](#4-configurar-env-vars-na-vercel)
6. [Disparar o primeiro deploy via CI](#5-disparar-o-primeiro-deploy-via-ci)
7. [Adicionar dominio customizado](#6-adicionar-dominio-customizado)
8. [Plano de contingencia](#7-plano-de-contingencia)
9. [Custos e proximos passos](#8-custos-e-proximos-passos)

---

## Estado atual

| Item | Status |
|---|---|
| Site `prontoclinic-hub.vercel.app` | Online (HTTP 200) |
| Deploy automatico via Vercel GitHub App | Ativo |
| Build | Vite, `npm run build` → `dist/` |
| Framework declarado | `vite` em `vercel.json` |
| Rewrites SPA | `/(.*) → /index.html` |
| Cache de SW | `sw.js` com no-cache |
| Assets imutaveis | Cache 1 ano em `/assets/*` |
| Headers de seguranca | HSTS, X-Frame-Options, Permissions-Policy, nosniff |
| Regiao | `gru1` (Sao Paulo) |
| Branch de deploy | `main` |
| Workflow `.github/workflows/deploy.yml` | Pronto para `vercel-action@v25` |

---

## 1. Secrets necessarios no GitHub

Acesse **GitHub → repositorio `prontoclinic-hub` → Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Descricao | Obrigatorio? |
|---|---|---|
| `VERCEL_TOKEN` | Token pessoal Vercel (link abaixo) | Sim |
| `VERCEL_ORG_ID` | ID da organizacao/projeto pessoal | Sim |
| `VERCEL_PROJECT_ID` | ID do projeto ProntoClinic | Sim |
| `VITE_SUPABASE_URL` | URL publica do Supabase | Sim (para o build) |
| `VITE_SUPABASE_ANON_KEY` | Chave anon publica | Sim (para o build) |

> Os secrets `VITE_*` sao usados no passo `Build SPA` para que o `import.meta.env` receba os valores corretos no bundle final. Se ausentes, o build usa os defaults do `.env.example` (Voce sera avisado no log).

### Como adicionar (5 min)

1. Abrir https://github.com/luizjuniormedi-ship-it/prontoclinic-hub/settings/secrets/actions
2. Clicar **"New repository secret"**
3. Preencher Name + Value, clicar **"Add secret"**
4. Repetir para cada um

---

## 2. Como gerar o VERCEL_TOKEN

1. Abrir https://vercel.com/account/tokens
2. Clicar **"Create Token"**
3. **Name:** `github-actions-prontoclinic`
4. **Scope:** Full Access (ou Limited → ProntoClinic project)
5. **Expiration:** Sem expiracao (ou 1 ano)
6. Clicar **"Create"**
7. **Copiar o token** (nao sera mostrado de novo)
8. Colar no GitHub Secret `VERCEL_TOKEN`

---

## 3. Como obter ORG_ID e PROJECT_ID

### Opcao A: Vercel CLI (recomendado, 2 min)

```bash
# Instalar CLI
npm i -g vercel

# Login
vercel login

# Linkar (uma vez, na raiz do projeto)
cd prontoclinic-hub
vercel link

# Mostrar IDs
cat .vercel/project.json
```

Sera exibido:
```json
{
  "orgId": "team_xxxxxxxxxxxxxxxx",
  "projectId": "prj_xxxxxxxxxxxxxxxx"
}
```

### Opcao B: Pelo dashboard

1. https://vercel.com/dashboard
2. Clicar no projeto **prontoclinic-hub**
3. **Settings** → **General**
4. Rolar ate **"Project ID"** e **"Team ID"** (ou "User ID" se for conta pessoal)
5. Sao UUIDs/IDs com prefixo `prj_` e `team_`

---

## 4. Configurar env vars na Vercel

### Opcao A: Via Dashboard (MAIS FACIL, 5 min)

1. Abrir https://vercel.com/dashboard → projeto **prontoclinic-hub**
2. **Settings** → **Environment Variables**
3. Para cada variavel, clicar **"Add New"**:
   - **Key:** `VITE_SUPABASE_URL`
   - **Value:** `https://rhqgwrarkotjzdcrkbgn.supabase.co`
   - **Environments:** Production (e Preview se quiser)
4. Repetir para todas (ver tabela abaixo)

| Key | Value (sugestao) | Environments |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` | Production |
| `VITE_SUPABASE_ANON_KEY` | (anon key publica do Supabase) | Production |
| `VITE_APP_NAME` | `ProntoClinic Hub` | All |
| `VITE_APP_ENV` | `production` | Production |
| `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` | All |
| `VITE_TISS_VERSION` | `3.05.00` | All |
| `VITE_DICOM_BUCKET` | `dicom` | All |
| `VITE_ENABLE_TELEMEDICINE` | `false` | All |
| `VITE_ENABLE_WHATSAPP` | `false` | All |
| `VITE_RESEND_API_KEY` | (opcional) | Production |

5. Clicar **"Save"**
6. Acionar **Redeploy** em **Deployments → ⋯ → Redeploy**

### Opcao B: Via script (apos `vercel login`)

```bash
# Gera .env.example.vercel (template, sem valores reais)
bash scripts/setup_vercel_env.sh --example

# Mostra o plano de aplicacao
bash scripts/setup_vercel_env.sh --plan

# Aplica de verdade (apos vercel link)
bash scripts/setup_vercel_env.sh
```

### Opcao C: Vercel CLI one-liner

```bash
# Substituir pelos valores reais:
vercel env add VITE_SUPABASE_URL production <<< "https://rhqgwrarkotjzdcrkbgn.supabase.co"
vercel env add VITE_SUPABASE_ANON_KEY production <<< "<SUA_ANON_KEY>"
# ... repetir para cada var
```

---

## 5. Disparar o primeiro deploy via CI

O workflow `.github/workflows/deploy.yml` esta pronto. Ele dispara em:
- Push em `main` (automatica apos cada merge)
- Manualmente: GitHub → Actions → "Deploy ProntoClinic Hub to Vercel" → **Run workflow**

### Fluxo

1. **Checkout** do codigo
2. **Setup Node 20** + `npm ci`
3. **Gerar PWA icons**
4. **Type check** (tsc --noEmit)
5. **Lint** (eslint)
6. **Build** (vite build)
7. **Deploy Vercel** via `amondnet/vercel-action@v25` (production)

### Verificar

1. GitHub → Actions → ver workflow rodando
2. Clicar no run para ver logs detalhados
3. Ao final: URL do deploy em `${{ steps.deploy.outputs.url }}`
4. Confirmar https://prontoclinic-hub.vercel.app/ funcionando

---

## 6. Adicionar dominio customizado

### Recomendado: Registro.br (`.com.br`, R$ 40/ano)

1. Comprar em https://registro.br/dominio/pesquisa/ (ex: `prontoclinic.com.br`)
2. Apos aprovado, no painel Registro.br → **DNS** → adicionar:

| Tipo | Host | Valor |
|---|---|---|
| `A` | (vazio, apex) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

3. Vercel → **Settings → Domains → Add** → `prontoclinic.com.br`
4. Vercel valida DNS (5-30 min) e provisiona SSL/TLS (Let's Encrypt) automaticamente
5. **Pronto:** https://prontoclinic.com.br ativo com HTTPS

### Alternativas

- **Cloudflare Registrar:** `.com` por ~US$ 9/ano (preco de custo)
- **Namecheap / Porkbun:** `.com` por US$ 8-13/ano
- **Subdominio gratis:** `prontoclinic.vercel.app` (ja ativo)

### Multiplos dominios

Voce pode adicionar varios dominios ao mesmo projeto. Vercel serve o mesmo conteudo para todos (HTTPS automatico). Exemplo:
- `prontoclinic.com.br` (principal)
- `www.prontoclinic.com.br` (redirect → apex)
- `prontoclinic.med.br` (alternativo)

---

## 7. Plano de contingencia

### Se o deploy CI falhar

1. GitHub Actions → ver log do step que falhou
2. Causas comuns:
   - `VERCEL_TOKEN` expirado/invalido → regenerar
   - `VERCEL_PROJECT_ID` errado → rodar `vercel link` localmente
   - Build falhou (tsc/lint) → corrigir e fazer novo push
3. Workaround: deploy manual via `vercel deploy --prod` na sua maquina

### Se o site carregar mas login nao funcionar

1. Abrir DevTools (F12) → Console
2. Verificar se ha erro CORS ou 401
3. Causa provavel: env vars nao configuradas → voltar para secao 4

### Se o deploy ficar preso em "Building"

1. Vercel Dashboard → Deployments → Cancelar
2. Disparar novamente (Redeploy)
3. Se persistir, abrir ticket com Vercel Support

### Se precisar rollback rapido

1. Vercel Dashboard → Deployments
2. Encontrar um deploy anterior funcional
3. Clicar **⋯** → **"Promote to Production"**
4. Site volta em ~30s

---

## 8. Custos e proximos passos

### Custos mensais (producao)

| Servico | Plano | Custo |
|---|---|---|
| Vercel (Hobby) | 100 GB bandwidth, 6k builds/mes | **$0** |
| Supabase (Free) | 500 MB DB, 1 GB storage, 50k MAU | **$0** (ate 555k registros = Pro) |
| Supabase (Pro) | 8 GB DB, 100 GB storage, 100k MAU | **$25/mes** |
| Dominio `.com.br` | Registro.br anual | **R$ 40/ano** |
| **Total (Free tier)** | ate ~10k pacientes | **~R$ 200/ano** |
| **Total (Pro tier)** | ate 555k+ registros | **~R$ 350/mes + R$ 40/ano** |

### Proximos passos (ordem de prioridade)

1. **AGORA:** Configurar secrets (5 min) → CI/CD 100% automatizado
2. **+1h:** Comprar dominio `.com.br` (R$ 40) → presenca profissional
3. **+1 dia:** Configurar Resend API para emails transacionais
4. **+1 semana:** Provisionar Orthanc PACS (VPS ou Docker cloud)
5. **+2 semanas:** Upgrade Supabase para Pro (se dados > 500 MB)
6. **+1 mes:** Vercel Analytics + Web Vitals monitoring
7. **+2 meses:** Sentry/error tracking (free tier)
8. **+3 meses:** Backups automaticos Supabase (Pro)

### Limites do Hobby (Vercel)

- 100 GB bandwidth/mes (suficiente para ~50k page views)
- 6.000 build seconds/mes (suficiente para ~200 deploys)
- 100 GB-hours de Functions (se usar Edge Functions)
- **Nao pode** ser usado para fins comerciais segundo TOS (uso pessoal/side project)
- Para uso comercial, migrar para **Vercel Pro** ($20/mes)

### Upgrade para Pro (quando necessario)

- Settings → Billing → **"Upgrade to Pro"**
- $20/mes por membro
- Sem limites de uso comercial
- Suporte prioritario
- Web Analytics avancado

---

## Arquivos relacionados

- `vercel.json` - Build config + headers de seguranca + rewrites SPA
- `.github/workflows/deploy.yml` - CI/CD automatizado (Vercel Action v25)
- `.github/workflows/ci.yml` - CI (testes + lint) - roda em PRs
- `scripts/setup_vercel_env.sh` - Script one-shot para env vars
- `DEPLOY_VERCEL_STEPS.md` - Guia manual (alternativa)
- `.env.example` - Template local de env vars
- `.env.production` - Valores de producao (NAO commitado)

---

## Validacao final (apos seguir este guia)

- [x] Site em https://prontoclinic-hub.vercel.app/ (HTTP 200, 3463 bytes)
- [x] vercel.json com HSTS, X-Frame-Options DENY, Permissions-Policy
- [x] Rewrites SPA funcionando (rotas client-side)
- [x] Build artifacts em `dist/` (index.html + assets/)
- [ ] Secrets GitHub configurados (5 secrets)
- [ ] VERCEL_TOKEN gerado em vercel.com/account/tokens
- [ ] ORG_ID e PROJECT_ID em GitHub Secrets
- [ ] Env vars Supabase no Vercel Dashboard
- [ ] Workflow CI disparou e deployou via vercel-action
- [ ] Dominio customizado configurado
- [ ] Email Resend (opcional)

---

## Suporte

- **Vercel:** https://vercel.com/support
- **GitHub Actions:** https://docs.github.com/actions
- **Vercel Action:** https://github.com/amondnet/vercel-action
- **Registro.br:** https://registro.br/suporte/

Se travar em algum passo, abrir issue no repo ou me chamar!
