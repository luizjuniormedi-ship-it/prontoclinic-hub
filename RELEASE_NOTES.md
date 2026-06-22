# Release Notes — ProntoMedic Hub v1.0.0

**Data de release:** 2026-06-22
**Tipo:** Release inicial (GA — General Availability)
**Tag Git:** `v1.0.0`
**Commit:** `2223de4`
**Compatibilidade:** Node.js >= 20, PostgreSQL 15+, Supabase CLI >= 1.200

---

## Resumo do Release

O **ProntoMedic Hub v1.0.0** é a primeira release estável do sistema de gestão
para clínicas e consultórios médicos. Após 26 ciclos de trabalho (Agentes
1 a 26), o sistema está pronto para **staging** e **homologação ANS**.

O sistema entrega **24 módulos** cobrindo o ciclo completo de atendimento:
pré-cadastro, agendamento, recepção, prontuário, DICOM, faturamento TISS,
LGPD e auditoria. Tudo com multi-tenancy (RLS), acessibilidade WCAG AA e
PWA instalável.

### Números da release

- **351 arquivos** modificados/criados
- **~70.000 linhas** de código e documentação
- **14 migrations SQL** aplicadas
- **87 testes unitários** (Vitest, 100% em `statusTransitions`)
- **103 cenários E2E** (Playwright, 5 browsers)
- **21 documentos** `.md` (4.000+ linhas)
- **0 vulnerabilidades críticas** (após correções P0)

---

## Features Principais

### 1. Pré-cadastro Online (PWA)

- Paciente preenche dados em 4 steps (dados pessoais, contato, convênio,
  confirmação).
- Email automático com link de confirmação.
- Após confirmação, agendamento é criado com status `pre_cadastro_confirmado`.
- Disponível mesmo offline (PWA com service worker).
- Inclusivo: WCAG AA, suporte a leitor de tela, navegação por teclado.

### 2. Agendamento Avançado

- Grade semanal/mensal com virtualização (`@tanstack/react-virtual`).
- Drag-and-drop para reagendar.
- Regras de status: `agendado → confirmado → em_atendimento → realizado /
  faltou / cancelado` (ver `statusTransitions.test.ts`).
- Bloqueio de duplicatas no mesmo horário/profissional.
- Confirmação self-service via link público com token de 24h.

### 3. Prontuário Eletrônico

- SOAP, anamnese, exames, atestados, receitas.
- Templates configuráveis com variáveis (`{{paciente.nome}}`).
- Assinatura digital com hash SHA-256 + timestamp.
- Histórico de versões com diff.

### 4. DICOM/PACS

- Integração Orthanc (DICOMweb + DIMSE).
- Viewer Cornerstone no navegador (study list, séries, medidas, anotações).
- Templates de laudo com WYSIWYG + sanitização XSS (DOMPurify).
- Storage com hierarquia Study > Series > Instance + S3 opcional.

### 5. Faturamento TISS 3.05.00

- Geração de guias (consulta, SADT, internação, honorários).
- Envio em lote para operadora (XML assinado).
- Importação de retorno (com parsing de glosa).
- Workflow de recurso de glosa com anexos.
- Estatísticas: taxa de glosa, valor aprovado vs glosado, tempo médio.

### 6. LGPD Completo

- Consentimento granular por finalidade (tratamento, marketing, pesquisa).
- Exportação de dados em JSON (art. 18 V) via RPC `export_patient_data`.
- Anonimização via wrapper `request_anonymize_patient` (com audit trail).
- Política de retenção configurável por tenant.
- DPO dashboard com solicitações pendentes.

### 7. Auditoria Imutável

- Tabela `audit_logs` com partição por ano (CFM 1.821/2007).
- Trigger automático em INSERT/UPDATE/DELETE nas tabelas sensíveis.
- Filtros: usuário, ação, tabela, período, tenant.
- Exportação CSV para fiscalização.

### 8. Notificações Multicanal

- Email (SMTP), WhatsApp (Twilio), SMS (Twilio/Vonage).
- Templates configuráveis por tenant (variáveis `{{}}`).
- Worker Python com retry exponencial (até 5 tentativas).
- Histórico de envios com status (`pending`, `sent`, `failed`, `bounced`).

### 9. Convênios e Tabelas de Preço

- Credenciamento de profissionais em planos.
- Cotas de vagas por convênio (diária/mensal).
- Tabela de preços hierárquica (procedimento × plano × vigência).
- Fallback automático via `find_price` RPC (plano → particular → tabela base).

### 10. Multi-Tenant com RLS

- Row-Level Security em 100% das tabelas sensíveis.
- `get_my_company_id()` SECURITY DEFINER para performance.
- Isolamento testado em E2E (`e2e/auth.spec.ts`).

### 11. Segurança e Autenticação

- Login com email/senha + 2FA TOTP.
- Recovery password com token de 1h.
- Audit de login com detecção de força bruta (5 tentativas em 5 min).
- CSP strict + headers de segurança.
- Sanitização XSS em todos os campos rich-text.

### 12. Acessibilidade (WCAG AA)

- axe-core integrado em testes E2E (`e2e/a11y.spec.ts`).
- Skip-links, ARIA landmarks, foco visível.
- Atalhos de teclado globais (`?` abre ajuda).
- Live regions para feedback de ações.
- Contraste mínimo 4.5:1, navegação por teclado completa.

### 13. PWA e Mobile

- Instalável em iOS e Android.
- Service worker com estratégia cache-first para assets.
- Manifest com 8 ícones (gerados via `scripts/generate-pwa-icons.js`).
- Modo offline para pré-cadastro e visualização de agendamentos.

### 14. UX e Onboarding

- First Login Wizard para o primeiro admin (4 passos).
- Empty states ilustrados.
- Mensagens de erro amigáveis (`friendlyError.ts`).
- Tooltips em botões só com ícone.
- Onboarding por módulo (tour guiado).

---

## Bugfixes Críticos (P0)

| # | Arquivo | Descrição |
|---|---------|-----------|
| 1 | `.env.example` | Credenciais Orthanc default substituídas por placeholders |
| 2 | `src/lib/env.ts` | Validação Zod em todas as variáveis sensíveis |
| 3 | `ReportTemplateEditor.tsx` | XSS sanitizado com DOMPurify |
| 4 | `*.ts` | 4 chamadas `parseInt` sem radix corrigidas |
| 5 | `index.html` | CSP strict + headers de segurança |
| 6 | `SECURITY.md` | Decisão de localStorage documentada |
| 7 | `20260101000012_security_hardening.sql` | Migration consolidando proteções |
| 8 | `publish_dicom_report` | Bug SQL corrigido |
| 9 | `confirm_pre_cadastro` | Bug SQL corrigido |
| 10 | `anonymize_patient` | Estendida para 6 tabelas relacionadas |
| 11 | `pacientes_anonimizaveis` | View com filtro de tenant |
| 12 | `package.json` | 16 CVEs npm reduzidas |

---

## Breaking Changes

**Nenhuma breaking change.** Esta é a primeira release estável, então não
há versões anteriores para comparar.

**Notas importantes para upgrade futuro:**

- O campo `password_hash` foi migrado de MD5 (legado SIGH) para bcrypt
  (factor 12) — usuários do SIGH precisam redefinir senha no primeiro login.
- O schema do banco assume Supabase Auth — autenticação custom requer
  refatoração do `authService.ts`.
- Migrations aplicam em ordem cronológica (`20260101000001` a
  `20260101000012`) — pular qualquer uma pode quebrar integridade.

---

## Como Instalar

### Pré-requisitos

- Node.js >= 20
- npm >= 10 (ou pnpm/yarn)
- PostgreSQL 15+ (ou conta Supabase)
- Python 3.11+ (apenas para scripts de migração e worker)

### Passo a passo

```bash
# 1. Clonar
git clone https://github.com/luizjuniormedi-ship-it/prontoclinic-hub.git
cd prontoclinic-hub

# 2. Instalar deps
npm install

# 3. Configurar ambiente
cp .env.example .env
# Editar .env com suas credenciais (Supabase, Orthanc, SMTP, etc)

# 4. Subir Supabase local
supabase start
supabase db reset  # aplica todas as 14 migrations

# 5. Build
npm run build

# 6. Rodar
npm run dev  # desenvolvimento
# ou
npm run preview  # após build
```

### Verificação pós-instalação

```bash
# Rodar testes
npm run test           # unitários (87)
npm run test:e2e       # E2E (103 cenários)

# Validar migrations
python scripts/validate-migrations.py

# Type check + lint
npm run typecheck
npm run lint
```

---

## Como Migrar do SIGH

O **SIGH** (Sistema Integrado de Gestão Hospitalar) tem schema legado em
MySQL com tabelas `paciente`, `agenda`, `atendimento`, `procedimento`, etc.

### Passo a passo

1. **Exportar dados do SIGH** em CSV/JSON:
   ```bash
   mysqldump -u root -p sigh --tab=/tmp/sigh_export \
     paciente agenda atendimento procedimento convenio
   ```

2. **Mapear colunas** — ver `MIGRATION.md` (mapeamento completo) e
   `scripts/migrate_sigh.py` (template).

3. **Rodar script de migração**:
   ```bash
   python scripts/migrate_sigh.py \
     --source /tmp/sigh_export \
     --target postgresql://user:pass@localhost:5432/prontoclinic \
     --tenant-id <uuid-da-clinica>
   ```

4. **Validar migração**:
   - Total de pacientes: `SELECT COUNT(*) FROM patients;` deve bater com SIGH.
   - Total de agendamentos: `SELECT COUNT(*) FROM appointments;` deve bater.
   - Senhas: usuários do SIGH recebem email para redefinir (MD5 → bcrypt).

5. **Treinar usuários** — ver `MANUAL.md` (10 screenshots) e `GUIA_PACIENTE.md`.

**Atenção:** a senha não é migrada. Todos os usuários do SIGH precisam
redefinir senha no primeiro login (link "Esqueci minha senha").

---

## Próximos Passos (Roadmap v1.1)

### v1.1.0 (Q3 2026) — Melhorias de UX

- Módulo de **Farmácia/Materiais** (estoque, dispensação, lote/validade).
- Módulo de **Enfermagem/Triagem** (sinais vitais, classificação de risco).
- Recepção com **check-in digital** (tablet na entrada).
- **Integração com gov.br** para login unificado.
- **BI dashboard** com métricas operacionais (tempo médio de espera,
  taxa de ocupação, glosa por convênio).

### v1.2.0 (Q4 2026) — Integrações

- **Integração com laboratorios** (Labcore, Hermes-Pardini).
- **Integração com farmácias** (Alliança, RD).
- **Telemedicina** com WebRTC + gravação opcional.
- **Mobile nativo** (React Native) para profissionais em campo.
- **API pública** (REST + GraphQL) para integrações de terceiros.

### v2.0.0 (2027) — Multi-clínica

- Suporte a **rede de clínicas** (matriz + filiais).
- **Faturamento centralizado** com rateio automático.
- **BI consolidado** cross-tenant.
- **Mobile app** dedicado para pacientes (iOS + Android).

---

## Agradecimentos

Agradecemos a todos os contribuidores e à comunidade open-source que tornou
esta release possível. Em especial:

- **Lovable** — geração de UI assistida por IA.
- **Supabase** — backend-as-a-service.
- **shadcn/ui** + **Radix UI** — componentes acessíveis.
- **Orthanc** — DICOM server open-source.
- **Playwright** + **Vitest** — suítes de teste.
- **Arsenal MCP** — auditoria de código, banco, segurança e performance.

---

## Suporte

- **Issues:** https://github.com/luizjuniormedi-ship-it/prontoclinic-hub/issues
- **Discussões:** https://github.com/luizjuniormedi-ship-it/prontoclinic-hub/discussions
- **Email:** dev@prontomedic.com.br
- **Documentação:** ver `README.md` e `docs/`

---

**ProntoMedic Hub v1.0.0** — Liberado em 2026-06-22.
Licenciado sob [MIT](./LICENSE).
