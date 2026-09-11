# Edge Functions na VPS

Pre-cadastro exige aplicar previamente a migration secure_pre_cadastro_edge_contract
pelo pipeline de banco existente. O helper bloqueia a ativacao se as quatro RPCs,
SECURITY DEFINER, search_path ou grants exclusivos de service_role divergirem.
Nao inclua essa migration no pacote aditivo de Auth.

A publicacao segue expand/contract: aplique `20260910223000`, publique Edge e
frontend no mesmo SHA, e somente depois aplique `20260910224500`. O workflow da
segunda migration recusa a retirada dos RPCs legados se Edge ou frontend ainda
nao estiverem ativos no commit aprovado.

O bootstrap privilegiado executa install-nginx-routes.sh: ele localiza somente o
fragmento existente das tres rotas, cria backup, instala nginx-http.conf no
contexto http e nginx-functions.conf no server HTTPS, valida com nginx -t e
restaura automaticamente em caso de falha. A zona limita por IP a 30
requisicoes/minuto com burst 5 e resposta 429. Isso nao substitui o limite
persistente por destinatario.

O smoke usa Origin configurado e verifica CORS; o POST status com token invalido
e JWT anon exige 404 INVALIDO, sem criar cadastro ou enviar email. O rollback
verifica apenas funcoes presentes na release restaurada.

Este diretório não substitui o provisionamento privilegiado do Supabase Edge
Runtime. O workflow `deploy-edge-functions.yml` publica somente depois que a VPS
possui:

- Supabase Edge Runtime oficial em `/opt/prontomedic/edge-runtime`;
- `docker-compose.yml` com serviço `functions` e porta `127.0.0.1:9000`;
- volume `/opt/prontomedic/edge-runtime/current:/home/deno/functions`;
- secrets em `/opt/prontomedic/edge-runtime/secrets/.env.functions`;
- rotas Nginx exatas para `auth-admin`, `dicom-bridge`, `telemedicina-daily` e `pre-cadastro`;
- migrations da release aplicadas e validadas antes da ativação do frontend.

O provisionamento inicial usa `docker-compose.yml` e
`provision-runtime.sh`. O roteador `main` é baixado de um commit imutável do
repositório oficial Supabase e validado por SHA-256 antes da inicialização.

Secrets clínicos ficam somente na VPS:

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
`ORTHANC_URL`, `ORTHANC_USER`, `ORTHANC_PASSWORD`, `DAILY_API_KEY`,
`DAILY_API_BASE_URL`, `ALLOWED_ORIGINS`, `PRE_CADASTRO_TENANT_MAP`,
`PRE_CADASTRO_TOKEN_SECRET`, `PRE_CADASTRO_CONFIRM_BASE_URL`,
`PRE_CADASTRO_EMAIL_FROM`, `PRE_CADASTRO_TERM_VERSION`,
`PRE_CADASTRO_TERM_SHA256` e `RESEND_API_KEY`.

O GitHub recebe apenas secrets de transporte:

`VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY` e `VPS_KNOWN_HOSTS`.

O deploy é imutável por SHA, troca o symlink `current` atomicamente e restaura a
release anterior se o runtime não voltar. Ele não aplica migrations, não altera
o DataSIGH e não ativa C-STORE.
