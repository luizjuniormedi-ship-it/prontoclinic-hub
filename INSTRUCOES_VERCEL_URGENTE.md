# ðŸš¨ AÃ‡ÃƒO URGENTE NECESSÃRIA - Tela branca no Vercel

O site https://prontoclinic-hub.vercel.app/ estÃ¡ em branco porque o build do Vercel nÃ£o tem as variÃ¡veis de ambiente Supabase configuradas.

## âš ï¸ AÃ‡ÃƒO NECESSÃRIA (2 min) - VOCÃŠ precisa fazer

### Passo 1: Acessar Vercel Dashboard
Abra: https://vercel.com/dashboard

### Passo 2: Selecionar projeto
Clique em **prontoclinic-hub**

### Passo 3: Settings > Environment Variables
No menu lateral: **Settings** â†’ **Environment Variables**

### Passo 4: Adicionar variÃ¡veis (Production)
Clique em **Add** e adicione EXATAMENTE estas (uma por uma):

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` |
| `VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
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
Clique em **Save** apÃ³s cada uma

### Passo 7: Redeploy
VÃ¡ em **Deployments** â†’ clique no Ãºltimo deploy â†’ â‹¯ (3 pontos) â†’ **Redeploy**
Aguarde 2-3 minutos para o build terminar

### Passo 8: Validar
Abra: https://prontoclinic-hub.vercel.app/

A tela de login deve aparecer:
- Email: `luizjuniormedi@gmail.com`
- Senha: `<ADMIN_TEMP_PASSWORD>`

Pronto! Login funcional com dados REAIS da POLICLINICA MEDILIFE.

## âš ï¸ Se der erro no login

1. Verifique se o Supabase Cloud `rhqgwrarkotjzdcrkbgn` estÃ¡ respondendo:
   - Acesse: https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn
   - Se aparecer erro de "Hot Standby OFF" ou "Disk Full", faÃ§a upgrade para Pro ($25/mÃªs)
2. Verifique se o usuÃ¡rio admin existe:
   - Authentication > Users > deve ter `luizjuniormedi@gmail.com`
3. Se nÃ£o existir, crie via SQL Editor:
   ```sql
   INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
   VALUES ('luizjuniormedi@gmail.com', crypt('<ADMIN_TEMP_PASSWORD>', gen_salt('bf')), NOW(), '{"full_name":"Admin Demo"}');
   ```

## ðŸŽ¯ ApÃ³s login funcionar

VocÃª pode:
- Adicionar domÃ­nio customizado (prontoclinic.com.br via Registro.br R$ 40/ano)
- Conectar Lovable via OAuth (3 min)
- Configurar Resend/Z-API para emails/WhatsApp (10 min)

Total investimento primeiro ano: **R$ 40** (domÃ­nio) + R$ 0 (Vercel Hobby) + R$ 0 (Supabase Free) = **R$ 40**


