# 🚀 ProntoClinic Hub - Variáveis de Ambiente Vercel

**Data:** 25 de junho de 2026
**Projeto Vercel:** medilife1/prontoclinic-hub
**URL alvo:** https://prontoclinic-hub.vercel.app/
**Backend:** Supabase Cloud (rhqgwrarkotjzdcrkbgn) - POLICLINICA MEDILIFE

---

## ⚠️ INSTRUÇÕES CRÍTICAS

**ATENÇÃO:** O Vercel pode ter traduzido os nomes das env vars. Use os nomes **EXATOS** abaixo (em inglês, snake_case).

**Se a env var aparecer com nome traduzido** (ex: `VITE_HABILITAR_TELEMEDICINA`), você DEVE:
1. Apagar (botão ⋯ → Delete)
2. Recriar com o nome correto (em inglês)
3. Confirmar ambiente: **Produção e Pré-visualização**

---

## 📋 8 VARIÁVEIS OBRIGATÓRIAS

### 1️⃣ VITE_SUPABASE_URL
```
Key:    VITE_SUPABASE_URL
Value:  https://rhqgwrarkotjzdcrkbgn.supabase.co
Amb:    Produção e Pré-visualização
Conf:   ON (Confidencial)
```

### 2️⃣ VITE_SUPABASE_ANON_KEY
```
Key:    VITE_SUPABASE_ANON_KEY
Value:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDEyMDksImV4cCI6MjA5Nzg3NzIwOX0.hwaGsz3wK1nq6aNXZDYJ_fOxpHI14eIvYB6ObQqx5gE
Amb:    Produção e Pré-visualização
Conf:   ON (Confidencial)
```

### 3️⃣ VITE_APP_NAME
```
Key:    VITE_APP_NAME
Value:  ProntoClinic Hub
Amb:    Produção e Pré-visualização
Conf:   ON
```

### 4️⃣ VITE_APP_ENV
```
Key:    VITE_APP_ENV
Value:  production
Amb:    Produção e Pré-visualização
Conf:   OFF (não é sensível)
```

### 5️⃣ VITE_ENABLE_TELEMEDICINE
```
Key:    VITE_ENABLE_TELEMEDICINE  (NÃO VITE_HABILITAR_TELEMEDICINA)
Value:  false
Amb:    Produção e Pré-visualização
Conf:   OFF
```

### 6️⃣ VITE_ENABLE_WHATSAPP
```
Key:    VITE_ENABLE_WHATSAPP  (NÃO VITE_ATIVAR_WHATSAPP)
Value:  false
Amb:    Produção e Pré-visualização
Conf:   OFF
```

### 7️⃣ VITE_TISS_AMBIENTE
```
Key:    VITE_TISS_AMBIENTE
Value:  HOMOLOGACAO
Amb:    Produção e Pré-visualização
Conf:   OFF
```

### 8️⃣ VITE_TISS_VERSION
```
Key:    VITE_TISS_VERSION
Value:  3.05.00
Amb:    Produção e Pré-visualização
Conf:   OFF
```

### 9️⃣ VITE_DICOM_BUCKET
```
Key:    VITE_DICOM_BUCKET
Value:  dicom
Amb:    Produção e Pré-visualização
Conf:   OFF
```

---

## 🚀 MÉTODO RÁPIDO: Importar via .env (1 CLIQUE)

### Passo 1: Cancelar env vars erradas (se houver)
Para cada env var com nome **traduzido**:
1. Clique nos **3 pontos (⋯)** da linha
2. Selecione **"Delete"** ou **"Remover"**
3. Confirme

### Passo 2: Importar .env limpo
1. Clique no botão **"Adicionar variável de ambiente"** (canto superior direito da lista)
2. No modal aberto, procure o botão **"Importar .env"** (canto inferior esquerdo)
3. **Cole exatamente este conteúdo** (copie tudo de uma vez):

```
VITE_SUPABASE_URL=https://rhqgwrarkotjzdcrkbgn.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDEyMDksImV4cCI6MjA5Nzg3NzIwOX0.hwaGsz3wK1nq6aNXZDYJ_fOxpHI14eIvYB6ObQqx5gE
VITE_APP_NAME=ProntoClinic Hub
VITE_APP_ENV=production
VITE_ENABLE_TELEMEDICINE=false
VITE_ENABLE_WHATSAPP=false
VITE_TISS_AMBIENTE=HOMOLOGACAO
VITE_TISS_VERSION=3.05.00
VITE_DICOM_BUCKET=dicom
```

4. Clique **"Salvar"** no canto inferior direito
5. A Vercel vai parsear e criar as 9 variáveis automaticamente

### Passo 3: Validar nomes
Após importar, **verifique** que os nomes estão **EXATAMENTE** assim:
- ✅ `VITE_SUPABASE_URL`
- ✅ `VITE_SUPABASE_ANON_KEY`
- ✅ `VITE_APP_NAME`
- ✅ `VITE_APP_ENV`
- ✅ `VITE_ENABLE_TELEMEDICINE`
- ✅ `VITE_ENABLE_WHATSAPP`
- ✅ `VITE_TISS_AMBIENTE`
- ✅ `VITE_TISS_VERSION`
- ✅ `VITE_DICOM_BUCKET`

Se algum nome aparecer traduzido (com acentos, maiúsculas diferentes, etc), apague e recrie manualmente.

### Passo 4: Trigger Redeploy
1. No menu lateral esquerdo, clique em **"Deployments"**
2. Encontre o deploy mais recente (status atual pode ser "Ready")
3. Clique nos **3 pontos (⋯)** do lado direito do deploy
4. Selecione **"Redeploy"**
5. Confirme a ação
6. Aguarde **2-3 minutos** (Vercel rebuilda com as env vars)

### Passo 5: Validar
1. Abra em nova aba: https://prontoclinic-hub.vercel.app/
2. **Esperado**: Tela de login do ProntoClinic Hub aparece
3. **Login**: `luizjuniormedi@gmail.com` / `07114575`
4. **Após login**: Dashboard com dados da POLICLINICA MEDILIFE

---

## 🐛 SOLUÇÃO DE PROBLEMAS

### Problema: "Configuration is invalid - VITE_SUPABASE_URL: Required"
**Causa:** env var não foi passada para o build
**Solução:**
1. Verifique se as env vars estão marcadas como "Production" (não apenas "Preview")
2. Verifique se os nomes estão **EXATAMENTE** como listado (sem acentos ou espaços)
3. Force um Redeploy (Deployments → 3 pontos → Redeploy)
4. Aguarde 3 minutos

### Problema: "Invalid login credentials"
**Causa:** usuário não existe no Supabase Auth
**Solução:**
1. Acessar: https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/auth/users
2. Verificar se `luizjuniormedi@gmail.com` existe
3. Se não, criar via SQL Editor:
```sql
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES ('luizjuniormedi@gmail.com', crypt('07114575', gen_salt('bf')), NOW(), '{"full_name":"Admin Demo"}');
```

### Problema: "Hot Standby OFF" ou "Disco cheio"
**Causa:** Supabase Cloud Free (500MB) está cheio
**Solução:**
1. Upgrade Supabase para Pro ($25/mês) em https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/settings/billing
2. Aguardar 5 minutos
3. Supabase volta a aceitar conexões

### Problema: Tela continua em branco após Redeploy
**Solução:**
1. Limpar cache do browser (Ctrl+Shift+R)
2. Verificar console (F12) → Console para erros
3. Verificar env vars (este documento)
4. Se persistir, deletar e recriar TODAS as env vars

---

## 📊 TABELA DE REFERÊNCIA RÁPIDA

| # | Variável | Valor | Confidencial |
|---|----------|-------|:---:|
| 1 | `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` | Sim |
| 2 | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDEyMDksImV4cCI6MjA5Nzg3NzIwOX0.hwaGsz3wK1nq6aNXZDYJ_fOxpHI14eIvYB6ObQqx5gE` | Sim |
| 3 | `VITE_APP_NAME` | `ProntoClinic Hub` | Sim |
| 4 | `VITE_APP_ENV` | `production` | Não |
| 5 | `VITE_ENABLE_TELEMEDICINE` | `false` | Não |
| 6 | `VITE_ENABLE_WHATSAPP` | `false` | Não |
| 7 | `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` | Não |
| 8 | `VITE_TISS_VERSION` | `3.05.00` | Não |
| 9 | `VITE_DICOM_BUCKET` | `dicom` | Não |

---

## 🎯 APÓS O DEPLOY FUNCIONAR

1. ✅ Validar login: `luizjuniormedi@gmail.com` / `07114575`
2. ✅ Verificar dashboard com dados da MEDILIFE
3. ✅ Testar navegação entre páginas
4. ✅ Confirmar dados SIGH visíveis (pacientes, profissionais, etc)

### Próximos Passos (depois do login OK)

1. **Domínio próprio** (R$ 40/ano): `prontoclinic.com.br` via https://registro.br
2. **DNS no Registro.br:**
   - Tipo `A @` → `76.76.21.21`
   - Tipo `CNAME www` → `cname.vercel-dns.com`
3. **Adicionar domínio no Vercel:** Settings → Domains → Add
4. **Lovable sync:** lovable.dev → Settings → GitHub → Connect
5. **Upgrade Supabase Pro:** $25/mês (8GB storage)
6. **Email real:** Resend API (https://resend.com) - $0/mês até 100 emails/dia
7. **WhatsApp real:** Z-API (https://z-api.io) - R$ 50/mês

---

## 📞 URLs Importantes

| Recurso | URL |
|---------|-----|
| **Frontend Vercel** | https://prontoclinic-hub.vercel.app/ |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn |
| **GitHub Repo** | https://github.com/luizjuniormedi-ship-it/prontoclinic-hub |
| **Vercel Dashboard** | https://vercel.com/dashboard |
| **SIGH (legado)** | http://6083041e1bde.sn.mynetname.net:47777 |

---

## 📝 Histórico de Mudanças

| Data | Versão | Mudança |
|------|---------|---------|
| 2026-06-25 | v1.0 | Documento criado |
| | | - 8 env vars obrigatórias documentadas |
| | | - Método de importação via .env |
| | | - Solução de problemas comuns |

---

**IMPORTANTE:** Este documento é seu guia completo para configurar o deploy. Após salvar as env vars e o login funcionar, me avise para continuar com o domínio próprio e outras otimizações! 🚀