# Integrations — PACS/DICOM e TISS/XML

Este documento descreve como configurar as integrações externas do ProntoClinic Hub
com servidores PACS DICOM e webservices TISS de operadoras de saúde.

## Sumário

1. [PACS / DICOM](#1-pacs--dicom)
   - [1.1 Orthanc (recomendado)](#11-orthanc-recomendado)
   - [1.2 Conquest DICOM](#12-conquest-dicom)
   - [1.3 AWS HealthImaging](#13-aws-healthimaging)
   - [1.4 Worklist (Modality Worklist - MWL)](#14-worklist-modality-worklist---mwl)
   - [1.5 WADO-RS / WADO-URI](#15-wado-rs--wado-uri)
2. [TISS / Faturamento Eletrônico](#2-tiss--faturamento-eletrônico)
   - [2.1 Versão 3.05.00 da ANS](#21-versão-30500-da-ans)
   - [2.2 Certificado Digital A1](#22-certificado-digital-a1)
   - [2.3 Endpoints por Operadora](#23-endpoints-por-operadora)
   - [2.4 Fluxo de Glosa e Recurso](#24-fluxo-de-glosa-e-recurso)
3. [LGPD e Privacidade](#3-lgpd-e-privacidade)
4. [Troubleshooting](#4-troubleshooting)

---

## 1. PACS / DICOM

### 1.1 Orthanc (recomendado)

[Orthanc](https://www.orthanc-server.com/) é um PACS open-source em C++/Lua,
amplamente usado em hospitais, clínicas e integrações de telerradiologia.

**Instalação via Docker (recomendado):**

```bash
docker run -d \
  --name orthanc \
  -p 8042:8042 \
  -p 4242:4242 \
  -v /var/lib/orthanc/db:/var/lib/orthanc/db \
  -v /var/lib/orthanc/worklists:/var/lib/orthanc/worklists \
  -e ORTHANC__NAME="ProntoClinic Hub PACS" \
  -e ORTHANC__DICOM_AET=ORTHANC \
  -e ORTHANC__HTTP_PORT=8042 \
  -e ORTHANC__DICOM_PORT=4242 \
  -e ORTHANC__REGISTERED_USERS='{"orthanc":"orthanc"}' \
  orthancteam/orthanc:latest
```

**Variáveis de ambiente no ProntoClinic Hub:**

```env
VITE_ORTHANC_URL=http://localhost:8042
VITE_ORTHANC_USER=orthanc
VITE_ORTHANC_PASS=orthanc
```

**Configurar modalities no Orthanc (apontar para CT, MR, US…):**

Adicione em `/etc/orthanc/orthanc.json`:

```json
{
  "DicomModalities": {
    "CT_HOSP":   ["CT_HOSP",   "192.168.0.10", 104],
    "MR_HOSP":   ["MR_HOSP",   "192.168.0.11", 104],
    "US_01":     ["US_01",     "192.168.0.12", 104],
    "CR_MAMO":   ["CR_MAMO",   "192.168.0.13", 104]
  },
  "Worklists": {
    "Enable": true,
    "Database": "/var/lib/orthanc/worklists"
  }
}
```

**Webhook "stable study" (Orthanc → ProntoClinic):**

Instale o script Lua em `/etc/orthanc/on-stable-study.lua`:

```lua
function OnStableStudy(studyId, instanceId, tags, metadata)
  local url = os.getenv('PRONTOCLINIC_WEBHOOK') or 'http://host.docker.internal:54321/functions/v1/dicom-webhook'
  local body = string.format('{"orthanc_id":"%s","study_uid":"%s","accession":"%s"}',
    studyId, tags['StudyInstanceUID'], tags['AccessionNumber'])
  os.execute('curl -s -X POST -H "Content-Type: application/json" -d "'..body..'" '..url)
end
```

**Teste de conexão (DICOM Echo):**

```bash
curl -u orthanc:orthanc http://localhost:8042/modalities/CT_HOSP/echo -X POST
```

**QIDO-RS / WADO-RS:**

```bash
# Buscar estudos por paciente
curl -u orthanc:orthanc \
  "http://localhost:8042/dicom-web/studies?PatientID=12345" | jq

# Baixar instancia
curl -u orthanc:orthanc \
  "http://localhost:8042/dicom-web/studies/1.2.3.4/instances/1.2.3.4.5" \
  -o instance.dcm
```

### 1.2 Conquest DICOM

[Conquest DICOM](https://ingenium.home.xs4all.nl/dicom.html) é uma alternativa Windows-based.

```env
VITE_ORTHANC_URL=http://localhost:8080
```

O ProntoClinic Hub usa o endpoint REST-like do Conquest. Para WADO, configure:

```ini
# conquest.ini
[webserver]
port = 8080
wadosupport = 1
```

### 1.3 AWS HealthImaging

[AWS HealthImaging](https://aws.amazon.com/health/healthimaging/) é o PACS serverless da AWS.

```env
VITE_ORTHANC_URL=https://runtime-medical-imaging.us-east-1.amazonaws.com
```

Configuração adicional via AWS CLI:

```bash
aws medical-imaging create-datastore --datastore-name "prontoclinic-hub"
```

Consulte [AWS HealthImaging DICOMweb endpoints](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb.html).

### 1.4 Worklist (Modality Worklist - MWL)

O ProntoClinic Hub suporta enviar a worklist para o Orthanc/Conquest via:

1. **Tabela `dicom_worklist`** — tags DICOM por equipamento (SIGH.dicom_worklist)
2. **Endpoint REST** — POST para Orthanc `/worklists/`
3. **Push automático** — ao salvar uma guia de SP/SADT, o sistema insere o item na worklist

**Configurar tags MWL no Orthanc:**

Crie um arquivo `/var/lib/orthanc/worklists/0001.wl`:

```
# DICOM Worklist file (text)
PatientName    SILVA^JOAO
PatientID      12345
AccessionNumber ACC-20260101-ABC123
ReferringPhysicianName  SOUZA^MARIA
RequestedProcedureDescription  "TC TORAX"
ScheduledProcedureStepStartDate 20260101
ScheduledProcedureStepStartTime 090000
Modality CT
ScheduledStationAETitle CT_HOSP
```

**Template SQL (geração automática):**

```sql
INSERT INTO dicom_worklist (cd_equipment, ds_type, ds_value, ds_tag, ds_description)
VALUES
  (1, 'SpecificCharacterSet', 'ISO_IR 100', '0008,0005', 'Charset'),
  (1, 'ScheduledStationAETitle', 'CT_HOSP', '0040,0001', 'AE destino');
```

### 1.5 WADO-RS / WADO-URI

O componente `DicomViewer.tsx` carrega imagens via:

- **WADO-URI** (legado): `wadouri:http://orthanc:8042/instances/{sop}/file`
- **WADO-RS** (DICOMweb): `wadors:http://orthanc:8042/dicom-web/studies/{study}/instances/{instance}`

Para visualização no navegador, **Cornerstone.js** é carregado via CDN:

```html
<script src="https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js"></script>
<script src="https://unpkg.com/cornerstone-core@2.6.1/dist/cornerstone.min.js"></script>
<script src="https://unpkg.com/cornerstone-tools@2.6.1/dist/cornerstone-tools.min.js"></script>
```

**CORS no Orthanc:**

Adicione em `/etc/orthanc/orthanc.json`:

```json
{
  "HttpHeaders": {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept"
  }
}
```

---

## 2. TISS / Faturamento Eletrônico

O **TISS** (Troca de Informação em Saúde Suplementar) é o padrão da ANS para
faturamento eletrônico de convênios. O ProntoClinic Hub implementa:

- Geração de XML TISS 3.05.00 (guias CONSULTA e SP/SADT)
- Envio via webservice SOAP/REST por operadora
- Processamento do retorno (lotes, protocolos, glosas)
- Geração de XML de recurso de glosa
- Estatísticas de taxa de glosa e recebimento

### 2.1 Versão 3.05.00 da ANS

```env
VITE_TISS_VERSION=3.05.00
```

Documentação oficial: <https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss-padrao-para-intercambio-de-informacao-de-saude-suplementar>

**Componentes XML gerados:**

```xml
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versao="3.05.00">
  <ans:cabecalho>
    <ans:identificacaoTransacao>...</ans:identificacaoTransacao>
    <ans:origem>...</ans:origem>
    <ans:destino>...</ans:destino>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      <ans:guias>
        <ans:guiaConsulta>...</ans:guiaConsulta>
      </ans:guias>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>
</ans:mensagemTISS>
```

### 2.2 Certificado Digital A1

Para **produção**, a ANS exige **Certificado Digital A1 (e-CNPJ)** ICP-Brasil.

**Geração do .pfx:**

```bash
# Converter .cer + .key em .pfx
openssl pkcs12 -export -out cert_a1.pfx -inkey chave_privada.key -in certificado.crt
```

**Caminho no ProntoClinic Hub:**

```env
VITE_TISS_CERT_PATH=/etc/pc_hub/cert_a1.pfx
VITE_TISS_CERT_PASSWORD=sua_senha
```

**Atenção:** O certificado NUNCA deve ser commitado. Use Docker secrets ou volumes.

```yaml
# docker-compose.yml
services:
  prontoclinic-hub:
    volumes:
      - ./secrets/cert_a1.pfx:/etc/pc_hub/cert_a1.pfx:ro
    environment:
      VITE_TISS_CERT_PASSWORD_FILE: /run/secrets/tiss_pass
```

### 2.3 Endpoints por Operadora

Cada operadora expõe um endpoint próprio. Configure em `tiss_protocols` (UI ou SQL):

```sql
INSERT INTO tiss_protocols (
  company_id, cd_convenio, ds_endpoint, tp_ambiente, ds_versao_tiss
) VALUES
  ('<company_uuid>', 1, 'https://amil.integracao-tiss.com.br/tiss/v3', 'HOMOLOGACAO', '3.05.00'),
  ('<company_uuid>', 2, 'https://unimed.integracao-tiss.com.br/tiss/v3', 'HOMOLOGACAO', '3.05.00');
```

**Endpoints conhecidos (homologação):**

| Operadora | URL                                                                                  |
|-----------|--------------------------------------------------------------------------------------|
| AMIL      | https://homologacao-tiss.amil.com.br                                                  |
| Unimed    | https://integracao.unimed.coop.br/tiss/homolog                                        |
| Bradesco  | https://tiss.homolog.bradescosaude.com.br                                            |
| SulAmérica| https://homolog-tiss.sulamerica.com.br                                                |
| Hapvida   | https://tiss.homolog.hapvida.com.br                                                    |

**Atenção:** URLs podem mudar. Sempre consulte o portal da operadora.

### 2.4 Fluxo de Glosa e Recurso

```
[Atendimento] → [Fechamento Mensal] → [Geração de XML] → [Envio à Operadora]
                                                          ↓
                          [Retorno: Protocolo + Lote] ← [Operadora processa]
                                       ↓
                          [Demonstrativo: valores processados]
                                       ↓
                       ┌───────────────┴───────────────┐
                       ↓                               ↓
                  SEM glosa                      COM glosa
                       ↓                               ↓
                [Status: PROCESSADO]            [Status: GLOSADO]
                       ↓                               ↓
                [Pagamento]                   [Recurso de Glosa]
                       ↓                               ↓
                [Status: PAGO]              [Status: DEFERIDO/INDEFERIDO]
```

**Códigos de glosa TISS (subset):**

| Código | Descrição                          |
|--------|------------------------------------|
| 7101   | Procedimento não coberto           |
| 7102   | Procedimento não autorizado        |
| 7108   | Procedimento sem cobertura         |
| 7111   | Exige autorização prévia           |
| 7119   | Material/medicamento não autorizado|
| 7127   | Código TUSS inválido               |
| 7129   | Documentação incompleta            |

Lista completa: 30+ códigos no objeto `TISS_GLOSA_CODES` em `tissService.ts`.

---

## 3. LGPD e Privacidade

- **Laudos publicados no app do paciente** (SIGH.LG_LIBERAR_APP_SITE):
  exigem consentimento PUSH (`paciente_consentimentos.cd_canal = 4`) ativo.
  Função `publish_dicom_report()` bloqueia publicação sem consentimento.

- **Download de imagens DICOM**:
  o `DicomViewer` permite snapshot, mas bloqueia download se
  `lgpdConsentPush = false`. LGPD art. 18 §6º (revogação).

- **AnonymizePatient**: usar `lgpdService.anonymize_patient(id)` antes de
  compartilhar estudos em telerradiologia externa.

- **Audit log**: `publish_dicom_report()` registra em `audit_logs`
  (LGPD art. 37 - registro de operação de tratamento).

---

## 4. Troubleshooting

### Erro "Orthanc store falhou (401)"

Verifique usuário/senha em `VITE_ORTHANC_USER` / `VITE_ORTHANC_PASS`.

### "Protocolo TISS não configurado"

Cadastre o endpoint da operadora em `tiss_protocols` via UI
(TissManager → aba Guias → botão "Protocolos") ou SQL.

### "Exame não está LAUDADO"

A função `publish_dicom_report()` exige `ds_status = 'LAUDADO'`. Assine o laudo
antes de publicar no app.

### "Paciente sem consentimento LGPD"

Registre consentimento PUSH em `paciente_consentimentos` antes de publicar laudo
no app. Canal 4 = PUSH.

### Cornerstone.js não carrega

Verifique conectividade com `unpkg.com`. Em ambiente offline, copie os
arquivos para `public/vendors/cornerstone/` e ajuste `CDN_SCRIPTS` em
`DicomViewer.tsx`.

### XML TISS rejeitado

- **Homologação**: valide o XML em <https://www.ans.gov.br/tiss-homolog>
- **Produção**: revise `cd_certificado_a1_path` e senha
- **Schema XSD**: baixe de <https://www.gov.br/ans/pt-br/arquivos/area-do-prestador/tiss/tiss-3-05-00>

---

## Referências

- Orthanc docs: <https://book.orthanc-server.com/>
- DICOM standard: <https://dicom.nema.org/medical/dicom/current/output/html/>
- TISS ANS: <https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss>
- Cornerstone.js: <https://www.cornerstonejs.org/>
- LGPD Lei 13.709/2018: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>
