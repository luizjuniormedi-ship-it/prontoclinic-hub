# Checklist Local ProntoMedic

## Objetivo
Subir e validar o ambiente local usado no preview do ProntoMedic.

## Componentes obrigatorios
- PostgreSQL local na porta 5432, banco `prontoclinic`.
- Backend local auth na porta 8000.
- Frontend Vite preview na porta 8080.
- `.env` apontando `VITE_SUPABASE_URL` para `http://127.0.0.1:8000` ou `http://localhost:8000`.

## Comandos
```bash
npm run build
npm run local:start
npm run local:health
```

Para parar processos iniciados pelo script:

```bash
npm run local:stop
```

## Criterios de aceite
- `npm run build` finaliza sem erro TypeScript/Vite.
- `npm run test` finaliza com todos os testes verdes.
- `npm run local:health` confirma PostgreSQL, backend auth e frontend.
- Login no navegador nao exibe `Failed to fetch`.
- Perfil do usuario carrega apos login.

## Falhas comuns
- Porta 8000 ocupada: pare o processo antigo ou execute `npm run local:stop` se ele foi iniciado pelo script.
- Porta 8080 ocupada: pare o preview antigo ou altere explicitamente a porta.
- Perfil nao carrega: validar tabela `public.user_profiles` e se o usuario auth possui linha correspondente.
- RPC falha: validar se a migration de agendamento foi aplicada no banco local.
