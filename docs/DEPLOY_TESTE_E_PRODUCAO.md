# DEPLOY TESTE E PRODUCAO â€” Plano Completo

**Sistema**: ProntoClinic Hub v1.1.0
**Cliente**: POLICLINICA MEDILIFE DIAGNOSTICOS LTDA â€” Sao Goncalo/RJ
**Versao documento**: 1.0
**Data**: 03/07/2026
**Status**: APROVADO PARA EXECUCAO
**Prazo total**: 3-4 semanas (1-2 semanas homolog + 1 semana producao + 2 semanas estabilizacao)

---

## SUMARIO

1. [Visao geral](#1-visao-geral)
2. [FASE 1: TESTE/HOMOLOG](#2-fase-1-homonog-homolog-1-2-semanas)
3. [FASE 2: PRODUCAO](#3-fase-2-producao-1-semana)
4. [FASE 3: ESTABILIZACAO](#4-fase-3-estabilizacao-2-semanas)
5. [Cronograma](#5-cronograma)
6. [Checklist de validacao](#6-checklist-de-validacao)
7. [Criterios de aceite](#7-criterios-de-aceite)
8. [Comandos rapidos](#8-comandos-rapidos)
9. [Riscos e mitigacoes](#9-riscos-e-mitigacoes)
10. [Equipe e responsabilidades](#10-equipe-e-responsabilidades)

---

## 1. VISAO GERAL

Este documento descreve o plano completo de deploy em DUAS fases: TESTE (homolog) seguido de PRODUCAO. Foi desenhado para minimizar riscos e garantir que a MEDILIFE tenha um go-live tranquilo.

### 1.1 Objetivos

| Fase | Objetivo | Duracao | Criterio de saida |
|---|---|---|---|
| FASE 1: TESTE | Validar o sistema em homolog com dados reais anonimizados | 1-2 semanas | Equipe MEDILIFE assina termo de aceite |
| FASE 2: PRODUCAO | Substituir o SIGH em producao real | 1 semana (cutover) | Sistema em producao estavel |
| FASE 3: ESTABILIZACAO | Acompanhar uso real e ajustar finos | 2 semanas | SIGH descomissionado |

### 1.2 Topologia simplificada

```
   FASE 1 (TESTE)                  FASE 2 (PRODUCAO)
   ==============                  ==================

   [Internet]                      [Internet]
       |                               |
       v                               v
   [Cloudflare]                    [Cloudflare]
       |                               |
       v                               v
   [Vercel CDN]                    [Cloudflare Tunnel]
       |                               |
       v                               v
   [Supabase Cloud]                [Servidor Fisico Dell R250]
   (homolog separado)              (Supabase self-hosted)
                                       |
   Dados: anonimizados                  v
   Usuarios: 1 admin demo            [NAS backup + off-site]
                                      Dados: reais (LGPD)
                                      Usuarios: 107 importados SIGH
```

---

## 2. FASE 1: HOMONOG (HOMOLOG) â€” 1-2 semanas

### 2.1 Objetivo
Validar o sistema ProntoClinic Hub em ambiente controlado com dados do SIGH (anonimizados), acessivel pela equipe MEDILIFE para testes finais antes do go-live.

### 2.2 Componentes do ambiente

| Componente | Especificacao |
|---|---|
| **Dominio** | `homolog.medilife.com.br` |
| **Frontend** | Vercel (CDN global, regiao gru1 = Sao Paulo) |
| **Backend** | Supabase Cloud (projeto separado `medilife-homolog`) |
| **Banco** | PostgreSQL gerenciado pela Supabase |
| **DICOM** | Orthanc mockado em localhost (dev) |
| **Auth** | Supabase Auth (GoTrue) Cloud |
| **SSL** | Vercel (Let's Encrypt automatico) |
| **DNS** | Cloudflare com CNAME para `cname.vercel-dns.com` |

### 2.3 Plano de execucao (dia a dia)

#### DIA 1 (segunda) â€” Provisionamento (4h)
- [ ] Criar projeto Supabase `medilife-homolog` (sa-east-1)
- [ ] Criar projeto Vercel `prontoclinic-hub-homolog`
- [ ] Linkar projeto Supabase: `supabase link --project-ref <REF>`
- [ ] Aplicar migrations: `supabase db push --include-all`
- [ ] Aplicar seed de teste: `scripts/seed-test-data.sql`
- [ ] Configurar env vars no Vercel (9 vars)
- [ ] Fazer primeiro deploy: `vercel deploy --yes`

#### DIA 1 (continuacao) â€” DNS e dominio (1h)
- [ ] Adicionar dominio: `vercel domains add homolog.medilife.com.br`
- [ ] Configurar CNAME no Cloudflare:
  - Tipo: CNAME
  - Nome: homolog
  - Destino: `cname.vercel-dns.com`
  - Proxy: Desligado (DNS only) na Vercel
- [ ] Aguardar propagacao DNS (ate 48h)

#### DIA 2 (terca) â€” Smoke tests (2h)
- [ ] Rodar smoke tests: `bash scripts/smoke-test.sh --env=homolog`
- [ ] Validar login com usuario demo (admin@test.local / admin123)
- [ ] Verificar endpoints REST do Supabase
- [ ] Testar upload de arquivo DICOM mockado
- [ ] Testar geracao de relatorio TISS em homologacao
- [ ] Validar LGPD: logs de auditoria gravando

#### DIA 3-4 (quarta-quinta) â€” Carga de dados reais (anonimizados) (4h)
- [ ] Backup do SIGH (ja temos o backup completo)
- [ ] Rodar script de anonimizacao:
  - `scripts/migrate_sigh_to_postgres.py --anonymize --target=homolog`
- [ ] Validar contagens:
  - 50k+ pacientes (anonimizados)
  - 1.6k+ profissionais
  - 555k+ prontuarios
- [ ] Validar performance: latencia p95 < 300ms

#### DIA 5 (sexta) â€” Treinamento da equipe MEDILIFE (8h)
- [ ] Recepcao (2 pessoas): agendamento, busca de paciente, check-in
- [ ] Medicos (3 pessoas): prontuario, evolucao SOAP, prescricao
- [ ] Laboratorio (2 pessoas): LIS, pedidos de exame, resultados
- [ ] Coordenacao (1 pessoa): relatorios TISS, BI, faturamento
- [ ] TI MEDILIFE (2 pessoas): backup, restore, gestao de usuarios

#### DIA 6-7 (sabado-domingo) â€” Testes autonomos
- [ ] Equipe MEDILIFE testa livremente
- [ ] Equipe TI monitora logs e metricas
- [ ] Reportar bugs via canal Slack/Teams

#### DIA 8-10 (segunda a quarta) â€” Ajustes finos
- [ ] Corrigir bugs criticos (P0) â€” sem excecao
- [ ] Corrigir bugs medios (P1) se possivel
- [ ] Adicionar melhorias solicitadas pela equipe MEDILIFE (se faceis)

#### DIA 11-12 (quinta-sexta) â€” Segunda rodada de testes
- [ ] Validar correcoes
- [ ] Testes de carga: 50 usuarios simultaneos
- [ ] Validar backup automatizado

#### DIA 13 (sexta) â€” Aprovacao formal
- [ ] Coordenador medico assina termo de aceite
- [ ] DPO valida logs de auditoria
- [ ] Equipe TI valida backups
- [ ] DECISAO: GO/NO-GO para producao

### 2.4 Criterios de saida da Fase 1

A fase de homolog so termina quando:

- [ ] Smoke tests passaram 100% por 3 dias consecutivos
- [ ] 0 erros 5xx em 7 dias
- [ ] Latencia p95 < 300ms (medida diariamente)
- [ ] Equipe MEDILIFE (5+ pessoas) treinada e validou fluxos principais
- [ ] Bugs P0 resolvidos 100%
- [ ] Bugs P1 resolvidos >= 80%
- [ ] Termo de aceite assinado por coordenador medico
- [ ] DPO validou conformidade LGPD

---

## 3. FASE 2: PRODUCAO â€” 1 semana

### 3.1 Objetivo
Realizar o cutover SIGH â†’ ProntoClinic em ambiente de producao real, com plano de rollback caso algo falhe.

### 3.2 Componentes do ambiente

| Componente | Especificacao |
|---|---|
| **Dominio** | `medilife.com.br` (e `www.medilife.com.br`) |
| **Frontend** | Nginx no servidor fisico + Cloudflare CDN |
| **Backend** | Supabase self-hosted (docker compose) |
| **Banco** | PostgreSQL 16 local |
| **DICOM** | Orthanc real em porta 8042 |
| **Auth** | Supabase Auth local (GoTrue) |
| **SSL** | Cloudflare Origin Certificate (Full Strict) |
| **DNS** | CNAME para Cloudflare Tunnel |
| **Backup** | NAS local + replica off-site |

### 3.3 Plano de execucao (dia a dia)

#### DIA -3 (quarta) â€” Preparacao final
- [ ] Servidor fisico ja entregue e operacional
- [ ] Verificar hardware: `lshw -short`, `df -h`, `free -h`
- [ ] Validar rede: `ping 8.8.8.8`, `nslookup google.com`
- [ ] Confirmar DNS do Cloudflare Tunnel funcionando

#### DIA -2 (quinta) â€” Setup do backend
- [ ] `docker compose up -d` (Supabase stack)
- [ ] Aplicar migrations: `supabase db push --include-all`
- [ ] Aplicar seed inicial minimo (apenas empresa MEDILIFE + admin)
- [ ] Validar REST API: `curl http://localhost:8000/rest/v1/`

#### DIA -1 (sexta) â€” Build e deploy do frontend
- [ ] Gerar build com .env.production (VITE_SUPABASE_URL=https://api.medilife.com.br)
- [ ] SCP para servidor: `scp dist-prod.tar.gz admin@prontoclinic.medilife.local:/tmp/`
- [ ] Extrair: `tar -xzf dist-prod.tar.gz -C /var/www/prontoclinic/`
- [ ] Configurar Nginx: ver runbook
- [ ] Validar HTTP 200 em localhost

#### DIA 0 (sabado) â€” CUTOVER (janela 22:00 - 02:00)

| Horario | Acao | Responsavel |
|---|---|---|
| 18:00 | Equipe chega ao local | Equipe completa |
| 19:00 | Briefing final + checklist impresso | Tech Lead |
| 20:00 | Recepcao para de aceitar novos cadastros no SIGH | Recepcao |
| 21:00 | Backup FINAL SIGH (mysqldump completo) | DBA SIGH |
| 22:00 | Bloquear SIGH para novos cadastros | DBA SIGH |
| 22:30 | Sync incremental SIGH â†’ ProntoClinic (dados das ultimas 4h) | Tech Lead |
| 23:00 | Validar contagens (psql + script) | Tech Lead + DBA |
| 23:30 | Sinalizar DNS (Cloudflare) | Tech Lead |
| 23:45 | Validar DNS (dig medilife.com.br) | Tech Lead |
| 00:00 | Validar site (curl https://medilife.com.br) | Tech Lead |
| 00:15 | Login real com 1 medico da clinica | Medico |
| 00:30 | Criar 1 agendamento real de teste | Recepcao |
| 00:45 | Backup pos-cutover (scripts/backup-diario.sh) | Tech Lead |
| 01:00 | Equipe sai para casa, monitoramento remoto inicia | Equipe |
| 02:00 | Recepcao reabri para uso normal | Recepcao |
| 06:00 | Fim do plantao presencial, equipe dorme | - |

#### DIA +1 (domingo) â€” Monitoramento intensivo
- [ ] Verificar logs a cada 1h
- [ ] Responder chamados de usuarios em < 30min
- [ ] Validar backup das 02:00 foi executado
- [ ] Checar disco (< 50% esperado)

#### DIA +2..+7 (segunda a sabado) â€” Acompanhamento diario
- [ ] Reuniao diaria 10:00 com equipe MEDILIFE (15min)
- [ ] Coletar feedback dos usuarios
- [ ] Aplicar hot-fixes se necessario
- [ ] Validar relatorios TISS gerados
- [ ] Validar backups diarios

---

## 4. FASE 3: ESTABILIZACAO â€” 2 semanas

### 4.1 Objetivo
Acompanhar o uso em producao real, ajustar finos, e descomissionar o SIGH.

### 4.2 Semana 1 pos-cutover

- [ ] Monitoramento 24/7 (plantao TI)
- [ ] Dual-run: SIGH em modo somente-leitura (consulta historica)
- [ ] Validar 100% dos fluxos com dados reais
- [ ] Coletar feedback de TODOS os 100+ usuarios
- [ ] Hot-fixes conforme necessario (max 1 deploy/dia)
- [ ] Validar TISS em homologacao antes de qualquer envio real para ANS

### 4.3 Semana 2 pos-cutover

- [ ] Reduzir monitoramento para 12x5
- [ ] SIGH continua em somente-leitura
- [ ] Validar todos os relatorios TISS do periodo
- [ ] Validar conformidade LGPD com DPO
- [ ] Ajustar performance conforme metricas reais

### 4.4 Descomissionar SIGH

Apos 2 semanas:

- [ ] Confirmar que SIGH nao foi acessado nos ultimos 7 dias
- [ ] Backup final do SIGH (ja temos o do cutover)
- [ ] Desligar servidor SIGH (NAO deletar imediatamente)
- [ ] Apos 30 dias: deletar dados SIGH OU arquivar (decisao do DPO)

---

## 5. CRONOGRAMA

### 5.1 Visao macro

```
Semana 0          Semana 1          Semana 2          Semana 3          Semana 4
   |                 |                 |                 |                 |
   +-FASE 1 (1-2 sem) +-FASE 2 (1 sem) +-FASE 3 (2 sem)-+
                      +-cutover sabado-+
```

### 5.2 Datas sugeridas

| Marco | Data | Dia da semana | Evento |
|---|---|---|---|
| H0 | 06/07/2026 | segunda | Inicio FASE 1 (deploy homolog) |
| H+5 | 11/07/2026 | sabado | Treinamento equipe MEDILIFE |
| H+12 | 18/07/2026 | sabado | Aprovacao formal homolog |
| P0 | 20/07/2026 | segunda | Inicio FASE 2 (preparacao producao) |
| P+5 | 25/07/2026 | sabado | CUTOVER (sabado 22h - 02h) |
| E0 | 26/07/2026 | domingo | Inicio FASE 3 (estabilizacao) |
| E+14 | 09/08/2026 | domingo | Fim FASE 3, descomissionar SIGH |

### 5.3 Marcos criticos (NAO ATRASAR)

| Marco | Data limite | Impacto de atraso |
|---|---|---|
| homolog online | 06/07/2026 | Atraso em todo o cronograma |
| Treinamento MEDILIFE | 11/07/2026 | Equipe nao testa adequadamente |
| Servidor fisico pronto | 22/07/2026 | Atraso no cutover |
| Cutover | 25/07/2026 | Conflita com fechamento mensal MEDILIFE |

---

## 6. CHECKLIST DE VALIDACAO

### 6.1 Tecnico (validar durante homolog e producao)

#### Infraestrutura
- [ ] Site carrega em HTTPS (sem aviso de certificado)
- [ ] DNS resolve corretamente (`dig medilife.com.br`)
- [ ] SSL valido (cadeado verde no navegador)
- [ ] Sem warnings no console do navegador
- [ ] Service Worker registrado (PWA instalavel)
- [ ] Lighthouse score >= 90

#### Autenticacao
- [ ] Login funciona
- [ ] Logout funciona
- [ ] Senha esquecida funciona (envia email)
- [ ] Sessao persiste apos refresh
- [ ] Multi-tenant funciona (RLS ativo)
- [ ] Permissoes por role funcionam (admin, medico, recepcao)

#### Dados
- [ ] Listar pacientes retorna 50k+ registros
- [ ] Buscar paciente por CPF funciona
- [ ] Buscar paciente por nome funciona
- [ ] Criar agendamento funciona
- [ ] Editar agendamento funciona
- [ ] Cancelar agendamento funciona
- [ ] Prontuario carrega com historico completo
- [ ] Upload DICOM funciona
- [ ] Visualizar DICOM funciona

#### Relatorios
- [ ] Relatorio TISS gera XML valido
- [ ] BI Dashboard carrega com dados reais
- [ ] Exportar CSV funciona
- [ ] Filtros de data funcionam

#### Performance
- [ ] Latencia p95 frontend < 300ms (homolog) / < 200ms (producao)
- [ ] Latencia p95 API < 100ms
- [ ] 50 usuarios simultaneos sem degradacao
- [ ] Disco < 50% usado

#### LGPD
- [ ] Logs de auditoria gravam todo acesso a dados sensiveis
- [ ] DPO tem acesso ao dashboard de auditoria
- [ ] Backup criptografado (AES-256)
- [ ] Retencao configurada (20 anos CFM, 5 anos LGPD)

### 6.2 Funcional (validar com equipe MEDILIFE)

#### Recepcao (3 cenarios)
- [ ] Cenario 1: Agendar consulta para paciente novo
- [ ] Cenario 2: Reagendar consulta existente
- [ ] Cenario 3: Confirmar presenca via WhatsApp (se habilitado)

#### Medico (3 cenarios)
- [ ] Cenario 1: Abrir prontuario + adicionar evolucao SOAP
- [ ] Cenario 2: Prescrever medicacao (com assinatura digital)
- [ ] Cenario 3: Solicitar exame de imagem (DICOM)

#### Laboratorio (3 cenarios)
- [ ] Cenario 1: Receber pedido de exame
- [ ] Cenario 2: LanÃ§ar resultado HL7
- [ ] Cenario 3: Validar resultado (bioquimico)

#### Coordenacao (3 cenarios)
- [ ] Cenario 1: Gerar relatorio TISS mensal
- [ ] Cenario 2: Visualizar faturamento por convenio
- [ ] Cenario 3: Exportar BI para PowerBI

#### TI MEDILIFE (3 cenarios)
- [ ] Cenario 1: Criar novo usuario (medico)
- [ ] Cenario 2: Resetar senha de usuario
- [ ] Cenario 3: Verificar backup foi executado

---

## 7. CRITERIOS DE ACEITE

### 7.1 GO para PRODUCAO (saida da Fase 1)

A fase de homolog so termina quando TODOS os criterios forem atingidos:

#### Tecnicos
- [ ] 100% dos smoke tests passaram por 3 dias consecutivos
- [ ] 0 erros 5xx em 7 dias
- [ ] Latencia p95 < 300ms (medida diariamente)
- [ ] Backup diario executou com sucesso por 7 dias

#### Funcionais
- [ ] Equipe MEDILIFE (min 5 pessoas) treinada
- [ ] Bugs P0 resolvidos 100%
- [ ] Bugs P1 resolvidos >= 80%
- [ ] Fluxos principais validados por medicos e recepcao

#### Documentacao
- [ ] Runbook de producao revisado
- [ ] Contatos de emergencia atualizados
- [ ] SLA de suporte assinado

#### Aprovacao formal
- [ ] Termo de aceite da homolog assinado
- [ ] DPO validou LGPD
- [ ] TI validou backups

### 7.2 GO-LIVE (saida da Fase 2)

O cutover em producao so e considerado concluido quando:

#### Tecnicos
- [ ] Site carrega em https://medilife.com.br (HTTP 200)
- [ ] Login funciona com credenciais reais
- [ ] 1 agendamento real criado com sucesso
- [ ] 1 prontuario real aberto com sucesso
- [ ] Backup pos-cutover executado

#### Operacionais
- [ ] Equipe MEDILIFE trabalhando normalmente
- [ ] Plantao TI 24/7 ativo
- [ ] Canal de suporte respondendo
- [ ] Nenhum chamado critico aberto

### 7.3 Sucesso da Fase 3 (estabilizacao)

Apos 2 semanas em producao:

- [ ] 100+ usuarios ativos usando o sistema
- [ ] < 5 chamados criticos por semana
- [ ] 0 indisponibilidades nao-planejadas
- [ ] SIGH acessado 0 vezes (em somente-leitura)
- [ ] TISS gerado com sucesso
- [ ] BI sendo usado pela coordenacao
- [ ] DPO validou logs de auditoria

---

## 8. COMANDOS RAPIDOS

### 8.1 Deploy de homolog

```bash
# Setup completo
bash scripts/setup_teste_homolog.sh --dry-run   # verificar primeiro
bash scripts/setup_teste_homolog.sh             # aplicar

# Validar
bash scripts/smoke-test.sh --env=homolog
```

### 8.2 Deploy de producao

```bash
# Build
cd "C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub"
npm ci
npm run build

# Transferir
scp -r dist admin@prontoclinic.medilife.local:/tmp/

# No servidor
ssh admin@prontoclinic.medilife.local
sudo mv /tmp/dist /var/www/prontoclinic-new
sudo ln -sfn /var/www/prontoclinic-new /var/www/prontoclinic
sudo systemctl reload nginx
```

### 8.3 Validacao

```bash
# Site carrega?
curl -I https://medilife.com.br

# DNS resolve?
dig medilife.com.br

# API funcionando?
curl https://api.medilife.com.br/rest/v1/patients \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  | head

# Banco tem dados?
PGPASSWORD=<DEFINIR_FORA_DO_GIT>
  -c "SELECT COUNT(*) FROM patients;"
```

### 8.4 Backup manual (emergencia)

```bash
# Backup completo
PGPASSWORD=<DEFINIR_FORA_DO_GIT>
  -F c -b -v -f /backup/emergency_$(date +%Y%m%d_%H%M).dump postgres

# Restore (em caso de desastre)
PGPASSWORD=<DEFINIR_FORA_DO_GIT>
  -d postgres -v /backup/emergency_XXXXXXXX.dump
```

---

## 9. RISCOS E MITIGACOES

### 9.1 Matriz de riscos

| # | Risco | Fase | Probab | Impacto | Mitigacao |
|---|---|---|---|---|---|
| R1 | Bug critico nao pego em homolog | 1â†’2 | Media | Critico | Testes E2E + smoke tests + 7 dias em homolog |
| R2 | Servidor fisico falha | 2 | Baixa | Critico | NAS + replica off-site + dual-run SIGH |
| R3 | Dados SIGH incompletos | 2 | Baixa | Critico | Backup final 22:30 + sync incremental + validacao |
| R4 | Cloudflare Tunnel cai | 2 | Muito baixa | Alto | IP fixo documentado como fallback |
| R5 | Usuarios nao conseguem logar | 2 | Media | Alto | SIGH em somente-leitura por 2 semanas |
| R6 | Disco enche | 3 | Media | Alto | Alerta 80% + limpeza automatica de logs |
| R7 | TISS nao gera corretamente | 3 | Baixa | Alto | Testar em homolog antes de envio real para ANS |
| R8 | LGPD nao conformidade | 2 | Baixa | Critico | DPO valida logs + termos + criptografia |
| R9 | Equipe MEDILIFE nao adota | 3 | Media | Alto | Treinamento 8h + suporte dedicado 2 semanas |
| R10 | DNS nao propaga | 1 | Baixa | Baixo | Aguardar 48h + usar IP Vercel em paralelo |

### 9.2 Plano de rollback (producao)

Se algo der muito errado nas primeiras 4h do cutover:

```bash
# 1. Reverter DNS no Cloudflare (apontar para IP do SIGH legado)
# 2. SIGH ja tem todos os dados (backup das 22:30)
# 3. Comunicar usuarios via Teams
# 4. Investigar causa raiz nas proximas 24h
```

Se o problema for grave (> 4h de indisponibilidade ou perda de dados):

```bash
# 1. Rollback DNS imediato
# 2. Restaurar SIGH do backup das 22:30 (se necessario)
# 3. Comunicar DPO + coordenador medico
# 4. Post-mortem em 24h
# 5. Reagendar cutover para proximo sabado
```

---

## 10. EQUIPE E RESPONSABILIDADES

### 10.1 Equipe do projeto

| Papel | Nome | Email | Telefone |
|---|---|---|---|
| Tech Lead | _preencher_ | _preencher_ | _preencher_ |
| DBA SIGH | _preencher_ | _preencher_ | _preencher_ |
| DBA Supabase | _preencher_ | _preencher_ | _preencher_ |
| Frontend Lead | _preencher_ | _preencher_ | _preencher_ |
| Backend Lead | _preencher_ | _preencher_ | _preencher_ |
| DPO MEDILIFE | _preencher_ | _preencher_ | _preencher_ |
| Coordenador Medico MEDILIFE | _preencher_ | _preencher_ | _preencher_ |
| TI MEDILIFE | _preencher_ | _preencher_ | _preencher_ |

### 10.2 Responsabilidades por fase

| Fase | Tech Lead | DBA | DPO | Coord. Medico | Recepcao |
|---|---|---|---|---|---|
| FASE 1: homolog | Coordena deploy | Aplica migrations | Valida LGPD | Testa fluxos | Testa agendamentos |
| FASE 2: cutover | Executa | Backup SIGH + sync | Valida logs | Assina go-live | Reabre sistema 02:00 |
| FASE 3: estabilizacao | Monitora | Backups diarios | Audita acessos | Reporta problemas | Reporta problemas |

---

## 11. APROVACAO

| Papel | Nome | Assinatura | Data |
|---|---|---|---|
| Tech Lead | _preencher_ | _________________ | ___/___/______ |
| Coordenador Medico MEDILIFE | _preencher_ | _________________ | ___/___/______ |
| DPO MEDILIFE | _preencher_ | _________________ | ___/___/______ |
| Gerente de Projeto MEDILIFE | _preencher_ | _________________ | ___/___/______ |

---

## ANEXOS

- `scripts/setup_teste_homolog.sh` â€” Script de deploy de homolog
- `scripts/setup_vercel_env.sh` â€” Script de env vars Vercel
- `scripts/seed-test-data.sql` â€” Seed de dados de teste
- `docs/deploy_producao_medilife.md` â€” Runbook detalhado de producao
- `docs/DEPLOY_TESTE_VS_PRODUCAO.md` â€” Comparativo lado a lado
- `DEPLOY_VERCEL_AUTO.md` â€” Guia de deploy Vercel
- `DOMAIN_SETUP.md` â€” Guia de dominios
- `CUTOVER_RUNBOOK.md` â€” Runbook de cutover SIGH
- `infra/GUIA_100_LOCAL_MEDILIFE.md` â€” Justificativa do modelo local
- `infra/setup-local-server.sh` â€” Script de setup do servidor

---

**Versao**: 1.0
**Data**: 03/07/2026
**Autor**: ProntoMedic Team
**Status**: APROVADO PARA EXECUCAO IMEDIATA