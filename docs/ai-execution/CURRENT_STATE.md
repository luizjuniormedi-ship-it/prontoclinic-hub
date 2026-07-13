# Estado Atual de Execucao

Atualizado em 2026-07-13.

## Fato tecnico

- Repositorio local: `C:\Users\Meu Computador\AppData\Local\Temp\prontoclinic-hub`.
- Ultimo commit local conhecido: `e75db24` antes da correção do workflow de migração.
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

## Hipotese

O fluxo principal pode estar disponivel, mas ainda nao existe prova suficiente de isolamento entre duas empresas, nem prova ponta a ponta do TISS com fonte DataSIGH.

## Risco

O sistema nao esta apto para producao enquanto os testes P0 abaixo nao forem executados contra uma instancia real e a cadeia de deploy nao produzir evidencia reproduzivel.

## Fase atual

`security-hardening`

## Proxima tarefa executavel

Executar healthcheck pos-deploy, validar autenticacao/RBAC e criar evidencia negativa de isolamento por `company_id`.
