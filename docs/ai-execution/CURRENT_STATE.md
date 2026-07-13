# Estado Atual de Execucao

Atualizado em 2026-07-13.

## Fato tecnico

- Repositorio local: `C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub`.
- Ultimo commit local conhecido: `fef2264` (`fix(auth): hide database errors from clients`).
- Release funcional conhecida na VPS: `37199ee`.
- A VPS executou build, migracoes e reload do Nginx na fase 1; a mensagem final de falha do wrapper foi causada por CRLF residual no shell remoto, nao por falha da publicacao.
- PostgreSQL e backend precisam de nova verificacao operacional apos a ultima publicacao.
- A verificacao somente leitura de 2026-07-13 confirmou PostgreSQL, backend PM2, Nginx e frontend ativos; login e isolamento entre tenants ainda nao foram provados.
- O healthcheck local confirmou PostgreSQL, mas nao confirmou auth: o processo Node encerrou com `EPERM` do sandbox antes de escutar a porta 8000.
- O CI falhou no replay de migrações por usar `localhost:5432` apesar do serviço publicar PostgreSQL em `localhost:54322`; o workflow foi corrigido para usar `DATABASE_URL` integralmente.
- O replay seguinte confirmou que a porta foi corrigida e revelou a ordem incorreta da migration base; `base_tables` foi renomeada para preceder as migrations `202512...` dependentes.
- O mesmo replay revelou a dependência externa de `auth.users`; foi adicionada uma migration idempotente de compatibilidade para replay limpo sem substituir a tabela quando ela já existir.
- O replay seguinte encontrou `insurance_companies` usada antes de sua criação; as migrations fundacionais de pagamento, convênios, planos, vínculos profissionais e tabelas de preço foram reordenadas antes das alterações dependentes.
- O replay seguinte avançou até as policies e encontrou roles Supabase ausentes no PostgreSQL limpo; o CI passou a criá-las de forma condicional antes das migrations.
- O replay seguinte avançou até as policies e encontrou `auth.uid()` ausente; a compatibilidade agora cria essa função apenas em banco sem implementação Supabase.
- O replay seguinte chegou às funções operacionais de agenda e encontrou `professional_schedules` sem tabela base; foi adicionada uma migration idempotente com as janelas usadas pelo cálculo de disponibilidade.
- O replay seguinte chegou ao fluxo de recepção e encontrou as tabelas de autorização/elegibilidade ausentes; foi adicionada a fundação operacional antes da centralização em `insurance_*`.
- O replay seguinte chegou ao histórico oficial e identificou a ausência de `quantity_used`; a coluna foi adicionada para suportar controle de quantidade e prevenção de glosa.
- A validação local da rodada anterior passou com 476 testes, cobertura completa dentro dos thresholds, type-check, build e lint sem erros; o novo commit adiciona apenas workflow/documentação.
- O status remoto do commit atual não possui execução GitHub Actions associada; o único status externo reportado é Vercel em falha por limite de build. Isso não constitui falha do código nem substitui o CI do repositório.
- Foi criado o workflow manual `.github/workflows/f1-runtime-gate.yml`; ele exige Secrets protegidos para dois usuários de empresas distintas e executa somente o runner de isolamento, sem service role e sem DataSIGH.
- A auditoria estática encontrou e corrigiu no bootstrap o fallback inseguro para o primeiro usuário e para `service_role`; a regra agora falha fechado (`auth.uid()` nulo e role padrão `anon`).
- A compatibilidade de `auth.users` agora declara/adiciona de forma idempotente os campos usados pelo seed E2E e pelo auth server local (`encrypted_password`, `email_confirmed_at`, metadados e tokens).
- O CI agora executa o seed E2E no PostgreSQL efêmero após o replay e verifica as colunas críticas de autenticação antes dos testes de aplicação.
- A auditoria do backend confirmou que os vetores SQLi históricos estão protegidos; também foi corrigido o vazamento atual de mensagens SQL, que agora é registrado no servidor e substituído por erro genérico na resposta.

## Hipotese

O fluxo principal pode estar disponivel, mas ainda nao existe prova suficiente de isolamento entre duas empresas, nem prova ponta a ponta do TISS com fonte DataSIGH.

## Risco

O sistema nao esta apto para producao enquanto os testes P0 abaixo nao forem executados contra uma instancia real e a cadeia de deploy nao produzir evidencia reproduzivel.

## Fase atual

`security-hardening`

## Proxima tarefa executavel

Executar o workflow manual `F1 runtime gate` com Secrets homologados; depois registrar a evidência negativa de isolamento por `company_id`, validar autenticação/RBAC, rodar os testes de segurança no CI e fechar os gates de rollback.
