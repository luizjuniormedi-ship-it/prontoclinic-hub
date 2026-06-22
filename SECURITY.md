# Política de Segurança

A segurança dos dados de pacientes é a maior prioridade do ProntoMedic. Este documento descreve como reportar vulnerabilidades e as práticas de segurança implementadas.

## Versões suportadas

| Versão | Suporte | Status |
|---|---|---|
| 1.x | Sim | Atual |
| 0.x (legado SIGH) | Não | EOL — migre para 1.x |
| Pré-1.0 | Não | Descontinuado |

Apenas a versão mais recente recebe patches de segurança. Recomendamos sempre atualizar.

## Como reportar vulnerabilidade

**NÃO** abra issue pública com detalhes de vulnerabilidade.

**Email**: security@prontomedic.com.br

**Assunto**: `[SECURITY] <descrição breve>`

Inclua:
- Descrição técnica da vulnerabilidade
- Steps para reproduzir
- Impacto potencial
- Sugestão de fix (opcional)
- Sua forma de contato

**Resposta**: em até 48h úteis.

**PGP key** (opcional, para detalhes sensíveis):
```
Fingerprint: XXXX XXXX XXXX XXXX XXXX  XXXX XXXX XXXX XXXX XXXX
Key ID: 0xXXXXXXXXXXXX
Download: https://prontomedic.com.br/.well-known/pgp-key.asc
```

### Programa de bug bounty

Temos um programa de bug bounty ativo. Veja detalhes em https://prontomedic.com.br/security/bounty.

**Recompensas**:
- Crítica (RCE, auth bypass): R$ 5.000 – R$ 20.000
- Alta (SQL injection, XSS stored): R$ 1.000 – R$ 5.000
- Média (XSS reflected, CSRF): R$ 200 – R$ 1.000
- Baixa (info disclosure, misconfig): R$ 50 – R$ 200

### Hall of Fame

Pesquisadores que contribuíram com reportes válidos (apenas com permissão):
- (em construção)

## Práticas de segurança implementadas

### Autenticação e Autorização

- **Senhas**: hash bcrypt (12 rounds) via Supabase Auth
- **2FA**: disponível para todos os usuários (TOTP, SMS, email)
- **2FA obrigatório**: para perfis admin e DPO
- **Sessões**: JWT com expiração configurável (padrão 1h)
- **Refresh tokens**: rotação automática
- **SSO**: suporte a SAML 2.0 e OIDC (plano Enterprise)
- **RBAC**: controle de acesso por papel (admin, médico, recepção, faturamento, paciente)
- **Princípio do menor privilégio**: cada papel só tem acesso ao necessário

### Banco de Dados

- **RLS (Row Level Security)**: 100% das tabelas com dados de pacientes
- **Policies testadas**: cobertura de testes para cada policy
- **Criptografia em repouso**: AES-256 no Supabase
- **Criptografia em trânsito**: TLS 1.3 mínimo
- **Backups**: diários, criptografados, retenção 30 dias
- **Point-in-time recovery**: até 7 dias (plano Pro)
- **Connection pooling**: PgBouncer configurado

### Auditoria (CFM 1.821/2007)

- **Trilha de auditoria completa**: INSERT, UPDATE, DELETE
- **Logs imutáveis**: append-only, com hash chain
- **Particionamento por ano**: performance + retenção
- **Retenção**: 10 anos
- **Acesso restrito**: apenas DPO e admin
- **Exportação**: JSON/CSV para auditorias externas

### Aplicação

- **HTTPS obrigatório**: HSTS habilitado
- **CSP (Content Security Policy)**: configurado contra XSS
- **CORS**: restrito aos domínios autorizados
- **Rate limiting**: 100 req/min por IP, 1000 req/min por usuário
- **Validação de input**: Zod em todas as APIs
- **Sanitização de HTML**: DOMPurify em conteúdo rico
- **CSRF tokens**: gerados por sessão
- **Secure cookies**: HttpOnly, Secure, SameSite=Strict
- **Headers de segurança**: X-Frame-Options, X-Content-Type-Options, Referrer-Policy

### Infraestrutura

- **Supabase Cloud**: SOC 2 Type II, ISO 27001, HIPAA eligible
- **Vercel/Netlify**: SSL gerenciado, DDoS protection
- **WAF**: Cloudflare no front
- **Monitoring**: Sentry (errors), Datadog (metrics)
- **Logs centralizados**: retenção 90 dias
- **Alertas**: anomalia em tempo real

### LGPD

- **Consentimento explícito**: opt-in documentado
- **Finalidade específica**: declarada por coleta
- **Minimização**: coletamos apenas o necessário
- **Retenção**: política configurada por tipo de dado
- **Direito ao esquecimento**: anonimização implementada
- **Portabilidade**: export JSON/CSV/PDF
- **Encarregado (DPO)**: designado e contatável

### Telemedicina (quando disponível)

- **Criptografia E2E**: chamadas de vídeo (Daily.co)
- **Sem gravação**: padrão opt-in por consulta
- **Logs de presença**: para auditoria CFM 2.314/2022

## Decisão: Autenticação com localStorage

**Contexto:** O Supabase Auth usa `localStorage` por padrão para persistir tokens JWT.

**Trade-offs:**
- ✅ Padrão Supabase, bem documentado e testado
- ✅ Funciona offline (PWA)
- ❌ Token acessível via XSS

**Mitigações implementadas:**
1. CSP strict bloqueando scripts não autorizados
2. Sanitização DOMPurify em todo `dangerouslySetInnerHTML`
3. Validação Zod em todas as env vars
4. RLS no Supabase limita acesso por `company_id` mesmo com token válido
5. Refresh token rotation automática
6. `autoRefreshToken: true` revoga tokens antigos

**Para produção regulada (PHI):** considerar migração para cookies httpOnly quando backend próprio for adicionado. Por ora, localStorage é aceitável dado o CSP e RLS em camadas.

**Tempo de sessão:**
- Token JWT: 1 hora
- Refresh token: 7 dias
- Logout automático após 15 minutos de inatividade (recomendação clínica)

## CVEs conhecidas

**Nenhuma vulnerabilidade pública conhecida no momento.**

Para ver histórico de CVEs, consulte o [GitHub Security Advisories](https://github.com/seu-usuario/prontoclinic-hub/security/advisories).

## Boas práticas para devs

### O que fazer

- Use sempre TypeScript strict
- Valide entrada com Zod
- Use RLS em toda tabela nova
- Escreva testes para regras de negócio
- Faça self-review antes de abrir PR
- Use senhas fortes e 2FA
- Mantenha dependências atualizadas
- Rode `npm audit` antes de cada release

### O que NÃO fazer

- **NUNCA** commite `.env` ou credenciais
- **NUNCA** exponha `service_role` key no client
- **NUNCA** desabilite RLS em produção
- **NUNCA** faça `SELECT *` em dados de pacientes sem filtro
- **NUNCA** logue dados sensíveis (CPF, prontuário)
- **NUNCA** use `eval()`, `Function()`, ou SQL dinâmico
- **NUNCA** confie em input do cliente (sempre valide)
- **NUNCA** desabilite headers de segurança
- **NUNCA** armazene senhas em plain text
- **NUNCA** use `dangerouslySetInnerHTML` sem sanitização

### Checklist de segurança para PR

- [ ] Sem credenciais commitadas (verificar com `git diff`)
- [ ] RLS aplicado se criou tabela
- [ ] Validação Zod em inputs novos
- [ ] Sem `any` em código novo
- [ ] Sem `console.log` de dados sensíveis
- [ ] Sem dependências com vulnerabilidades conhecidas
- [ ] Testes de segurança (auth, authz, input validation)

## Testes de segurança automatizados

- **OWASP ZAP**: scan semanal em staging
- **npm audit**: em cada CI build
- **Snyk**: monitoramento contínuo de dependências
- **Trivy**: scan de imagens Docker
- **Semgrep**: SAST (Static Application Security Testing)
- **axe-core**: testes de acessibilidade (relacionado a segurança)

## Compliance

- **LGPD** (Lei Geral de Proteção de Dados)
- **CFM 1.821/2007** (auditoria em prontuários)
- **CFM 2.217/2018** (retenção de prontuários: 20 anos)
- **CFM 2.314/2022** (telemedicina)
- **TISS 3.05** (padrão ANS)
- **ICP-Brasil** (assinatura digital)
- **PCI DSS** (se aplicável a pagamentos)

## Contato de segurança

- **Email**: security@prontomedic.com.br
- **DPO**: dpo@prontomedic.com.br
- **Telefone**: (XX) XXXX-XXXX (ramal segurança)
- **Endereço postal**: Av. XXX, nº XXX — Cidade/UF — CEP XXXXX-XXX
  A/C: Equipe de Segurança

---

_Agradecemos a pesquisadores e usuários que contribuem para manter o ProntoMedic seguro._
