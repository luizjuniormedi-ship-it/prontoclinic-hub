# Como Contribuir

Obrigado por contribuir com o ProntoMedic! Este documento cobre o fluxo de trabalho, padrões e boas práticas.

## Setup de dev

```bash
# 1. Fork e clone
git clone https://github.com/seu-usuario/prontoclinic-hub.git
cd prontoclinic-hub

# 2. Instale dependências
npm install

# 3. Configure env
cp .env.example .env
# Edite .env com suas credenciais Supabase de dev

# 4. Aplique migrations
supabase db push

# 5. Rode os testes para garantir baseline
npm run test
npm run test:e2e

# 6. Inicie dev server
npm run dev
```

## Estrutura de branches

| Branch | Propósito |
|---|---|
| `main` | Produção (protegida) |
| `develop` | Próxima release |
| `feature/*` | Nova feature |
| `fix/*` | Bug fix |
| `hotfix/*` | Fix urgente em produção |
| `release/*` | Preparação de release |
| `docs/*` | Apenas documentação |

Exemplos:
- `feature/pre-cadastro-online`
- `fix/agenda-timezone-bug`
- `hotfix/security-rls-bypass`

## Padrão de commits (Conventional Commits)

```
<tipo>(<escopo>): <descrição curta>

<corpo opcional>

<footer opcional>
```

### Tipos

| Tipo | Uso |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Bug fix |
| `docs` | Apenas documentação |
| `style` | Formatação (sem mudança de lógica) |
| `refactor` | Refatoração (sem nova feature ou fix) |
| `perf` | Melhoria de performance |
| `test` | Adicionar/corrigir testes |
| `chore` | Build, CI, dependências |
| `ci` | Mudanças em CI |
| `revert` | Reverter commit anterior |

### Exemplos

```bash
feat(agenda): adicionar drag-and-drop entre profissionais
fix(prontuario): corrigir salvamento de CID-10 com caracteres especiais
docs(readme): atualizar stack com Orthanc
refactor(services): extrair lógica de comissão para função pura
test(lgpd): adicionar teste de anonimização
chore(deps): atualizar shadcn/ui para 0.95
```

### Breaking changes

Indique com `!` no tipo:

```bash
feat(api)!: migrar autenticação para Supabase Auth
```

## Antes de abrir PR

- [ ] Testes passam (`npm run test` e `npm run test:e2e`)
- [ ] Lint passa (`npm run lint`)
- [ ] Type check passa (`npx tsc --noEmit`)
- [ ] Documentação atualizada (se aplicável)
- [ ] Self-review feita
- [ ] Migrations SQL versionadas em `supabase/migrations/`
- [ ] Sem credenciais/segredos commitados
- [ ] Branch atualizada com `develop`
- [ ] Commits seguem Conventional Commits
- [ ] PR aberto contra `develop` (ou `main` para hotfix)

## Code review

### Processo

1. Abra PR com template preenchido
2. CI deve passar (lint, type-check, testes)
3. Mínimo 2 aprovadores
4. Discussão de arquitetura **antes** de PR grande (abra issue primeiro)
5. Reviewer aprova com `/approve` (ou comenta para pedir mudanças)
6. Squash-merge para `develop`

### O que avaliamos

- **Corretude**: faz o que deveria fazer? Edge cases cobertos?
- **Testes**: regras de negócio têm testes? Cobertura adequada?
- **Legibilidade**: nomes descritivos? Funções pequenas?
- **Performance**: queries otimizadas? Re-renders desnecessários?
- **Segurança**: RLS? Validação de input? SQL injection? XSS?
- **LGPD**: dados sensíveis? Logs? Retenção?
- **Acessibilidade**: ARIA? Navegação por teclado? Contraste?

## Estilo de código

### TypeScript

- `strict: true` obrigatório
- Sem `any` (use `unknown` se necessário)
- Prefira `type` para unions, `interface` para objetos extensíveis
- Enums: prefira `as const` ao invés de `enum`
- Use Zod para validação em runtime

### ESLint + Prettier

- Configuração padrão do projeto
- Rode `npm run lint -- --fix` antes de commitar

### Nomenclatura

| Contexto | Idioma | Exemplo |
|---|---|---|
| Domínio (negócio) | Português | `paciente`, `agendamento`, `convenio` |
| Técnico (código) | Inglês | `useAuth`, `formatDate`, `PatientCard` |
| Tabelas/colunas SQL | Português (snake_case) | `pacientes`, `data_nascimento` |
| Variáveis JS/TS | Inglês (camelCase) | `patientName`, `appointmentDate` |
| Componentes React | Inglês (PascalCase) | `PatientCard`, `AgendaGrid` |
| Hooks | Inglês (camelCase com `use`) | `useAuth`, `useAppointments` |

### Comentários

- Em **português**
- Explique o **porquê**, não o **o quê**
- Use JSDoc para funções públicas

```typescript
/**
 * Calcula o valor final de um agendamento aplicando tabela de preços e convênio.
 * @param appointment - Agendamento com procedimento e convênio
 * @returns Valor em centavos
 */
function calculateAppointmentPrice(appointment: Appointment): number {
  // Tabela de preços do convênio tem prioridade sobre a tabela padrão
  return getPriceTable(appointment.insuranceId).lookup(appointment.procedureCode);
}
```

### Testes

- Todo módulo de negócio precisa de teste
- Use `describe` + `it` (ou `test`)
- Arrange-Act-Assert
- Mock apenas o necessário
- Cobertura mínima: 80% em `src/services/` e `src/lib/`

## Segurança

- **NUNCA** commite `.env` ou credenciais
- **NUNCA** exponha `service_role` key no client
- Use RLS em **todas** as tabelas com dados de pacientes
- Valide toda entrada do usuário (Zod)
- Sanitize HTML (DOMPurify)
- Use prepared statements (Supabase client já faz)
- Senhas com hash (bcrypt/argon2) — Supabase Auth gerencia
- 2FA para usuários admin

## Migrações de banco

### Quando criar migration

- Adicionar/alterar tabela
- Adicionar/alterar coluna
- Adicionar/alterar índice
- Adicionar/alterar policy RLS
- Adicionar/alterar function/trigger

### Convenção de nome

```
<YYYYMMDDHHMMSS>_<descricao_curta>.sql
```

Exemplo: `20260122120000_add_lgpd_export_table.sql`

### Checklist

- [ ] Migration é idempotente (`IF NOT EXISTS`)
- [ ] Tem `down` (se reversível)
- [ ] Comentários explicam o propósito
- [ ] Testada em dev
- [ ] Seed relacionado atualizado

## Reportando bugs

Use o template `.github/ISSUE_TEMPLATE/bug_report.md`.

## Sugerindo features

Use o template `.github/ISSUE_TEMPLATE/feature_request.md`.

## Código de conduta

- Seja respeitoso e inclusivo
- Foque na ideia, não na pessoa
- Aceite crítica construtiva
- Priorize a comunidade

## Dúvidas?

- Abra issue com label `question`
- Email: dev@prontomedic.com.br
- Slack interno (link no onboarding)

Obrigado por contribuir!
