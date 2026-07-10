# ðŸš€ Guia Definitivo: Configurar Env Vars no Vercel

## Status: O que vocÃª precisa fazer AGORA (5-10 minutos)

### Passo 1: Acessar Vercel (1 min)
- URL: https://vercel.com/dashboard
- Selecionar projeto: **prontoclinic-hub**

### Passo 2: Remover env vars erradas (2 min)
No menu lateral: **Settings** â†’ **Environment Variables**

Deletar essas que estÃ£o com nomes errados:
1. `VITE_HABILITAR_TELEMEDICINA` â†’ Deletar
2. `VITE_ATIVAR_WHATSAPP` â†’ Deletar
3. `VITE_TISâ€¦VERSION` (com reticÃªncias) â†’ Deletar

### Passo 3: Adicionar 8 env vars CORRETAS (3 min)
Para cada uma, clicar **"Add"** e preencher:

| # | Key | Value | Ambiente |
|---|-----|-------|----------|
| 1 | `VITE_SUPABASE_URL` | `https://rhqgwrarkotjzdcrkbgn.supabase.co` | Production |
| 2 | `VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
| 3 | `VITE_APP_NAME` | `ProntoClinic Hub` | Production |
| 4 | `VITE_APP_ENV` | `production` | Production |
| 5 | `VITE_TISS_AMBIENTE` | `HOMOLOGACAO` | Production |
| 6 | `VITE_TISS_VERSION` | `3.05.00` | Production |
| 7 | `VITE_DICOM_BUCKET` | `dicom` | Production |
| 8 | `VITE_ENABLE_TELEMEDICINE` | `false` | Production |
| 9 | `VITE_ENABLE_WHATSAPP` | `false` | Production |

### Passo 4: ForÃ§ar redeploy (1 min)
- Menu lateral: **Deployments**
- Clicar no Ãºltimo deploy
- Clicar nos **3 pontos (â‹¯)** â†’ **"Redeploy"**
- Selecionar **"Use existing Build Cache"** ou **"Redeploy without cache"**
- Confirmar

### Passo 5: Aguardar e validar (2-3 min)
- Aguardar 2-3 minutos o build completar
- Acessar https://prontoclinic-hub.vercel.app/
- Tentar fazer login: `luizjuniormedi@gmail.com` / `<ADMIN_TEMP_PASSWORD>`

## ðŸŽ¯ VerificaÃ§Ã£o Final

Se tudo der certo, o site vai:
- Carregar a tela de login (sem erro de env)
- Aceitar as credenciais
- Mostrar o dashboard

## ðŸš¨ Problemas Comuns

### "Configuration is invalid - VITE_SUPABASE_URL: Required"
**Causa:** VocÃª pulou o Passo 3. Volte e adicione as 9 env vars.

### "Configuration is invalid - VITE_SUPABASE_URL: VITE_SUPABASE_URL deve apontar para um projeto Supabase"
**Causa:** VocÃª usou `localhost:5432` em vez de `https://rhqgwrarkotjzdcrkbgn.supabase.co`. Use o URL completo do Supabase.

### "Invalid login credentials"
**Causa:** O usuÃ¡rio nÃ£o existe no Supabase Auth. Verifique em https://supabase.com/dashboard/project/rhqgwrarkotjzdcrkbgn/auth/users

### Tela em branco (404)
**Causa:** Cache do Vercel. FaÃ§a `Ctrl+Shift+R` ou aguarde 2-3 minutos.

## ðŸ“‹ Arquivo TXT Pronto para Importar

Se preferir usar o botÃ£o "Import .env" do Vercel, o arquivo jÃ¡ estÃ¡ em:
`C:\Users\Meu Computador\Documents\VERCEL_ENV_VARS.txt`

Basta:
1. Abrir https://vercel.com/dashboard â†’ prontoclinic-hub â†’ Settings â†’ Environment Variables
2. Clicar "Add Environment Variable"
3. Clicar "Import .env" (canto inferior)
4. Selecionar `C:\Users\Meu Computador\Documents\VERCEL_ENV_VARS.txt`
5. Confirmar

## ðŸŽ¯ PrÃ³ximos Passos ApÃ³s Login Funcionar

1. âœ… Login funcional
2. ðŸŒ Configurar domÃ­nio prÃ³prio (`medilife.com.br` via Registro.br R$ 40/ano)
3. ðŸ’» Decidir entre servidor fÃ­sico (Dell R250 R$ 4.500) ou VPS Cloud (R$ 60/mÃªs)
4. ðŸš€ Fazer deploy final do backend (script `setup-local-server.sh` ou `setup-vps-ubuntu.sh`)
5. ðŸ“Š MigraÃ§Ã£o SIGH â†’ ProntoClinic (script `migrate_sigh_to_postgres.py`)
6. ðŸŽ‰ Go-live

## ðŸ“ž Suporte

Se tiver dÃºvidas durante o processo, me avise que eu ajudo a resolver.



