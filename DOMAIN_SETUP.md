# Guia de Configuração de Domínios — prontoclinic-hub

> Documento de referência para gerenciar domínios do projeto **prontoclinic-hub** na Vercel.
> Sistema: **POLICLINICA MEDILIFE DIAGNOSTICOS LTDA**

---

## Status Atual

| Item | Status |
|------|--------|
| Subdomínio Vercel padrão (`prontoclinic-hub.vercel.app`) | ATIVO e FUNCIONANDO |
| Subdomínio customizado `.vercel.app` (ex.: `app.prontoclinic-hub.vercel.app`) | NÃO CONFIGURADO |
| Domínio próprio (ex.: `prontoclinic.com.br`) | NÃO CONFIGURADO |

Verificação atual (25/06/2026):

```bash
curl -s -I https://prontoclinic-hub.vercel.app/
# HTTP/1.1 200 OK
# Server: Vercel
# X-Vercel-Cache: HIT
```

---

## 1. Subdomínio Vercel Padrão (JÁ CONFIGURADO)

O Vercel gera automaticamente um subdomínio baseado no nome do projeto:

```
https://prontoclinic-hub.vercel.app/
```

- Provisionado automaticamente no primeiro deploy.
- Certificado SSL/TLS gerenciado pela Vercel (Let's Encrypt).
- Renovação automática.
- Não requer configuração adicional.

**Ação necessária**: nenhuma — já está pronto para uso.

---

## 2. Como Adicionar um Subdomínio Customizado `.vercel.app`

Você pode criar variações do subdomínio Vercel sem comprar domínio próprio. Exemplos:

- `app.prontoclinic-hub.vercel.app`
- `admin.prontoclinic-hub.vercel.app`
- `paciente.prontoclinic-hub.vercel.app`

### Passo a passo (Dashboard Vercel)

1. Acesse https://vercel.com/dashboard
2. Selecione o projeto **prontoclinic-hub**
3. Vá em **Settings** → **Domains**
4. No campo "Add Domain", digite: `app.prontoclinic-hub.vercel.app`
5. Clique em **Add**
6. Vercel configura o SSL automaticamente em segundos
7. (Opcional) Defina como domínio primário na lista de domínios

### Limitações

- Apenas funciona com o prefixo do projeto (não dá pra criar `medilife.vercel.app` em projeto chamado `prontoclinic-hub`)
- Para branding próprio, é melhor comprar domínio (seção 3)

---

## 3. Como Comprar um Domínio Próprio

Recomendação para POLICLINICA MEDILIFE DIAGNOSTICOS LTDA: **Registro.br** (entidade oficial do CGI.br).

### Domínios sugeridos (verificar disponibilidade em registro.br)

- `prontoclinic.com.br` (~R$ 40/ano)
- `medilife.com.br` (~R$ 40/ano)
- `policlinica-medilife.com.br` (~R$ 40/ano)

### Passo a passo para comprar

1. Acesse https://registro.br
2. Pesquise o domínio desejado
3. Crie uma conta (CPF/CNPJ) ou faça login
4. Adicione ao carrinho e pague (R$ 40/ano para `.com.br`)
5. O domínio fica disponível imediatamente após confirmação de pagamento

---

## 4. Como Configurar DNS no Registro.br

Após comprar o domínio, configure os registros DNS para apontar ao Vercel:

### Para domínio apex (`prontoclinic.com.br`)

```
Tipo    Nome    Valor
A       @       76.76.21.21
```

### Para subdomínio `www` (`www.prontoclinic.com.br`)

```
Tipo     Nome    Valor
CNAME    www     cname.vercel-dns.com
```

### Para subdomínios adicionais (ex.: `app.prontoclinic.com.br`)

```
Tipo     Nome    Valor
CNAME    app     cname.vercel-dns.com
```

### Passo a passo no painel Registro.br

1. Login em https://registro.br
2. Vá em **Meus Domínios** → selecione o domínio
3. Clique em **DNS** → **Editar zonas**
4. Adicione/edite os registros conforme tabela acima
5. Salve

Propagação DNS: até 24h (geralmente minutos).

---

## 5. Como Adicionar o Domínio Próprio no Vercel

### Passo a passo (Dashboard Vercel)

1. Acesse https://vercel.com/dashboard
2. Selecione **prontoclinic-hub**
3. **Settings** → **Domains**
4. Em "Add Domain", digite: `prontoclinic.com.br`
5. Clique em **Add**
6. Vercel detecta automaticamente o DNS configurado e valida
7. Repita para `www.prontoclinic.com.br` (Vercel redireciona para apex automaticamente, ou vice-versa)
8. Marque o domínio primário (recomendado: apex `prontoclinic.com.br`)

### Verificação via CLI (opcional, requer auth)

```bash
# Requer `vercel login` prévio
vercel domains ls
vercel domains inspect prontoclinic.com.br
```

### Verificação via API pública

A API de domínios do Vercel requer autenticação (token), mas o domínio é verificável externamente:

```bash
# Verificar DNS
dig prontoclinic.com.br
nslookup prontoclinic.com.br

# Verificar SSL
curl -vI https://prontoclinic.com.br/ 2>&1 | grep -E "(SSL|subject|issuer|expire)"
```

---

## 6. Custos e Renovação

| Item | Custo | Renovação |
|------|-------|-----------|
| Subdomínio `.vercel.app` | Grátis | Automático |
| Domínio `.com.br` (Registro.br) | R$ 40/ano | Manual, anual |
| SSL/TLS | Grátis (Vercel gerencia) | Automático |

---

## 7. Checklist de Migração para Domínio Próprio

Quando decidir comprar o domínio próprio:

- [ ] Comprar domínio em registro.br
- [ ] Configurar registros DNS (A + CNAME)
- [ ] Aguardar propagação DNS (até 24h)
- [ ] Adicionar domínio no Vercel Dashboard
- [ ] Aguardar provisionamento SSL (minutos)
- [ ] Marcar domínio primário
- [ ] Atualizar links em materiais de marketing/documentação
- [ ] Configurar redirect `www` → apex (ou vice-versa) via Vercel
- [ ] Testar todas as rotas e funcionalidades no novo domínio

---

## 8. Suporte

- **Vercel Docs (Domains)**: https://vercel.com/docs/concepts/projects/domains
- **Registro.br FAQ**: https://registro.br/ajuda
- **Status Vercel**: https://vercel-status.com

---

**Última atualização**: 2026-06-25
**Mantido por**: Equipe de desenvolvimento prontoclinic-hub