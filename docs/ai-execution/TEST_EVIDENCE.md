# Evidencias de Teste

## Evidencia atual - 2026-09-10

- Rodada de expiracao: 143 arquivos / 1141 testes aprovados; type-check aprovado. Pre-cadastro rejeita expiracao passada ou igual ao instante atual antes do envio; 75 testes focados com relogio fixo, limite de 1 ms e timezone equivalente. Validacao cliente nao substitui expiracao/autorizacao no servidor.
- Rodada de contrato pre-cadastro: 143 arquivos / 1136 testes aprovados; type-check aprovado. Parser exige r_id/r_token/r_dt_exp validos e resultado unico; rejeita retorno vazio, multiplo ou legado antes de enviar email.
- Probe no PostgreSQL 18 descartavel: create_pre_cadastro negado para anon; authenticated falha em extensions.digest porque pgcrypto esta em public. Nenhum grant ampliado, migration aplicada nesta rodada ou gateway liberado. Pre-cadastro publico continua bloqueado; a correcao SQL deve preservar isolamento por empresa e resolver o schema real da extensao.
- Rodada posterior de email: 143 arquivos / 1123 testes aprovados. Type-check e build Vite aprovados; lint direcionado sem erros, 6 warnings existentes nos arquivos verificados.
- Build negativo com VITE_RESEND_API_KEY sintetica recusado antes de gerar bundle; build normal nao contem api.resend.com, VITE_RESEND_API_KEY ou marcador sintetico em dist/assets.
- Provedor Resend administrativo testado com fetch simulado; nenhuma entrega externa comprovada. Cliente desabilitado explicitamente ate contrato restrito de pre-cadastro, sem sucesso ficticio.
- Checkout: prontomedic-deploy-rbac-20260804, HEAD bc6633f com alteracoes locais nao integradas.
- Suite unitaria: 143 arquivos, 1141 testes aprovados; type-check normal e estrito e build aprovados.
- E2E company-http-isolation: duas execucoes aprovadas (50.3s e 49.0s), Chromium, PostgreSQL 16 descartavel em loopback:54322 com baseline completo.
- Escopo comprovado: pacientes, empresas sinteticas A/B, GET/HEAD/COUNT/POST/PATCH, contagem exata paginada, controles positivos, MFA e readback de negativas.
- Artefatos locais separados por sufixo de gate; o CI foi ajustado para arquivar todos os relatorios, sem sobrescrita entre suites.
- CI remoto verde refere-se ao HEAD bc6633f, nao ao delta local de isolamento HTTP.
- VPS, SMTP, TISS e todos os demais perfis nao foram homologados nesta rodada. DataSIGH intocado.

## Evidencia historica (nao representa a ultima rodada)

- Testes: 32 arquivos, 446 testes aprovados.
- Build: aprovado pelo `tsc -b` e `vite build`.
- Lint: 0 erros e 430 warnings.
- Sintaxe do backend: `node --check local-auth-server.mjs` aprovado.
- Testes de invariantes de seguranca: 5 aprovados.
- Healthcheck local: PostgreSQL respondeu; auth em `127.0.0.1:8000` indisponivel. A execucao direta do Node retornou `EPERM` no caminho Windows com espaco dentro deste sandbox.

## Evidencia VPS registrada pelo usuario

- SSH funcional com a chave de reset.
- Release `37199ee` criada.
- Build concluido.
- Migracoes executadas.
- Contagens observadas: 992 convenios, 395 planos, 313 XML TISS, 6 protocolos, 3 glosas.
- Nginx validado e recarregado.
- Wrapper apresentou erro posterior de CRLF; o shell de deploy foi corrigido localmente.

## Evidencia ausente

- Healthcheck final do backend apos a ultima publicacao.
- Login real com perfil operacional.
- Isolamento HTTP dos demais dominios e homologacao equivalente na VPS.
- Dry-run real de reconciliacao DataSIGH.
- CI verde no commit mais recente.
