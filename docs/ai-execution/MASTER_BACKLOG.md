# Backlog Mestre

## P0 - Bloqueia producao

- [ ] Provar isolamento entre duas empresas no backend, incluindo GET, COUNT, POST e PATCH.
- [x] Reexecutar CI com migracoes PostgreSQL em modo fail-closed e corrigir qualquer falha real de baseline.
- [x] Confirmar healthcheck basico da VPS: PostgreSQL, backend PM2, Nginx e frontend; login operacional ainda depende de credenciais.
- [ ] Executar reconciliacao TISS em modo `dry-run` com credencial DataSIGH somente leitura.
- [ ] Validar que o deploy usa exatamente o commit aprovado e que o rollback foi testado com restore real.

## P1 - Necessario antes da homologacao ampla

- [x] Implementar trilha de auditoria append-only para operacoes sensiveis; controle administrativo de owner/superuser permanece fora do banco.
- [ ] Formalizar escopo por unidade, alem do escopo por empresa.
- [ ] Criar testes de integracao com PostgreSQL real para auth, RBAC e isolamento.
- [ ] Adicionar observabilidade minima: request id, erros estruturados, latencia e alertas.
- [ ] Validar fluxos de Convenios, TISS, Recepcao, Agendamento, Atendimento e Faturamento com dados controlados.

## P2 - Qualidade e manutencao

- [ ] Reduzir warnings de lint de 430 para zero ou justificar cada excecao.
- [ ] Atualizar dependencia com vulnerabilidade baixa apos confirmar compatibilidade.
- [ ] Automatizar relatorio de cobertura funcional por perfil.
