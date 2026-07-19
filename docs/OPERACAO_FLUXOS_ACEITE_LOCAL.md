# Frente operacional — critérios de aceite local

## Escopo

Fluxos revisados: Agenda, Call Center, Recepção, check-in administrativo e Atendimento. Esta frente usa somente componentes e serviços já presentes no workspace local.

## Conflitos P0 identificados e tratados

- Falhas de carregamento na Agenda, Recepção, Atendimento, Faturamento e Call Center não podem deixar a tela sem estado acionável: devem exibir erro e retry.
- A Agenda não deve oferecer início direto a partir de `confirmed`; o início depende de `waiting`.
- A Recepção não deve navegar um perfil sem permissão clínica para `/attendance/:appointmentId` depois de mudar o status. O status pode ser iniciado no balcão, mas o prontuário permanece protegido.
- Datas operacionais devem usar o calendário local, sem `toISOString()` para calcular “hoje” ou a semana.
- Tarefas do Call Center devem ser concluíveis na própria fila, com proteção contra duplo envio.

## Critérios de aceite

1. Agenda calcula “hoje”, semana e troca de dia no fuso local e mantém erro recuperável quando a leitura falha.
2. `scheduled/confirmed -> waiting -> in_progress -> completed` é respeitado; saltos e estados terminais ficam bloqueados no cliente.
3. Check-in mostra prontidão, pendências, prioridade e justificativa obrigatória para exceção; sucesso atualiza a fila.
4. Recepção exibe paciente, horário, profissional, telefone, convênio e alertas; perfil de recepção não acessa o prontuário clínico.
5. Atendimento permite retry de carregamento e evita duplicar prontuário durante nova tentativa após falha de transição.
6. Call Center permite registrar contato, atualizar fila de confirmação, concluir tarefa e recuperar de erro de leitura.
7. Faturamento por contas exibe erro recuperável, contas e pendências sem alterar migrations ou integrações externas.

## Validação local

- Testes unitários focados de estados, RBAC, datas, serviços de faturamento e Call Center.
- `npm run build`.
- `npm run lint` sem erros; warnings existentes permanecem fora deste escopo.
- Não executar E2E destrutivo, publicação, acesso a VPS ou alteração de DataSIGH.

## Runtime autenticado e E2E persistente

O runtime local exige `JWT_SECRET` (mínimo de 32 caracteres) e `PGPASSWORD` do
PostgreSQL **já provisionado**. `npm run local:start` não cria banco, usuário
administrativo nem altera senha. As portas podem ser definidas por
`LOCAL_AUTH_PORT` e `LOCAL_FRONTEND_PORT`; o estado real fica em
`.tmp/local-runtime` e é usado por `npm run local:health` e `npm run local:stop`.

Para executar Playwright, defina `E2E_AUTH_READY=true` e as variáveis
`E2E_<ROLE>_EMAIL`/`E2E_<ROLE>_PASSWORD` necessárias. Não existem credenciais
padrão. O modo inicial é `readonly`. Testes `@mutating` em base local descartável
exigem também `E2E_MODE=mutating` e `E2E_ALLOW_LOCAL_MUTATIONS=true`; produção e
hosts fora da allowlist continuam bloqueados.

Verificações seguras sem banco: `npm run test:local-safety`. A validação real do
banco ocorre no startup e em `GET /health`, sem expor senha ou detalhes do erro.
