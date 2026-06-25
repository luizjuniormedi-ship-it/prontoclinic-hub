# 🚨 AÇÃO URGENTE NECESSÁRIA - Tela branca no Vercel

O site https://prontoclinic-hub.vercel.app/ está em branco porque o build do Vercel não tem as variáveis de ambiente Supabase configuradas.

## ⚠️ AÇÃO NECESSÁRIA (2 min) - VOCÊ precisa fazer

### Passo 1: Acessar Vercel Dashboard
Abra: https://vercel.com/dashboard

### Passo 2: Selecionar projeto
Clique em **prontoclinic-hub**

### Passo 3: Settings > Environment Variables
No menu lateral: **Settings** → **Environment Variables**

### Passo 4: Adicionar variáveis (Production)
Clique em **Add** e adicione EXATAMENTE estas (uma por uma):

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDEyMDksImV4cCI6MjA5Nzg3NzIwOX0.hwaGsz3wK1nq6aNXZDYJ_fOxpHI14eIvYB6ObQqx5gE` |
| `VITE_APP_NAME` | `ProntoClinic Hub` |
| `VITE_APP_ENV` | `production` |
| `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` |
| `VITE_TISS_VERSION` | `3.05.00` |
| `VITE_DICOM_BUCKET` | `dicom` |
| `VITE_ENABLE_TELEMEDICINE` | `false` |
| `VITE_ENABLE_WHATSAPP` | `false` |

### Passo 5: Marcar Production
Para cada uma, marque a checkbox **Production**

### Passo 6: Salvar
Clique em **Save** após cada uma

### Passo 7: Redeploy
Vá em **Deployments** → clique no último deploy → ⋯ (3 pontos) → **Redeploy**
Aguarde 2-3 minutos para o build terminar

### Passo 8: Validar
Abra: https://prontoclinic-hub.vercel.app/

A tela de login deve aparecer:
- Email: `luizjuniormedi@gmail.com`
- Senha: `07114575`

Pronto! Login funcional com dados REAIS da POLICLINICA MEDILIFE.

## ⚠️ Se der erro no login

1. Verifique se o Supabase Cloud `rhqgwrarkotjzdcrkbgn` está respondendo:
   - Acesse: https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn
   - Se aparecer erro de "Hot Standby OFF" ou "Disk Full", faça upgrade para Pro ($25/mês)
2. Verifique se o usuário admin existe:
   - Authentication > Users > deve ter `luizjuniormedi@gmail.com`
3. Se não existir, crie via SQL Editor:
   ```sql
   INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
   VALUES ('luizjuniormedi@gmail.com', crypt('07114575', gen_salt('bf')), NOW(), '{"full_name":"Admin Demo"}');
   ```

## 🎯 Após login funcionar

Você pode:
- Adicionar domínio customizado (prontoclinic.com.br via Registro.br R$ 40/ano)
- Conectar Lovable via OAuth (3 min)
- Configurar Resend/Z-API para emails/WhatsApp (10 min)

Total investimento primeiro ano: **R$ 40** (domínio) + R$ 0 (Vercel Hobby) + R$ 0 (Supabase Free) = **R$ 40**
