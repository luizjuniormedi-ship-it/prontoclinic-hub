# ðŸš€ ProntoClinic Hub - VariÃ¡veis de Ambiente Vercel

**Data:** 25 de junho de 2026
**Projeto Vercel:** medilife1/prontoclinic-hub
**URL alvo:** https://prontoclinic-hub.vercel.app/
**Backend:** Supabase Cloud (rhqgwrarkotjzdcrkbgn) - POLICLINICA MEDILIFE

---

## âš ï¸ INSTRUÃ‡Ã•ES CRÃTICAS

**ATENÃ‡ÃƒO:** O Vercel pode ter traduzido os nomes das env vars. Use os nomes **EXATOS** abaixo (em inglÃªs, snake_case).

**Se a env var aparecer com nome traduzido** (ex: `VITE_HABILITAR_TELEMEDICINA`), vocÃª DEVE:
1. Apagar (botÃ£o â‹¯ â†’ Delete)
2. Recriar com o nome correto (em inglÃªs)
3. Confirmar ambiente: **ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o**

---

## ðŸ“‹ 8 VARIÃVEIS OBRIGATÃ“RIAS

### 1ï¸âƒ£ VITE_SUPABASE_URL
```
Key:    VITE_SUPABASE_URL
Value:  https://rhqgwrarkotjzdcrkbgn.supabase.co
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   ON (Confidencial)
```

### 2ï¸âƒ£ VITE_SUPABASE_ANON_KEY
```
Key:    VITE_SUPABASE_ANON_KEY
Value:  <SUPABASE_SERVICE_ROLE_KEY>
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   ON (Confidencial)
```

### 3ï¸âƒ£ VITE_APP_NAME
```
Key:    VITE_APP_NAME
Value:  ProntoClinic Hub
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   ON
```

### 4ï¸âƒ£ VITE_APP_ENV
```
Key:    VITE_APP_ENV
Value:  production
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF (nÃ£o Ã© sensÃ­vel)
```

### 5ï¸âƒ£ VITE_ENABLE_TELEMEDICINE
```
Key:    VITE_ENABLE_TELEMEDICINE  (NÃƒO VITE_HABILITAR_TELEMEDICINA)
Value:  false
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF
```

### 6ï¸âƒ£ VITE_ENABLE_WHATSAPP
```
Key:    VITE_ENABLE_WHATSAPP  (NÃƒO VITE_ATIVAR_WHATSAPP)
Value:  false
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF
```

### 7ï¸âƒ£ VITE_TISS_AMBIENTE
```
Key:    VITE_TISS_AMBIENTE
Value:  HOMOLOGACAO
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF
```

### 8ï¸âƒ£ VITE_TISS_VERSION
```
Key:    VITE_TISS_VERSION
Value:  3.05.00
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF
```

### 9ï¸âƒ£ VITE_DICOM_BUCKET
```
Key:    VITE_DICOM_BUCKET
Value:  dicom
Amb:    ProduÃ§Ã£o e PrÃ©-visualizaÃ§Ã£o
Conf:   OFF
```

---

## ðŸš€ MÃ‰TODO RÃPIDO: Importar via .env (1 CLIQUE)

### Passo 1: Cancelar env vars erradas (se houver)
Para cada env var com nome **traduzido**:
1. Clique nos **3 pontos (â‹¯)** da linha
2. Selecione **"Delete"** ou **"Remover"**
3. Confirme

### Passo 2: Importar .env limpo
1. Clique no botÃ£o **"Adicionar variÃ¡vel de ambiente"** (canto superior direito da lista)
2. No modal aberto, procure o botÃ£o **"Importar .env"** (canto inferior esquerdo)
3. **Cole exatamente este conteÃºdo** (copie tudo de uma vez):

```
VITE_SUPABASE_URL=https://rhqgwrarkotjzdcrkbgn.supabase.co
VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
VITE_APP_NAME=ProntoClinic Hub
VITE_APP_ENV=production
VITE_ENABLE_TELEMEDICINE=false
VITE_ENABLE_WHATSAPP=false
VITE_TISS_AMBIENTE=HOMOLOGACAO
VITE_TISS_VERSION=3.05.00
VITE_DICOM_BUCKET=dicom
```

4. Clique **"Salvar"** no canto inferior direito
5. A Vercel vai parsear e criar as 9 variÃ¡veis automaticamente

### Passo 3: Validar nomes
ApÃ³s importar, **verifique** que os nomes estÃ£o **EXATAMENTE** assim:
- âœ… `VITE_SUPABASE_URL`
- âœ… `VITE_SUPABASE_ANON_KEY`
- âœ… `VITE_APP_NAME`
- âœ… `VITE_APP_ENV`
- âœ… `VITE_ENABLE_TELEMEDICINE`
- âœ… `VITE_ENABLE_WHATSAPP`
- âœ… `VITE_TISS_AMBIENTE`
- âœ… `VITE_TISS_VERSION`
- âœ… `VITE_DICOM_BUCKET`

Se algum nome aparecer traduzido (com acentos, maiÃºsculas diferentes, etc), apague e recrie manualmente.

### Passo 4: Trigger Redeploy
1. No menu lateral esquerdo, clique em **"Deployments"**
2. Encontre o deploy mais recente (status atual pode ser "Ready")
3. Clique nos **3 pontos (â‹¯)** do lado direito do deploy
4. Selecione **"Redeploy"**
5. Confirme a aÃ§Ã£o
6. Aguarde **2-3 minutos** (Vercel rebuilda com as env vars)

### Passo 5: Validar
1. Abra em nova aba: https://prontoclinic-hub.vercel.app/
2. **Esperado**: Tela de login do ProntoClinic Hub aparece
3. **Login**: `luizjuniormedi@gmail.com` / `<ADMIN_TEMP_PASSWORD>`
4. **ApÃ³s login**: Dashboard com dados da POLICLINICA MEDILIFE

---

## ðŸ› SOLUÃ‡ÃƒO DE PROBLEMAS

### Problema: "Configuration is invalid - VITE_SUPABASE_URL: Required"
**Causa:** env var nÃ£o foi passada para o build
**SoluÃ§Ã£o:**
1. Verifique se as env vars estÃ£o marcadas como "Production" (nÃ£o apenas "Preview")
2. Verifique se os nomes estÃ£o **EXATAMENTE** como listado (sem acentos ou espaÃ§os)
3. Force um Redeploy (Deployments â†’ 3 pontos â†’ Redeploy)
4. Aguarde 3 minutos

### Problema: "Invalid login credentials"
**Causa:** usuÃ¡rio nÃ£o existe no Supabase Auth
**SoluÃ§Ã£o:**
1. Acessar: https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/auth/users
2. Verificar se `luizjuniormedi@gmail.com` existe
3. Se nÃ£o, criar via SQL Editor:
```sql
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES ('luizjuniormedi@gmail.com', crypt('<ADMIN_TEMP_PASSWORD>', gen_salt('bf')), NOW(), '{"full_name":"Admin Demo"}');
```

### Problema: "Hot Standby OFF" ou "Disco cheio"
**Causa:** Supabase Cloud Free (500MB) estÃ¡ cheio
**SoluÃ§Ã£o:**
1. Upgrade Supabase para Pro ($25/mÃªs) em https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/settings/billing
2. Aguardar 5 minutos
3. Supabase volta a aceitar conexÃµes

### Problema: Tela continua em branco apÃ³s Redeploy
**SoluÃ§Ã£o:**
1. Limpar cache do browser (Ctrl+Shift+R)
2. Verificar console (F12) â†’ Console para erros
3. Verificar env vars (este documento)
4. Se persistir, deletar e recriar TODAS as env vars

---

## ðŸ“Š TABELA DE REFERÃŠNCIA RÃPIDA

| # | VariÃ¡vel | Valor | Confidencial |
|---|----------|-------|:---:|
| 1 | `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` | Sim |
| 2 | `VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
| 3 | `VITE_APP_NAME` | `ProntoClinic Hub` | Sim |
| 4 | `VITE_APP_ENV` | `production` | NÃ£o |
| 5 | `VITE_ENABLE_TELEMEDICINE` | `false` | NÃ£o |
| 6 | `VITE_ENABLE_WHATSAPP` | `false` | NÃ£o |
| 7 | `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` | NÃ£o |
| 8 | `VITE_TISS_VERSION` | `3.05.00` | NÃ£o |
| 9 | `VITE_DICOM_BUCKET` | `dicom` | NÃ£o |

---

## ðŸŽ¯ APÃ“S O DEPLOY FUNCIONAR

1. âœ… Validar login: `luizjuniormedi@gmail.com` / `<ADMIN_TEMP_PASSWORD>`
2. âœ… Verificar dashboard com dados da MEDILIFE
3. âœ… Testar navegaÃ§Ã£o entre pÃ¡ginas
4. âœ… Confirmar dados SIGH visÃ­veis (pacientes, profissionais, etc)

### PrÃ³ximos Passos (depois do login OK)

1. **DomÃ­nio prÃ³prio** (R$ 40/ano): `prontoclinic.com.br` via https://registro.br
2. **DNS no Registro.br:**
   - Tipo `A @` â†’ `76.76.21.21`
   - Tipo `CNAME www` â†’ `cname.vercel-dns.com`
3. **Adicionar domÃ­nio no Vercel:** Settings â†’ Domains â†’ Add
4. **Lovable sync:** lovable.dev â†’ Settings â†’ GitHub â†’ Connect
5. **Upgrade Supabase Pro:** $25/mÃªs (8GB storage)
6. **Email real:** Resend API (https://resend.com) - $0/mÃªs atÃ© 100 emails/dia
7. **WhatsApp real:** Z-API (https://z-api.io) - R$ 50/mÃªs

---

## ðŸ“ž URLs Importantes

| Recurso | URL |
|---------|-----|
| **Frontend Vercel** | https://prontoclinic-hub.vercel.app/ |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn |
| **GitHub Repo** | https://github.com/luizjuniormedi-ship-it/prontoclinic-hub |
| **Vercel Dashboard** | https://vercel.com/dashboard |
| **SIGH (legado)** | http://6083041e1bde.sn.mynetname.net:47777 |

---

## ðŸ“ HistÃ³rico de MudanÃ§as

| Data | VersÃ£o | MudanÃ§a |
|------|---------|---------|
| 2026-06-25 | v1.0 | Documento criado |
| | | - 8 env vars obrigatÃ³rias documentadas |
| | | - MÃ©todo de importaÃ§Ã£o via .env |
| | | - SoluÃ§Ã£o de problemas comuns |

---

**IMPORTANTE:** Este documento Ã© seu guia completo para configurar o deploy. ApÃ³s salvar as env vars e o login funcionar, me avise para continuar com o domÃ­nio prÃ³prio e outras otimizaÃ§Ãµes! ðŸš€

