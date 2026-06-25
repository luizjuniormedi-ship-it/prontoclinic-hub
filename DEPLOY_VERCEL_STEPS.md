# 🚀 DEPLOY VERCEL - PASSO A PASSO PARA O USUÁRIO

**Status atual (2026-06-25):** ✅ Site NO AR em https://prontoclinic-hub.vercel.app/ (HTTP 200)
**Bloqueio:** Env vars não configuradas → login não funciona

---

## ⚙️ 1. CONFIGURAR ENV VARS (CRÍTICO - 3 min)

### Opção A: Via Dashboard (MAIS FÁCIL)
1. Abrir https://vercel.com/dashboard
2. Clicar no projeto **prontoclinic-hub**
3. **Settings** → **Environment Variables**
4. Adicionar as 10 variáveis abaixo (Production):

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDEyMDksImV4cCI6MjA5Nzg3NzIwOX0.hwaGsz3wK1nq6aNXZDYJ_fOxpHI14eIvYB6ObQqx5gE` |
| `VITE_APP_NAME` | `ProntoClinic Hub` |
| `VITE_APP_ENV` | `production` |
| `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` |
| `VITE_TISS_VERSION` | `3.05.00` |
| `VITE_DICOM_BUCKET` | `dicom` |
| `VITE_ENABLE_TELEMEDICINE` | `false` |
| `VITE_ENABLE_WHATSAPP` | `false` |
| `VITE_RESEND_API_KEY` | `(em branco ou dummy)` |

5. Clicar **"Save"**
6. **Deployments** → clicar nos 3 pontos do último → **"Redeploy"**
7. Aguardar 2-3 min → site recarregado com env vars

---

## 🌐 2. ADICIONAR DOMÍNIO CUSTOMIZADO (10 min)

### Opção A: Comprar domínio .com.br
1. Acessar https://registro.br/dominio/pesquisa/
2. Buscar `prontoclinic.com.br` (ou variações: `prontoclinic.med.br`, `medilife.app.br`)
3. Comprar por R$ 40/ano via PIX (aprovação em ~10 min)
4. Após aprovado, ir em **DNS** no painel Registro.br

### Configurar DNS (no painel Registro.br)
| Tipo | Host | Valor |
|---|---|---|
| A | (vazio, apex) | `76.76.21.21` |
| CNAME | www | `cname.vercel-dns.com` |

### Adicionar no Vercel
1. https://vercel.com/dashboard → projeto `prontoclinic-hub`
2. **Settings** → **Domains** → **Add** `prontoclinic.com.br`
3. Vercel valida DNS automaticamente
4. SSL/TLS provisionado (Let's Encrypt) automaticamente
5. **Pronto!** URL final: **https://prontoclinic.com.br**

---

## ✅ 3. VALIDAÇÃO FINAL

Após configurar env vars e redeployar:
1. Acessar https://prontoclinic-hub.vercel.app
2. Tela de login deve aparecer com form completo
3. Login: `luizjuniormedi@gmail.com` / `07114575`
4. Dashboard deve carregar com nome real "POLICLINICA MEDILIFE DIAGNOSTICOS LTDA"
5. Listas devem mostrar: 8 unidades, 50k+ pacientes, 144 profissionais

Se a UI **NÃO** carregar dados:
- Abrir DevTools (F12) → Console
- Verificar se há erro CORS, env var faltando, ou 401/403
- Me avisar para corrigir

---

## 🛒 COMPRAR DOMÍNIO .COM (alternativa)

Se preferir domínio internacional (não brasileiro):
- **Cloudflare Registrar**: $9-10/ano (~R$ 50)
- **Namecheap**: $9-13/ano
- **Porkbun**: $8-10/ano

DNS no Vercel é o mesmo (`A` apex + `CNAME` www).

---

## 📊 PRÓXIMOS PASSOS DEPOIS DO DEPLOY

1. **Configurar CI/CD** (já feito automaticamente pelo Vercel via GitHub App)
2. **Habilitar Vercel Analytics** (Settings → Analytics → Enable) - grátis
3. **Configurar branch protection** no GitHub (Settings → Branches → main → Require 1 review)
4. **Adicionar domínio próprio** (seção 2 acima)
5. **Configurar email** (Resend API) - 5 min
6. **Provisionar Orthanc PACS** em produção (VPS ou cloud) - 30 min
7. **Upgrade Supabase para Pro** ($25/mês) - para suportar 555k+ registros

---

## 🔄 RESUMO DE TIMELINE

- **AGORA**: Site no ar em vercel.app (3 min de import) ✅
- **+3 min**: Configurar env vars → login funcional
- **+30 min**: Comprar + configurar domínio próprio → produção completa

**Custo total:** R$ 0 (Vercel Hobby) + R$ 40/ano (domínio .com.br) = R$ 40/ano

---

## ❓ PERGUNTAS FREQUENTES

**P: Por que o site mostra "ProntoMedic" e não "ProntoClinic"?**
R: O título do HTML está em `index.html` linha 32 como `<title>ProntoMedic</title>`. Para mudar, edite o arquivo e faça commit.

**P: Posso usar domínio .app.br ou .med.br?**
R: Sim! Registro.br vende qualquer extensão. .app.br e .med.br custam o mesmo (~R$ 40/ano).

**P: E se eu quiser usar Cloudflare em vez de Registro.br?**
R: Cloudflare Registrar cobra ~US$ 9/ano em .com (preço de custo). Mesma configuração de DNS.

**P: Como testar localmente antes de fazer deploy?**
R: `cd` no projeto e `npm run dev` → http://localhost:8080

---

## 📞 SUPORTE

Se tiver dúvidas durante o processo, me chame!