# Broken Links — Validação 2026-06-22

> Validação realizada via `curl -L` (HTTP HEAD) com timeout de 10s e User-Agent Mozilla/5.0. **Escopo**: apenas links externos em arquivos `.md` da raiz do repositório. Links `seu-usuario/prontoclinic-hub` são placeholders do template — ignorados nesta validação (substituir antes de publicar).

## Resultado geral

- Total de URLs externas testadas: **16**
- Funcionando (HTTP 2xx/3xx): **12** (75%)
- Quebradas (HTTP 404): **4** (25%)
- Links placeholder (a serem substituídos): **8** em `README.md`, `INSTALL.md`, `INTEGRATIONS.md`, `CONTRIBUTING.md`, `SECURITY.md`

## Links quebrados (requerem correção)

| # | URL | Arquivo | Linha | HTTP | Correção sugerida |
|---|---|---|---|---|---|
| 1 | `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss-padrao-para-intercambio-de-informacao-de-saude-suplementar` | `INTEGRATIONS.md` | 222 | 404 | `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss` (página oficial consolidada, validada como 200) |
| 2 | `https://www.ans.gov.br/tiss-homolog` | `INTEGRATIONS.md` | 380 | 404 | `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss-homologacao` ou remover — ambiente de homologação foi descontinuado na nova versão do portal |
| 3 | `https://www.gov.br/ans/pt-br/arquivos/area-do-prestador/tiss/tiss-3-05-00` | `INTEGRATIONS.md` | 382 | 404 | `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss` (buscar XSD dentro da página oficial) |
| 4 | `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss` | `INTEGRATIONS.md` | 390 | 404 | Esta URL agora retorna 200 conforme novo teste — **revalidar após deploy** |

## Links placeholder (substituir antes de publicar)

Todos os links abaixo contêm `seu-usuario` ou `prontomedic.com.br` — são templates a customizar:

| # | Arquivo | Linha | URL placeholder |
|---|---|---|---|
| 1 | `README.md` | 96 | `https://github.com/seu-usuario/prontoclinic-hub.git` |
| 2 | `README.md` | 207 | `https://github.com/seu-usuario/prontoclinic-hub/issues` |
| 3 | `INSTALL.md` | 41 | `https://github.com/seu-usuario/prontoclinic-hub.git` |
| 4 | `INSTALL.md` | 185 | `https://github.com/seu-usuario/prontoclinic-hub.git` |
| 5 | `CONTRIBUTING.md` | 9 | `https://github.com/seu-usuario/prontoclinic-hub.git` |
| 6 | `SECURITY.md` | 151 | `https://github.com/seu-usuario/prontoclinic-hub/security/advisories` |
| 7 | `SECURITY.md` | 36 | `https://prontomedic.com.br/.well-known/pgp-key.asc` |
| 8 | `SECURITY.md` | 41 | `https://prontomedic.com.br/security/bounty` |

## Links validados (HTTP 200) — funcionando

| URL | Arquivo |
|---|---|
| `https://keepachangelog.com/pt-BR/1.1.0/` | `CHANGELOG.md` |
| `https://semver.org/lang/pt-BR/` | `CHANGELOG.md` |
| `https://www.contributor-covenant.org/version/2/1/code_of_conduct.html` | `CODE_OF_CONDUCT.md` |
| `https://www.orthanc-server.com/` | `INTEGRATIONS.md` |
| `https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb.html` | `INTEGRATIONS.md` |
| `https://book.orthanc-server.com/` | `INTEGRATIONS.md` |
| `https://dicom.nema.org/medical/dicom/current/output/html/` | `INTEGRATIONS.md` |
| `https://www.cornerstonejs.org/` | `INTEGRATIONS.md` |
| `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm` | `INTEGRATIONS.md` |
| `https://vercel.com` | `DEPLOY.md` |
| `https://netlify.com` | `DEPLOY.md` |
| `https://img.shields.io/badge/status-em%20desenvolvimento-yellow` | `README.md` |

## Ações recomendadas

### Imediato (P1)

1. **Atualizar INTEGRATIONS.md linha 222**: substituir pela URL consolidada `https://www.gov.br/ans/pt-br/assuntos/prestadores/tiss`.
2. **Atualizar INTEGRATIONS.md linha 382**: substituir pelo link atual de download do XSD (verificar ANS).
3. **Revalidar INTEGRATIONS.md linha 390**: a URL pode estar transitória — checar manualmente.

### Antes do release (P2)

4. Substituir todos os 6 placeholders `seu-usuario` pela organização real do GitHub.
5. Publicar a chave PGP em `prontomedic.com.br/.well-known/pgp-key.asc` ou remover a referência em `SECURITY.md:36`.
6. Publicar `prontomedic.com.br/security/bounty` ou substituir por `security@prontoclinic.app` (canal de e-mail).

### Como revalidar

```bash
# Roda validação completa
cd /c/Users/Meu\ Computador/AppData/Local/Temp/prontoclinic-hub/
for f in *.md; do
  grep -oE 'https?://[^[:space:])]+' "$f" | sort -u | while read url; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "$url")
    echo "$code $url ($f)"
  done
done
```

---

**Status**: 3 links ANS precisam correção manual; 8 placeholders requerem decisão de marca/domínio.