# RUNBOOK DE CUTOVER: SIGH → ProntoClinic Hub

**Data de criação**: 2026-06-23
**Versão**: 1.0
**Status**: Aprovado para execução
**Responsável técnico**: Equipe TI Hospital
**Janela de cutover**: Domingo 02:00 - 06:00 BRT (menor tráfego)

---

## VISÃO GERAL

Este runbook documenta a migração completa do sistema legado SIGH (MySQL 5.1 on-premises, 569 tabelas, 555k+ registros) para o ProntoClinic Hub v1.1.0 (Supabase Cloud, 100+ tabelas, ambiente gerenciado).

**Pré-requisitos antes de iniciar qualquer fase**:
- [ ] Backup completo do SIGH executado e validado (ver `backups/datasigh_schema_*.sql`)
- [ ] Backup dos dados críticos em CSV (ver `backups/csv/*.csv`)
- [ ] Migrations do Supabase aplicadas em produção
- [ ] DNS preparado (se aplicável)
- [ ] Equipe de plantão disponível
- [ ] Canal Slack/Teams #cutover-prontoclinic ativo

---

## FASE 0: PREPARAÇÃO (1 semana antes do cutover)

**Duração estimada**: 5-7 dias
**Responsáveis**: Tech Lead + DBA + Coordenador Médico

### 0.1 Backup completo do SIGH
```bash
cd "C:\Users\Meu Computador"
python -c "
import pymysql
from db_datasigh import CONFIG
from datetime import datetime
conn = pymysql.connect(**CONFIG)
cur = conn.cursor()
cur.execute('SHOW TABLES')
tables = [r[0] for r in cur.fetchall()]
ts = datetime.now().strftime('%Y%m%d_%H%M')
with open(f'backups/datasigh_schema_{ts}.sql', 'w', encoding='utf-8') as f:
    for t in tables:
        cur.execute(f'SHOW CREATE TABLE \`{t}\`')
        f.write(cur.fetchone()[1] + ';\n\n')
"
ls -lh backups/datasigh_schema_*.sql
```

### 0.2 Validar backups em ambiente de teste
- [ ] Subir MySQL 5.1 em container Docker local
- [ ] Restaurar `datasigh_schema_*.sql`
- [ ] Executar queries de validação:
  ```sql
  SELECT COUNT(*) FROM pacientes;        -- esperado: 50593
  SELECT COUNT(*) FROM agenda;            -- esperado: 448676
  SELECT COUNT(*) FROM convxmedi;         -- esperado: 48173
  ```
- [ ] Comparar com origem (checksum MD5 de tabelas chave)

### 0.3 Comunicar equipe (reunião presencial)
- **Convocados**: Diretoria, coordenadores de cada setor, TI, faturamento
- **Pauta**: Cronograma, janelas de indisponibilidade, suporte go-live
- **Material**: Apresentação + este runbook impresso
- **Datas críticas** no calendário compartilhado

### 0.4 Canal Slack/Teams para suporte go-live
- Criar canal `#cutover-prontoclinic`
- Adicionar plantonistas (rotação 24/7 durante fases 1-3)
- Configurar bot de alertas conectado ao Supabase + Sentry
- Mensagem fixada com telefones de emergência

### 0.5 Documentar procedimentos de rollback
- [ ] Procedimento de restore SIGH (ver seção ROLLBACK abaixo)
- [ ] Credenciais de admin SIGH e Supabase anotadas em cofre seguro
- [ ] Acesso VPN para MySQL remoto testado
- [ ] Janela de restore definida (RPO: 24h, RTO: 4h)

### 0.6 Go/No-Go checklist
Reunião 48h antes do cutover. Todos devem marcar OK:
- [ ] DBA: backups validados
- [ ] Tech Lead: migrations Supabase aplicadas
- [ ] Frontend: deploy de produção funcional
- [ ] Suporte: escala de plantão confirmada
- [ ] Diretoria: comunicação interna enviada
- [ ] LGPD: conformidade validada

---

## FASE 1: SOFT LAUNCH (Semana 1)

**Duração**: 5 dias úteis
**Usuários**: 2 (1 admin + 1 médico)
**Modo**: Paralelo (SIGH continua produtivo)

### 1.1 Ativação dos usuários piloto
```bash
# No Supabase SQL Editor
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES ('piloto.admin@hospital.com', crypt('<ADMIN_TEMP_PASSWORD>', gen_salt('bf')), NOW());

INSERT INTO user_company_roles (user_id, company_id, role)
VALUES ('UUID_PILOTO', 'EMPRESA_REAL_ID', 'admin');
```

### 1.2 Treinamento dos pilotos (2h)
- Login no ProntoClinic
- Criar paciente, agendar consulta, fechar atendimento
- Emitir prescrição, atestado
- Visualizar relatórios

### 1.3 Operação paralela
- Pilotos usam ProntoClinic para casos NOVOS
- SIGH continua para casos em andamento
- Migração de dados pré-cutover via scripts `migrate_sigh*.py`

### 1.4 Validação diária (Checklist)
Todo dia, ao final do expediente, validar:
- [ ] Login funciona
- [ ] Criação de pacientes sem erro
- [ ] Agenda sincroniza
- [ ] Prescrições salvam
- [ ] Sem erros críticos no console do navegador
- [ ] Sem erros 500 nos logs do Supabase

### 1.5 Coletar feedback
- Reunião rápida (15min) com pilotos todo dia
- Anotar problemas em planilha compartilhada
- Triagem: bloqueante (corrigir imediatamente) vs. melhoria (backlog)

### 1.6 Critério de saída da Fase 1
- 0 erros bloqueantes por 3 dias consecutivos
- Pilotos conseguem completar 100% dos workflows principais
- Performance aceitável (telas < 3s para carregar)

---

## FASE 2: EXPANSÃO GRADUAL (Semanas 2-3)

**Duração**: 10 dias úteis
**Usuários**: 10% por dia (de 107 usuários SIGH)
**Modo**: Paralelo → transição

### 2.1 Cronograma de expansão (10% por dia)
| Dia | % usuários | Setor prioritário | Total |
|-----|------------|-------------------|-------|
| D1  | 10%        | Recepção          | 11    |
| D2  | 20%        | Recepção + 1 médico | 21  |
| D3  | 30%        | + Enfermagem      | 32    |
| D4  | 40%        | + Farmácia        | 43    |
| D5  | 50%        | + 2 médicos       | 54    |
| D6-7| Pausa fim de semana (avaliação) | - | - |
| D8  | 60%        | + Faturamento     | 64    |
| D9  | 70%        | + LIS             | 75    |
| D10 | 80%        | + Cirurgia/Internação | 86 |
| D11 | 100%       | Todos             | 107   |

### 2.2 Monitoramento 24/7
- Sentry configurado para alertar em >5 erros/min
- Dashboard Grafana com métricas:
  - Latência p95 < 2s
  - Taxa de erro < 0.5%
  - Usuários ativos
- Plantão TI em rodízio (3 pessoas, 8h cada)

### 2.3 Suporte presencial
- Primeiros 3 dias: técnico DE CADA SETOR disponível
- Crachá de "Suporte Cutover" para identificação
- Lista de presença nas áreas

### 2.4 Critério de saída da Fase 2
- 80% dos usuários ativos no ProntoClinic
- < 1% taxa de erro em workflows principais
- NPS interno > 7 (escala 0-10)

---

## FASE 3: GO-LIVE (Semana 4)

**Duração**: 1 dia útil (operação completa) + janela de manutenção
**Janela técnica**: Domingo 02:00 - 06:00 BRT
**Usuários**: 100%

### 3.1 Janela de manutenção (D-1, sábado 22:00 → domingo 06:00)
```bash
# 22:00 - Bloquear SIGH para escrita (read-only)
# Apenas admin pode logar
mysql -h 6083041e1bde.sn.mynetname.net -P 47777 -u root -p \
  -e "FLUSH TABLES WITH READ LOCK;"

# 22:30 - Backup final de transição
python -c "
from db_datasigh import CONFIG
import pymysql
from datetime import datetime
conn = pymysql.connect(**CONFIG)
cur = conn.cursor()
cur.execute('FLUSH TABLES WITH READ LOCK')
cur.execute('SHOW TABLES')
tables = [r[0] for r in cur.fetchall()]
ts = datetime.now().strftime('%Y%m%d_%H%M')
with open(f'backups/datasigh_final_{ts}.sql', 'w') as f:
    for t in tables:
        cur.execute(f'SHOW CREATE TABLE \`{t}\`')
        f.write(cur.fetchone()[1] + ';\n\n')
"

# 23:00 - Migração final SIGH → Supabase
python scripts/migrate_sigh.py --final
python scripts/migrate_company_and_medical.py --final

# 01:00 - Validação
python scripts/validate-against-supabase.py --strict

# 02:00 - Cutover DNS (se aplicável)
# Atualizar registro CNAME/hospital.com → prontoclinic.vercel.app

# 02:30 - Smoke tests automatizados
bash scripts/smoke-test.sh --production

# 04:00 - Comunicação "Sistema no ar"
# Mensagem no Slack, email marketing, aviso na recepção

# 06:00 - Abertura oficial
```

### 3.2 SIGH em read-only
- Manter MySQL ativo por 30 dias (read-only)
- Apenas admins acessam para consulta de histórico
- Job diário: snapshot do SIGH para arquivo frio (S3)

### 3.3 Backup final de transição
- `backups/datasigh_final_YYYYMMDD_HHMM.sql` (schema)
- `backups/csv/*.csv` (dados críticos)
- Upload para S3 bucket `sigh-archive-prod` com lifecycle 7 anos

### 3.4 Equipe de plantão no go-live
- Tech Lead (presencial)
- 1 Dev full-stack (remoto, on-call)
- 2 Suporte TI (presencial, andar por andar)
- 1 Enfermeiro super-usuário (consultor)
- Coordenador médico (tomada de decisão clínica)

---

## FASE 4: PÓS GO-LIVE (Semana 5+)

**Duração**: 30 dias (período de estabilização)

### 4.1 Operação estável
- SIGH em read-only (apenas consulta histórica)
- ProntoClinic 100% operacional
- Equipe de suporte em rodízio para dúvidas
- Daily standup 15min durante 2 semanas

### 4.2 Métricas de saúde
- SLA: 99.5% uptime
- Latência p95 < 2s
- Taxa de erro < 0.5%
- NPS usuários > 8

### 4.3 Desligar SIGH (após 30 dias se tudo OK)
- [ ] 0 incidentes críticos nos últimos 14 dias
- [ ] Todos os dados migrados validados
- [ ] Auditoria LGPD concluída
- [ ] Diretoria aprova desligamento
- [ ] Último backup para arquivo morto
- [ ] MySQL desligado, mas snapshot mantido por 7 anos

### 4.4 Auditoria final LGPD
- [ ] Inventário de dados pessoais no ProntoClinic
- [ ] RIPD (Relatório de Impacto à Proteção de Dados)
- [ ] Contratos com fornecedores atualizados (Supabase DPA)
- [ ] Política de retenção definida
- [ ] DPO assina conformidade

### 4.5 Documentação de processos atualizada
- [ ] Manual do usuário (PDF)
- [ ] Runbook de incidentes
- [ ] Procedimento de backup/restore
- [ ] Contatos de suporte (Supabase, devs)
- [ ] Treinamento gravado (vídeo 30min)

### 4.6 Retrospectiva (reunião de fechamento)
- O que foi bem?
- O que pode melhorar?
- Lições aprendidas para próximos cutovers
- Apresentação para diretoria

---

## ROLLBACK

### Stop conditions (acionar rollback IMEDIATAMENTE se):
1. **Taxa de erro > 5%** por mais de 15 minutos consecutivos
2. **Indisponibilidade total** do ProntoClinic por > 30 minutos sem resolução
3. **Perda de dados** confirmada por audit log
4. **Incidente de segurança** (vazamento, acesso indevido)
5. **Rejeição em massa** dos usuários médicos (> 50% das prescrições não fecham)
6. **Bloqueio regulatório** (LGPD, conselho regional)
7. **Falha de integração crítica** (LIS, PACS, faturamento)

### Quem pode acionar rollback
- Tech Lead
- Diretor médico
- DPO (em caso de incidente LGPD)
- CTO/CIO

### Procedimento de restore SIGH (RTO: 4 horas)
```bash
# 1. Desbloquear SIGH (se estiver read-only)
# Acessar MySQL remoto via VPN
mysql -h 6083041e1bde.sn.mynetname.net -P 47777 -u admin -p

# 2. Verificar último backup íntegro
ls -lh backups/datasigh_final_*.sql

# 3. Restaurar schema
mysql -h 6083041e1bde.sn.mynetname.net -P 47777 -u root -p DataSIGH \
  < backups/datasigh_final_YYYYMMDD_HHMM.sql

# 4. Reativar permissões de escrita
# Remover read-only dos usuários

# 5. Comunicação imediata
# Slack #cutover-prontoclinic: "ROLLBACK INICIADO - SIGH REATIVADO"
# Email/SMS para usuários chave

# 6. Post-mortem em 48h
```

### Comunicação de rollback
- Imediatamente: Slack + SMS para Tech Lead e Diretoria
- Em 1h: email para todos os usuários
- Em 4h: comunicado oficial explicando motivo e prazo de retorno

### Pós-rollback
- [ ] Post-mortem em 48h (sem culpados, só fatos)
- [ ] Identificar causa raiz
- [ ] Plano de remediação
- [ ] Reagendar cutover (mínimo 2 semanas depois)

---

## CONTATOS DE EMERGÊNCIA

| Função               | Nome              | Telefone        | Email                |
|----------------------|-------------------|-----------------|----------------------|
| Tech Lead            | [preencher]       | [preencher]     | [preencher]          |
| Diretor Médico       | [preencher]       | [preencher]     | [preencher]          |
| CTO/CIO              | [preencher]       | [preencher]     | [preencher]          |
| DBA                  | [preencher]       | [preencher]     | [preencher]          |
| Suporte Supabase     | Supabase Support  | -               | support@supabase.io  |
| Plantão TI           | [preencher]       | [preencher]     | [preencher]          |

---

## CHECKLIST FINAL - GO/NO-GO

**48h antes do cutover**, marcar TODOS os itens:

### Infraestrutura
- [ ] SIGH: backup completo executado e validado
- [ ] SIGH: backup final agendado
- [ ] Supabase: migrations aplicadas
- [ ] Supabase: RLS policies testadas
- [ ] Frontend: deploy em produção funcional
- [ ] DNS: registros prontos para apontar
- [ ] SSL: certificados válidos

### Dados
- [ ] Pacientes migrados (50.593 esperados)
- [ ] Agenda migrada (448.676 esperados)
- [ ] Convênios migrados (992 esperados)
- [ ] Usuários migrados (107 esperados)
- [ ] Auditoria pós-migração validada

### Equipe
- [ ] Plantão 24/7 confirmado
- [ ] Canal #cutover-prontoclinic ativo
- [ ] Lista de contatos atualizada
- [ ] Procedimento de rollback treinado

### Comunicação
- [ ] Email pré-cutover enviado (72h antes)
- [ ] Lembrete enviado (24h antes)
- [ ] Comunicado durante cutover
- [ ] Comunicado pós-cutover (sucesso ou rollback)

### Compliance
- [ ] LGPD: DPA Supabase assinado
- [ ] LGPD: política de retenção definida
- [ ] Conselho Regional: ciência da mudança
- [ ] Auditoria interna aprovada

**APROVAÇÃO FINAL**:
- [ ] Tech Lead: _________________ Data: _______
- [ ] Diretor Médico: __________ Data: _______
- [ ] CTO/CIO: ________________ Data: _______

---

**FIM DO RUNBOOK**

Para qualquer dúvida, consultar `ARCHITECTURE.md` ou abrir issue no repositório.

