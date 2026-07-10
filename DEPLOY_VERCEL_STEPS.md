# ðŸš€ DEPLOY VERCEL - PASSO A PASSO PARA O USUÃRIO

**Status atual (2026-06-25):** âœ… Site NO AR em https://prontoclinic-hub.vercel.app/ (HTTP 200)
**Bloqueio:** Env vars nÃ£o configuradas â†’ login nÃ£o funciona

---

## âš™ï¸ 1. CONFIGURAR ENV VARS (CRÃTICO - 3 min)

### OpÃ§Ã£o A: Via Dashboard (MAIS FÃCIL)
1. Abrir https://vercel.com/dashboard
2. Clicar no projeto **prontoclinic-hub**
3. **Settings** â†’ **Environment Variables**
4. Adicionar as 10 variÃ¡veis abaixo (Production):

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` |
| `VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
| `VITE_APP_NAME` | `ProntoClinic Hub` |
| `VITE_APP_ENV` | `production` |
| `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` |
| `VITE_TISS_VERSION` | `3.05.00` |
| `VITE_DICOM_BUCKET` | `dicom` |
| `VITE_ENABLE_TELEMEDICINE` | `false` |
| `VITE_ENABLE_WHATSAPP` | `false` |
| `VITE_RESEND_API_KEY` | `(em branco ou dummy)` |

5. Clicar **"Save"**
6. **Deployments** â†’ clicar nos 3 pontos do Ãºltimo â†’ **"Redeploy"**
7. Aguardar 2-3 min â†’ site recarregado com env vars

---

## ðŸŒ 2. ADICIONAR DOMÃNIO CUSTOMIZADO (10 min)

### OpÃ§Ã£o A: Comprar domÃ­nio .com.br
1. Acessar https://registro.br/dominio/pesquisa/
2. Buscar `prontoclinic.com.br` (ou variaÃ§Ãµes: `prontoclinic.med.br`, `medilife.app.br`)
3. Comprar por R$ 40/ano via PIX (aprovaÃ§Ã£o em ~10 min)
4. ApÃ³s aprovado, ir em **DNS** no painel Registro.br

### Configurar DNS (no painel Registro.br)
| Tipo | Host | Valor |
|---|---|---|
| A | (vazio, apex) | `76.76.21.21` |
| CNAME | www | `cname.vercel-dns.com` |

### Adicionar no Vercel
1. https://vercel.com/dashboard â†’ projeto `prontoclinic-hub`
2. **Settings** â†’ **Domains** â†’ **Add** `prontoclinic.com.br`
3. Vercel valida DNS automaticamente
4. SSL/TLS provisionado (Let's Encrypt) automaticamente
5. **Pronto!** URL final: **https://prontoclinic.com.br**

---

## âœ… 3. VALIDAÃ‡ÃƒO FINAL

ApÃ³s configurar env vars e redeployar:
1. Acessar https://prontoclinic-hub.vercel.app
2. Tela de login deve aparecer com form completo
3. Login: `luizjuniormedi@gmail.com` / `<ADMIN_TEMP_PASSWORD>`
4. Dashboard deve carregar com nome real "POLICLINICA MEDILIFE DIAGNOSTICOS LTDA"
5. Listas devem mostrar: 8 unidades, 50k+ pacientes, 144 profissionais

Se a UI **NÃƒO** carregar dados:
- Abrir DevTools (F12) â†’ Console
- Verificar se hÃ¡ erro CORS, env var faltando, ou 401/403
- Me avisar para corrigir

---

## ðŸ›’ COMPRAR DOMÃNIO .COM (alternativa)

Se preferir domÃ­nio internacional (nÃ£o brasileiro):
- **Cloudflare Registrar**: $9-10/ano (~R$ 50)
- **Namecheap**: $9-13/ano
- **Porkbun**: $8-10/ano

DNS no Vercel Ã© o mesmo (`A` apex + `CNAME` www).

---

## ðŸ“Š PRÃ“XIMOS PASSOS DEPOIS DO DEPLOY

1. **Configurar CI/CD** (jÃ¡ feito automaticamente pelo Vercel via GitHub App)
2. **Habilitar Vercel Analytics** (Settings â†’ Analytics â†’ Enable) - grÃ¡tis
3. **Configurar branch protection** no GitHub (Settings â†’ Branches â†’ main â†’ Require 1 review)
4. **Adicionar domÃ­nio prÃ³prio** (seÃ§Ã£o 2 acima)
5. **Configurar email** (Resend API) - 5 min
6. **Provisionar Orthanc PACS** em produÃ§Ã£o (VPS ou cloud) - 30 min
7. **Upgrade Supabase para Pro** ($25/mÃªs) - para suportar 555k+ registros

---

## ðŸ”„ RESUMO DE TIMELINE

- **AGORA**: Site no ar em vercel.app (3 min de import) âœ…
- **+3 min**: Configurar env vars â†’ login funcional
- **+30 min**: Comprar + configurar domÃ­nio prÃ³prio â†’ produÃ§Ã£o completa

**Custo total:** R$ 0 (Vercel Hobby) + R$ 40/ano (domÃ­nio .com.br) = R$ 40/ano

---

## â“ PERGUNTAS FREQUENTES

**P: Por que o site mostra "ProntoMedic" e nÃ£o "ProntoClinic"?**
R: O tÃ­tulo do HTML estÃ¡ em `index.html` linha 32 como `<title>ProntoMedic</title>`. Para mudar, edite o arquivo e faÃ§a commit.

**P: Posso usar domÃ­nio .app.br ou .med.br?**
R: Sim! Registro.br vende qualquer extensÃ£o. .app.br e .med.br custam o mesmo (~R$ 40/ano).

**P: E se eu quiser usar Cloudflare em vez de Registro.br?**
R: Cloudflare Registrar cobra ~US$ 9/ano em .com (preÃ§o de custo). Mesma configuraÃ§Ã£o de DNS.

**P: Como testar localmente antes de fazer deploy?**
R: `cd` no projeto e `npm run dev` â†’ http://localhost:8080

---

## ðŸ“ž SUPORTE

Se tiver dÃºvidas durante o processo, me chame!

