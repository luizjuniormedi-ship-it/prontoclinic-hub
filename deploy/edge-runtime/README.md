# Edge Functions na VPS

Este diretório não substitui o provisionamento privilegiado do Supabase Edge
Runtime. O workflow `deploy-edge-functions.yml` publica somente depois que a VPS
possui:

- Supabase Edge Runtime oficial em `/opt/prontomedic/edge-runtime`;
- `docker-compose.yml` com serviço `functions` e porta `127.0.0.1:9000`;
- volume `/opt/prontomedic/edge-runtime/current:/home/deno/functions`;
- secrets em `/opt/prontomedic/edge-runtime/secrets/.env.functions`;
- rotas Nginx exatas para `auth-admin`, `dicom-bridge` e `telemedicina-daily`;
- migrations da release aplicadas e validadas antes da ativação do frontend.

O provisionamento inicial usa `docker-compose.yml` e
`provision-runtime.sh`. O roteador `main` é baixado de um commit imutável do
repositório oficial Supabase e validado por SHA-256 antes da inicialização.

Secrets clínicos ficam somente na VPS:

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
`ORTHANC_URL`, `ORTHANC_USER`, `ORTHANC_PASSWORD`, `DAILY_API_KEY`,
`DAILY_API_BASE_URL` e `ALLOWED_ORIGINS`.

O GitHub recebe apenas secrets de transporte:

`VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY` e `VPS_KNOWN_HOSTS`.

O deploy é imutável por SHA, troca o symlink `current` atomicamente e restaura a
release anterior se o runtime não voltar. Ele não aplica migrations, não altera
o DataSIGH e não ativa C-STORE.
