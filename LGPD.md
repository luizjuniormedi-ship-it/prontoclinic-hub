# LGPD — ProntoClinic Hub

> Módulo de conformidade com a **Lei Geral de Proteção de Dados (Lei 13.709/2018)**
> integrado ao prontoclinic-hub, em sinergia com regulamentações setoriais do CFM.

## Conformidade

- **Lei 13.709/2018 (LGPD)** — proteção de dados pessoais no Brasil
- **Resolução CFM 1.821/2007** — digitalização e manuseio de prontuários
- **Resolução CFM 2.299/2021** — telemedicina e dados de saúde a distância
- **Resolução CNS 466/2012** — pesquisa com seres humanos (anonimização)
- **CTN art. 205 + Legislação Fiscal** — retenção de documentos financeiros (5 anos)

## Direitos do titular (art. 18)

Implementados como workflows rastreáveis no sistema:

- [x] **Acesso** (I) — paciente recebe cópia de todos os seus dados
- [x] **Confirmação de existência** (II) — `getConsentimentos` + `exportarDados`
- [x] **Correção** (III) — `updateConsentimento` + edição de cadastro
- [x] **Anonimização** (IV) — `executeEsquecimento` (mantém registro sem PII)
- [x] **Portabilidade** (V) — `exportarDados` retorna JSON completo
- [x] **Eliminação** (VI) — `executeEsquecimento` (direito ao esquecimento)
- [x] **Revogação de consentimento** (IX) — `updateConsentimento(optin=false)`

## Implementação

### Estrutura de tabelas (migration 20260101000006_lgpd.sql)

| Tabela | Função | RLS |
|---|---|---|
| `paciente_consentimentos` | Opt-in/opt-out granular por canal (SMS, e-mail, WhatsApp, push) com versão do termo + hash SHA-256 do texto + IP de origem | SELECT company-wide; INSERT para titular + admin; UPDATE admin |
| `paciente_anonimizacao_log` | Trilha **imutável** (triggers bloqueiam UPDATE/DELETE) das anonimizações executadas | SELECT company-wide; INSERT apenas admin |
| `lgpd_solicitacoes` | Workflow dos 5 tipos de solicitação (ACESSO, PORTABILIDADE, CORRECAO, ESQUECIMENTO, REVOGACAO) com prazo de 15 dias | SELECT company-wide; INSERT titular; UPDATE admin |
| `lgpd_politica_retencao` | Configuração por empresa e tabela: dias + ação (ARQUIVAR / DELETAR / ANONIMIZAR) | SELECT company-wide; ALL admin |

### Função `anonymize_patient(id, motivo)` (RPC)

```sql
SELECT public.anonymize_patient(12345, 'EXERCICIO_DIREITO_ESQUECIMENTO');
-- Retorna JSONB com snapshot do que foi anonimizado
```

- **Atomicidade** — UPDATE + INSERT no log na mesma transação
- **SECURITY DEFINER** — pode ser chamada por qualquer usuário com policy de INSERT no log
- **Validação** — verifica que o motivo está na whitelist de 5 valores aceitos
- **Idempotência parcial** — registra em log apenas se o paciente existir

### View `pacientes_anonimizaveis`

```sql
SELECT * FROM public.pacientes_anonimizaveis;
-- Pacientes inativos há > 5 anos, não obituados, não anonimizados
```

Exclui explicitamente:
- Pacientes já anonimizados (`lg_anonimizado = TRUE`)
- Pacientes com óbito registrado (`dt_obito IS NOT NULL`)
- Pacientes já presentes no log de anonimização

## Política de retenção padrão

Recomendada por regulação — aplicada via `lgpdService.seedPoliticaPadrao(companyId)`:

| Tabela | Dias | Anos | Ação | Justificativa |
|---|---|---|---|---|
| `audit_logs` | 1825 | 5 | ARQUIVAR | Regulatório + defesa em juízo |
| `appointments` | 1825 | 5 | ARQUIVAR | Resolução CFM 1.821/2007 |
| `medical_records` | 7300 | 20 | ARQUIVAR | Prontuário médico (CFM) |
| `financial_transactions` | 1825 | 5 | ARQUIVAR | CTN art. 205 + legislação fiscal |
| `notifications` | 365 | 1 | DELETAR | Sem finalidade após envio |

## Job automático de anonimização

**Recomendado**: cron diário via Supabase Edge Function (ou pg_cron).

```sql
-- Executa em lote limitado para evitar lock contention
SELECT anonymize_patient(id, 'INATIVO_5_ANOS')
FROM pacientes_anonimizaveis
LIMIT 100;
```

Via TypeScript:

```typescript
import { lgpdService } from "@/services/lgpdService";

const resultado = await lgpdService.executarAnonimizacaoMassa("INATIVO_5_ANOS", 100);
// { sucesso: 87, falha: 0, erros: [] }
```

A função expõe `getPacientesAnonimizaveis(limit)` para **pré-visualização** antes da execução
e trata erros individualmente sem interromper o lote.

## Direito de portabilidade (art. 18 V)

`lgpdService.exportarDados(patientId)` retorna JSON com:

```typescript
{
  gerado_em: "2026-06-22T...",
  versao: "1.0",
  paciente: { ...todos os campos... },
  agendamentos: [ ... ],
  prontuarios: [ ... ],
  exames: [ ... ],
  financeiro: [ ... ],
  consentimentos: [ ... ],
  logs_auditoria: [ ... ]  // quem acessou os dados deste paciente
}
```

É gerado de forma **resiliente** — se uma tabela relacionada não existir,
a seção correspondente retorna `[]` em vez de falhar.

## Consentimento granular (art. 8)

Cada opt-in/opt-out é registrado com:
- `cd_canal` (1=SMS, 2=EMAIL, 3=WHATSAPP, 4=PUSH)
- `versao_termo` (ex: `v1.0-2026-06-22`) — versão jurídica do termo
- `texto_termo_hash` — SHA-256 do texto exato aceito (prova de ciência)
- `ip_origem` — IP do titular (prova de origem)
- `user_agent` — navegador/app de origem
- `dt_optin` / `dt_revocacao` — datas de vigência

A UNIQUE constraint `(cd_paciente, cd_canal, versao_termo)` garante que o histórico
é **imutável** — uma nova revogação cria um novo registro, nunca sobrescreve.

## Fluxo de solicitações

```
Titular acessa portal
       |
       v
Cria solicitação (15d)  ────────────  PENDENTE
       |
       v
Admin inicia processamento  ────────  EM_ANDAMENTO
       |
       +───────────────────  CONCLUIDA  (com payload de exportação)
       |
       +───────────────────  REJEITADA  (com motivo_rejeicao)
```

SLA legal: **15 dias** (art. 18 §5). A UI sinaliza solicitações próximas do vencimento
e vencidas com código de cor (laranja 0-3 dias, vermelho vencido).

## Segurança e boas práticas

1. **Imutabilidade do log** — `paciente_anonimizacao_log` tem triggers
   `BEFORE UPDATE` e `BEFORE DELETE` que lançam EXCEPTION.
2. **Hash do termo** — impossível alterar o termo aceito retroativamente.
3. **RLS multi-tenant** — todas as tabelas filtram por `company_id`.
4. **SECURITY DEFINER** — RPC com permissão elevada, mas validações de input.
5. **Zod validation** — service TS valida todos os inputs antes de chamar Supabase.
6. **Prazo legal** — workflow alerta sobre solicitações próximas do vencimento.
7. **Caractere de hash** — uso de SHA-256 (64 caracteres) garante integridade.

## Arquivos do módulo

| Arquivo | Descrição |
|---|---|
| `supabase/migrations/20260101000006_lgpd.sql` | Schema completo + funções + RLS + triggers |
| `src/services/lgpdService.ts` | Service TypeScript (~400 linhas) |
| `src/components/lgpd/LGPDManager.tsx` | UI com 5 abas (consentimentos, solicitações, política, anonimização, auditoria) |
| `LGPD.md` | Esta documentação |

## Testes e verificação manual

```sql
-- Verificar triggers de imutabilidade
UPDATE paciente_anonimizacao_log SET motivo = 'TESTE' WHERE id = 1;
-- Esperado: ERROR — paciente_anonimizacao_log é imutável

-- Testar anonimização atômica
SELECT anonymize_patient(1, 'OBITO');
-- Esperado: { "nome_anterior": "...", "cpf_anonimizado": "123********" }

-- Listar anonimizáveis
SELECT COUNT(*) FROM pacientes_anonimizaveis;
```

## Referências legais

- LGPD: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
- Resolução CFM 1.821/2007: <https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2007/1821>
- Resolução CFM 2.299/2021: <https://www.in.gov.br/en/web/dou/-/resolucao-n-2.299-de-15-de-junho-de-2021-323025501>
- Guia ANPD: <https://www.gov.br/anpd/pt-br>