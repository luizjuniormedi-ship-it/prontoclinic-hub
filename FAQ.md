# Perguntas Frequentes (FAQ)

## Geral

### O que é o ProntoMedic?

O ProntoMedic é um sistema de gestão completo para clínicas e consultórios médicos. Ele cobre todo o fluxo: desde o pré-cadastro do paciente, passando pela agenda, prontuário eletrônico, prescrição digital, até o faturamento e BI.

### Quem pode usar o ProntoMedic?

- **Clínicas** de qualquer porte (pequeno, médio, grande)
- **Consultórios** individuais
- **Hospitais** com ambulatório
- **Policlínicas** com múltiplas especialidades
- **Centros de diagnóstico** (imagem, laboratório)

### Qual a diferença entre o ProntoMedic e o SIGH?

| Aspecto | SIGH | ProntoMedic |
|---|---|---|
| Banco | MySQL 5.1 (EOL) | PostgreSQL 16 |
| Frontend | PHP legado | React 18 + TypeScript |
| Mobile | Não tem | PWA instalável |
| LGPD | Não conforme | Conforme |
| DICOM | Sim (legado) | Sim (Orthanc + visualizador web) |
| TISS | Sim (limitado) | TISS 3.05 completo |
| Senhas | Plain text (vulnerável) | bcrypt + 2FA |
| Charset | latin1 (corrompido) | UTF-8 |
| Código | Aberto | Proprietário |
| Suporte | Interno | SLA 24h |

### Quanto custa?

Consulte a tabela de planos em https://prontomedic.com.br/planos.

- **Essencial** (até 5 profissionais): R$ XXX/mês
- **Profissional** (até 20 profissionais): R$ XXX/mês
- **Enterprise** (ilimitado): sob consulta
- **Hospedagem e manutenção**: incluídas
- **Migração de dados do SIGH**: gratuita no plano anual

### Preciso de internet para usar?

Sim, o sistema é 100% cloud. Para contingência, oferecemos:
- **PWA offline**: consulta à agenda e prontuário offline
- **Modo leitura**: dados sincronizados ficam disponíveis

### Tem garantia de disponibilidade (SLA)?

- **Plano Essencial**: 99% (~7h downtime/mês)
- **Plano Profissional**: 99.5% (~3.6h)
- **Plano Enterprise**: 99.9% (~43min) com SLA contratual

---

## Técnico

### Como configurar HTTPS local?

```bash
# Vite suporta HTTPS nativo em dev
# Edite vite.config.ts:
export default defineConfig({
  server: {
    https: true,
    host: 'localhost',
    port: 5173
  }
})
```

Para certificado autoassinado:
```bash
openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365
```

### Como adicionar um novo módulo?

1. Crie pasta em `src/modules/NOME_MODULO/`
2. Estrutura:
   ```
   nome-modulo/
   ├── components/
   ├── hooks/
   ├── services/
   ├── types/
   ├── pages/
   └── index.ts
   ```
3. Adicione rotas em `src/App.tsx`
4. Adicione menu em `src/components/AppSidebar.tsx`
5. Crie migration se houver mudanças no banco
6. Adicione testes em `src/modules/NOME_MODULO/__tests__/`

### Como faço backup?

**Banco de dados (Supabase):**
- Backups automáticos diários (plano Pro+)
- Point-in-time recovery até 7 dias
- Manual via `pg_dump`:
  ```bash
  pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
  ```

**Storage (arquivos):**
- Replicação automática no Supabase
- Manual via `supabase storage download`

### Como restaurar backup?

```bash
# Banco
psql $DATABASE_URL < backup_20260622.sql

# Storage
supabase storage cp ./local-files/ s3://bucket/path/
```

### Como configurar SMTP próprio?

Edite `.env`:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@seudominio.com.br
SMTP_PASSWORD=senha_app
SMTP_SECURE=tls
```

Para Gmail, use **senha de app** (não a senha normal): https://myaccount.google.com/apppasswords

### Como adicionar uma nova migration?

```bash
supabase migration new nome_da_migration
# Edite o arquivo gerado em supabase/migrations/
supabase db push
```

### Como testar mudanças localmente sem deploy?

```bash
# Use Supabase local (Docker)
supabase start

# Ou aponta para projeto de dev
VITE_SUPABASE_URL=https://dev.supabase.co
npm run dev
```

### Como faço para resetar o banco de dev?

```bash
supabase db reset
# Aplica todas as migrations e seeds novamente
```

### Como debugo RLS?

```sql
-- Ver políticas de uma tabela
SELECT * FROM pg_policies WHERE tablename = 'pacientes';

-- Testar com usuário específico
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM pacientes;
```

### Como configuro CI/CD?

Veja `.github/workflows/ci.yml` (em construção).

---

## LGPD

### O sistema está em conformidade com a LGPD?

**Sim**, totalmente. Implementamos:

- **Consentimento explícito** (opt-in) para tratamento de dados
- **Finalidade específica** documentada
- **Necessidade**: coletamos apenas dados necessários
- **Acesso** do titular aos seus dados (art. 18, II)
- **Correção** de dados incompletos (art. 18, III)
- **Portabilidade** (art. 18, V) — JSON/CSV
- **Esquecimento** com anonimização (art. 18, VI)
- **Retenção** definida por tipo de dado (prontuário: 20 anos — CFM 2.217/2018)
- **Auditoria** completa de acessos (CFM 1.821/2007)
- **Encarregado de dados (DPO)** designado
- **Política de privacidade** pública
- **Logs de acesso imutáveis**

### Como exportar dados de um paciente?

**Como administrador:**

1. Acesse "Admin" > "LGPD" > "Solicitações"
2. Encontre a solicitação (ou crie manualmente)
3. Clique em "Processar"
4. Sistema gera um **pacote ZIP** com:
   - Dados pessoais (JSON)
   - Prontuários (PDF)
   - Exames (PDF/DICOM)
   - Logs de acesso
5. Envie o link temporário ao paciente por e-mail

**Como paciente (portal):**

1. "Meus dados" > "Solicitar download"
2. Confirme por e-mail
3. Receba link em até 15 dias

### Como anonimizar um paciente?

1. Acesse "Admin" > "LGPD" > "Anonimização"
2. Busque o paciente
3. Selecione o **motivo** (solicitação do titular, óbito, retenção expirada)
4. Confirme a ação
5. O sistema:
   - Substitui nome, CPF, RG, endereço por hash
   - Mantém dados clínicos para fins epidemiológicos (se autorizado)
   - Registra a ação na auditoria
   - **Não pode ser desfeito**

### Qual a política de retenção de dados?

| Tipo de dado | Retenção | Base legal |
|---|---|---|
| Prontuário | 20 anos | CFM 2.217/2018 |
| Exames laboratoriais | 5 anos | Conselho Federal de Medicina |
| Exames de imagem | 20 anos | CFM 2.217/2018 |
| Logs de acesso | 5 anos | CFM 1.821/2007 |
| Faturamento TISS | 5 anos | Legislação fiscal |
| Auditoria | 10 anos | CFM 1.821/2007 |
| Dados de marketing | Até revogação de consentimento | LGPD |

Após o prazo, sistema oferece **anonimização automática** ou **exclusão**.

### Como configurar DPO (Encarregado de Dados)?

1. Acesse "Admin" > "Configurações" > "LGPD"
2. Preencha:
   - Nome do DPO
   - Email
   - Telefone
3. Sistema publica o contato na Política de Privacidade
4. Todos os e-mails para `dpo@prontomedic.com.br` são roteados

---

## Suporte

### Onde obtenho suporte?

| Canal | Tempo de resposta |
|---|---|
| Email: suporte@prontomedic.com.br | Até 24h |
| Chat (no app) | Até 4h (horário comercial) |
| Telefone: (XX) XXXX-XXXX | Imediato (horário comercial) |
| Issues no GitHub | Comunidade |
| Documentação | Imediato (self-service) |

### Como reportar um bug?

Use o template `.github/ISSUE_TEMPLATE/bug_report.md` ou email `bugs@prontomedic.com.br` com:

- Descrição do problema
- Passos para reproduzir
- Comportamento esperado
- Screenshots / vídeos
- Ambiente (OS, browser, versão)

**Vulnerabilidades de segurança**: NÃO abra issue pública. Veja [SECURITY.md](SECURITY.md).

### Como solicitar uma feature?

Use o template `.github/ISSUE_TEMPLATE/feature_request.md` ou:

- Email: `product@prontomedic.com.br`
- Botão "Sugerir feature" no app
- Votação em roadmap público: https://prontomedic.com.br/roadmap

### Onde vejo o roadmap?

- **Público**: https://prontomedic.com.br/roadmap
- **Interno**: [ROADMAP.md](ROADMAP.md) (quando disponível)
- **Por e-mail**: enviamos updates mensais

### Como cancelar minha assinatura?

1. Acesse "Admin" > "Assinatura"
2. Clique em "Cancelar"
3. Confirme o motivo
4. Sistema continua ativo até o fim do ciclo pago
5. Dados ficam disponíveis para download por 30 dias

### Como contratar mais usuários?

1. "Admin" > "Assinatura" > "Adicionar usuários"
2. Defina a quantidade
3. Sistema cobra proporcional na próxima fatura
4. Convite é enviado automaticamente

### Vocês fazem treinamento?

Sim:

- **Onboarding gratuito** (até 2h por vídeo)
- **Treinamento presencial** (custo adicional, sob orçamento)
- **Academia ProntoMedic** (cursos online, https://academia.prontomedic.com.br)
- **Certificação** para usuários avançados

### Como migrar do SIGH?

Veja [MIGRATION.md](MIGRATION.md) para o guia completo de migração. Resumo:

1. Exportação do SIGH (script Python fornecido)
2. Validação dos dados
3. Importação no ProntoMedic
4. Conciliação de pacientes e agendas
5. Capacitação da equipe
6. Go-live assistido
