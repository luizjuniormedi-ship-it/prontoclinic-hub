# Pool PostgreSQL exclusivo para service_role

## Contrato

- O pool comum usa `PGUSER` e assume somente `authenticated` por transacao.
- O pool privilegiado usa `LOCAL_AUTH_SERVICE_PGUSER`, um login exclusivo `NOINHERIT` que pode assumir `service_role` apenas dentro da transacao.
- `app_prontomedic` nao pode ser o login privilegiado nem membro de `service_role`.
- O processo recusa startup em producao sem o pool exclusivo ou quando atributos, identidade e memberships divergem do contrato.
- Segredos nao pertencem ao repositorio, argumentos de processo, logs ou unit files.
- A chave opaca privilegiada e aceita somente nas rotas Auth administrativas, nas cinco RPCs administrativas e em leitura de `memberships`/`user_profiles`. Ela nunca autoriza tabelas ou RPCs fora dessas allowlists.

## Provisionamento controlado

1. Execute apenas contra o PostgreSQL local autorizado. Confirme `PGHOST`, `PGPORT`, `PGDATABASE` e `PGUSER` antes de continuar.
2. Defina `PGPASSWORD` para o administrador local e `LOCAL_AUTH_SERVICE_PGPASSWORD` com segredo aleatorio de pelo menos 24 caracteres no ambiente da sessao.
3. Faça dry-run: `./deploy/auth-service/provision-service-role.ps1 -ServiceLogin local_auth_service -WhatIf`.
4. Provisione: `./deploy/auth-service/provision-service-role.ps1 -ServiceLogin local_auth_service -Confirm`.
5. Configure `LOCAL_AUTH_SERVICE_KEY` no gerenciador de segredos e use o mesmo valor somente no runtime server-side da Edge Function. Nunca exponha essa chave no frontend ou em logs.
6. Valide antes de reiniciar: `node --check local-auth-server.mjs` e `node deploy/auth-service/verify-contract.mjs`.
7. Inicie em processo separado e aceite somente se o log de startup nao contiver `STARTUP_REFUSED` e `/health` responder 200.

O provisionador e idempotente para atributos e rotacao de senha. Ele revoga
somente a membership direta de `app_prontomedic`. Se existir heranca indireta,
o startup detecta o caminho remanescente e bloqueia o processo; a cadeia de
roles deve ser corrigida separadamente por um administrador PostgreSQL.

## Rollback

1. Remova as duas variaveis `LOCAL_AUTH_SERVICE_*` do servico e nao reinicie em modo `production`, pois o startup deve falhar fechado.
2. Depois de confirmar que nenhuma sessao usa o login: `REVOKE service_role FROM local_auth_service;`.
3. Revogue acesso ou remova o login conforme a politica local. Nao remova nem altere o role de grupo `service_role`.

## Criterios de aceite

- `session_user` do pool privilegiado coincide exatamente com `LOCAL_AUTH_SERVICE_PGUSER`.
- O login e `NOINHERIT`, sem superuser, create role/database, replication ou bypass RLS.
- `pg_has_role(login, 'service_role', 'MEMBER')` e verdadeiro.
- `pg_has_role('app_prontomedic', 'service_role', 'MEMBER')` e falso.
- O login consegue `SET LOCAL ROLE service_role`; o pool comum nunca recebe suas credenciais.
- A chave de servico exige correspondencia constante nos headers `Authorization` e `apikey`; somente as allowlists administrativas podem usa-la.
- Banimento altera `auth.users` e revoga todos os refresh tokens na mesma transacao; login, refresh, MFA, REST e RPC consultam o estado de banimento.

## CI

Execute como gates sem banco: `node --check local-auth-server.mjs` e `node deploy/auth-service/verify-contract.mjs`. O segundo comando deve imprimir somente `AUTH_SERVICE_STATIC_CONTRACT_OK`. Um job de integracao separado, com PostgreSQL descartavel, deve executar o provisionador e provar os criterios de aceite; nunca injete segredos em argumentos, artefatos ou logs do CI.

## Publicacao atomica Auth + migration + Edge

O helper canonico `deploy-atomic.sh` coordena a migration, o backend PM2
`prontomedic-auth` e o helper Edge ja instalado. Ele nao substitui nem duplica
`deploy/edge-runtime/deploy-functions.sh`: chama a instalacao canonica indicada
por `PRONTOMEDIC_EDGE_HELPER`.

### Bootstrap unico da VPS existente

Antes da primeira publicacao, instale o coordenador com o backend atual ainda
saudavel. O instalador nao executa SQL nem copia segredos; ele registra o
diretorio Auth atual como alvo inicial do link versionado, reaponta o PM2 para
esse mesmo codigo por meio do link canonico e exige health HTTP 200:

```bash
sudo bash deploy/auth-service/install-coordinator.sh "$PWD" /opt/prontomedic/backend
sudo /usr/local/sbin/prontomedic-auth-deploy audit
```

Se o audit falhar, o workflow deve permanecer bloqueado.

### Artefatos obrigatorios

- SHA Git completo de 40 caracteres.
- Artefato Auth produzido exclusivamente por `build-auth-artifact.sh`. O build
  executa `npm ci --omit=dev` em staging limpo e gera tar deterministico,
  checksum e `release-manifest.json` versao 1. A VPS nao reutiliza
  `node_modules` do checkout nem baixa dependencias.
- `edge.tgz` e `edge.sha256` no contrato aceito pelo helper Edge.
- Migration transacional estritamente aditiva. O rollback da aplicacao mantem
  o schema novo para preservar challenges e dados criados; nenhuma tabela e
  removida automaticamente. O backup validado e preservado para contingencia.

### Gates fail-closed

1. Root, comandos, arquivos absolutos, checksums e caminhos internos seguros.
2. Auditoria read-only do contrato Edge e existencia do processo PM2.
3. Comparacao por SHA-256, sem imprimir valores, entre
   `LOCAL_AUTH_SERVICE_KEY` do Auth e `SUPABASE_SERVICE_ROLE_KEY` da Edge.
4. Release Auth atual valida, manifesto versionado e destino imutavel.
5. Migration com `BEGIN`/`COMMIT` e sem comandos destrutivos.
6. Backup custom-format nao vazio e validado por `pg_restore --list`.
7. Ecosystem canonico instalado com script apontando para
   `/opt/prontomedic/auth-runtime/current/local-auth-server.mjs`.
8. `pm_exec_path` comprovado após `pm2 startOrReload`, health Auth e smoke Edge.

Qualquer falha depois da migration executa rollback em ordem inversa da
aplicacao: Edge e backend Auth. O schema aditivo permanece, o backup e
preservado e um smoke completo e obrigatorio após o rollback. Falha no rollback
retorna codigo 70 e nunca e declarada como sucesso parcial.

### Uso

```bash
node deploy/auth-service/verify-atomic-deploy.mjs

./deploy/auth-service/build-auth-artifact.sh \
  "$SHA" "$PWD" /srv/releases

sudo /usr/local/sbin/prontomedic-auth-deploy preflight \
  "$SHA" /srv/releases/auth-$SHA.tgz /srv/releases/auth-$SHA.tgz.sha256 \
  /srv/releases/edge.tgz /srv/releases/edge.sha256 \
  /srv/releases/migration.sql

sudo /usr/local/sbin/prontomedic-auth-deploy deploy \
  "$SHA" /srv/releases/auth-$SHA.tgz /srv/releases/auth-$SHA.tgz.sha256 \
  /srv/releases/edge.tgz /srv/releases/edge.sha256 \
  /srv/releases/migration.sql
```

Rollback manual da ultima publicacao registrada:

```bash
sudo /usr/local/sbin/prontomedic-auth-deploy rollback
```

Auditoria sem mutacao:

```bash
sudo /usr/local/sbin/prontomedic-auth-deploy audit
```

O arquivo `deploy-atomic.env.example` documenta a topologia esperada. Segredos
do Auth, PostgreSQL, SMTP e Edge continuam nos gerenciadores de segredos
existentes e nunca sao recebidos como argumentos do helper.
