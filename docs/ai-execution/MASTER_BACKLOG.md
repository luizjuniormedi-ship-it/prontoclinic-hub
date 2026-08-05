# Backlog Mestre

## P0 - Bloqueia producao

- [ ] Provar isolamento entre duas empresas no backend, incluindo GET, COUNT, POST e PATCH.
- [x] Reexecutar CI com migracoes PostgreSQL em modo fail-closed e corrigir qualquer falha real de baseline. Evidencia: CI `31006412836`.
- [x] Confirmar healthcheck publico da VPS: Nginx, frontend, Auth Admin e Edge Functions. Evidencias: deploys `31007802198` e `31008174045`.
- [ ] Executar reconciliacao TISS em modo `dry-run` com credencial DataSIGH somente leitura.
- [x] Validar que o deploy usa exatamente o commit aprovado e que o rollback foi testado. SHA `3b53a444b21fe1de61d4d91b82c8624ac962c1d0`; workflow `31007492826`.
- [ ] Criar ambiente QA remoto realmente descartavel, com identidades sinteticas, MFA AAL2 e limpeza comprovada.
- [ ] Homologar convite, recuperacao, suspensao, reativacao e logout global sem atingir usuarios reais.

## P1 - Necessario antes da homologacao ampla

- [x] Implementar trilha persistente de auditoria para operacoes Auth Admin sensiveis.
- [ ] Formalizar escopo por unidade, alem do escopo por empresa.
- [ ] Criar testes de integracao com PostgreSQL real para auth, RBAC e isolamento.
- [ ] Adicionar observabilidade minima: request id, erros estruturados, latencia e alertas.
- [ ] Validar fluxos de Convenios, TISS, Recepcao, Agendamento, Atendimento e Faturamento com dados controlados.

## P2 - Qualidade e manutencao

- [ ] Reduzir warnings de lint de 430 para zero ou justificar cada excecao.
- [ ] Atualizar dependencia com vulnerabilidade baixa apos confirmar compatibilidade.
- [ ] Automatizar relatorio de cobertura funcional por perfil.
