# Arquitetura — ProntoClinic Hub

## Visão geral

```mermaid
graph TB
  subgraph Cliente
    A1[Paciente PWA]
    A2[Recepção Web]
    A3[Médico Web]
    A4[Admin Web]
  end

  subgraph CDN
    B[Cloudflare/Vercel CDN]
  end

  subgraph Frontend
    C[Next.js PWA<br/>React 18 + TS]
  end

  subgraph Backend
    D[Supabase<br/>PostgreSQL 16]
    E[Edge Functions]
    F[Auth]
    G[Storage S3]
  end

  subgraph Integrações
    H[Resend Email]
    I[Z-API WhatsApp]
    J[Twilio SMS]
    K[Orthanc PACS]
    L[Operadoras TISS]
  end

  A1 --> B
  A2 --> B
  A3 --> B
  A4 --> B
  B --> C
  C --> D
  C --> E
  C --> F
  C --> G
  D --> E
  E --> H
  E --> I
  E --> J
  D --> K
  E --> L
```

## Diagrama de sequência: Agendamento de consulta

```mermaid
sequenceDiagram
  participant P as Paciente
  participant F as Frontend PWA
  participant API as Supabase API
  participant DB as PostgreSQL
  participant N as Worker Notif.
  participant E as Resend
  participant W as WhatsApp

  P->>F: Acessa "Agendar consulta"
  F->>API: GET /medicos?especialidade=X
  API->>DB: SELECT com JOIN
  DB-->>API: Lista de médicos
  API-->>F: JSON
  F-->>P: Exibe cards

  P->>F: Escolhe médico + data + hora
  F->>API: GET /agendamentos/slots
  API->>DB: SELECT com filtros
  DB-->>API: Slots disponíveis
  API-->>F: JSON

  P->>F: Confirma agendamento
  F->>API: POST /agendamentos
  API->>DB: INSERT (com lock)
  DB-->>API: cd_agenda
  API->>DB: INSERT log_agenda
  API->>DB: INSERT pre_cadastro_token
  API-->>F: 201 Created
  F-->>P: "Agendamento criado!"

  API->>N: Push notificação
  N->>E: send email
  N->>W: send WhatsApp
  E-->>P: Confirmação por email
  W-->>P: Confirmação por WhatsApp
```

## Diagrama ER do banco

```mermaid
erDiagram
  companies ||--o{ users : has
  companies ||--o{ patients : has
  companies ||--o{ appointments : has
  companies ||--o{ insurance_companies : has
  insurance_companies ||--o{ insurance_plans : has
  insurance_companies ||--o{ professional_insurances : has
  professionals ||--o{ professional_insurances : has
  professionals ||--o{ appointments : has
  patients ||--o{ appointments : has
  patients ||--o{ medical_records : has
  appointments ||--o{ medical_records : has
  services ||--o{ appointments : has
  price_tables }o--|| services : references
  price_tables }o--|| insurance_plans : references
  payments ||--|| appointments : references
  dicom_equipment ||--o{ dicom_exams : has
  dicom_exams ||--o{ dicom_exam_images : has
  report_templates ||--o{ dicom_exams : uses
  pre_cadastro ||--o| patients : becomes
  audit_logs }o--|| companies : tracks
  notification_templates ||--o{ notifications : uses
  lgpd_solicitacoes }o--|| patients : manages
  paciente_consentimentos }o--|| patients : grants
  paciente_anonimizacao_log }o--|| patients : tracks
  tiss_xml }o--|| insurance_companies : bills
  tiss_xml ||--o{ tiss_glosas : has
```

## Fluxo de autenticação

```mermaid
graph LR
  A[Login] --> B{Validar JWT}
  B -->|válido| C[Dashboard]
  B -->|inválido| D[Refresh Token]
  D -->|válido| C
  D -->|expirado| A

  C --> E{2FA ativo?}
  E -->|sim| F[Código TOTP]
  E -->|não| G[App]
  F --> G
```

## Fluxo LGPD: Direito ao esquecimento

```mermaid
sequenceDiagram
  participant P as Paciente
  participant A as Admin
  participant API as request_anonymize_patient
  participant DB as PostgreSQL

  P->>A: Solicita exclusão
  A->>API: RPC request_anonymize_patient(id, motivo)
  API->>API: Validar role (admin/dpo)
  API->>API: Validar empresa
  API->>DB: anonymize_patient(id, motivo)
  Note over DB: Zera PII em:<br/>patients, appointments,<br/>medical_records, notifications,<br/>pre_cadastro, audit_logs
  DB->>DB: INSERT log (imutável)
  API-->>A: success
  A-->>P: "Solicitação processada"
```

## Camadas

### 1. Cliente (Frontend)

Aplicação React 18 + TypeScript servida como PWA instalável. Suporta três perfis principais:

- **Paciente (PWA)**: instala no celular, acessa marcação de consulta, exames, prontuário e LGPD.
- **Recepção (Web)**: gerencia agenda, cadastros, confirmações e financeiro do dia-a-dia.
- **Médico (Web)**: prontuário eletrônico, prescrição, laudos e DICOM viewer.
- **Admin (Web)**: configurações, usuários, relatórios, BI e LGPD.

Build via Vite. Code-splitting por rota com `React.lazy()`. Bundle final dividido em chunks manuais (react, supabase, ui, chart, etc).

### 2. CDN / Edge

Cloudflare ou Vercel CDN na frente do app estático. Faz cache de assets, HTTPS com HSTS, headers de segurança (CSP, X-Frame-Options, Referrer-Policy) e compressão Brotli.

### 3. Backend (Supabase)

- **PostgreSQL 16**: banco relacional com RLS (Row Level Security) por empresa (`company_id`).
- **Edge Functions (Deno)**: funções server-side para lógica pesada (TISS XML, DICOM proxy, relatórios).
- **Auth**: Supabase Auth (JWT + Refresh Token) com suporte a 2FA (TOTP) para admin/DPO.
- **Storage S3**: bucket para anexos de prontuário, PDFs de laudos e imagens DICOM processadas.

### 4. Integrações externas

- **Resend**: envio de e-mails transacionais (confirmação de agendamento, recuperação de senha, exportação LGPD).
- **Z-API**: WhatsApp Business API para confirmação 24h antes e lembretes.
- **Twilio**: SMS fallback quando WhatsApp falha.
- **Orthanc (PACS)**: armazenamento e recuperação de imagens DICOM (RX, TC, RM, US).
- **Operadoras TISS**: comunicação XML ANS para faturamento de convênios.

### 5. Workers assíncronos

Worker Node.js rodando via PM2 consome filas internas e dispara notificações multicanal com retry exponencial.

### 6. Segurança em camadas

- **CSP strict** + headers no `index.html`.
- **DOMPurify** em qualquer HTML renderizado.
- **Zod** para validar toda entrada de formulário e env vars.
- **RLS no PostgreSQL** garantindo isolamento multi-tenant.
- **Bcrypt** para senhas (Supabase Auth).
- **Refresh token rotation** para sessões.
- **Auditoria imutável** (append-only com hash chain).

### 7. Observabilidade

- **Sentry**: erros frontend e backend.
- **UptimeRobot**: monitor de uptime HTTP.
- **Logs centralizados** em volume persistente (Docker/VPS) ou serviço gerenciado.
- **Migrations versionadas** em `supabase/migrations/`.

### 8. Multi-tenant

Cada tabela com dados de paciente tem coluna `company_id`. RLS policies usam `auth.uid()` → `users.company_id` para garantir isolamento. Helper `get_my_company_id()` (`SECURITY DEFINER` + `search_path` fixo) é usado dentro de policies e funções.

## Padrões e princípios

- **Offline-first no PWA**: service worker com cache de assets críticos.
- **Acessibilidade WCAG AA**: skip links, ARIA, navegação por teclado, axe-core em dev.
- **Internacionalização (i18n)**: pt-BR padrão, estrutura preparada para en/es.
- **Testes**: 69 specs E2E (Playwright) + 47 unitários (Vitest). Coverage mínimo 70% linhas / 60% branches.
- **CI/CD**: GitHub Actions rodando lint, typecheck, testes unit + E2E em Supabase local (Docker).