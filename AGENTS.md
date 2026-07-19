# ProntoMedic - Diretriz de Execução

Antes de qualquer evolução, correção, teste, migration, publicação ou ação operacional:

1. Leia integralmente `docs/PRONTOMEDIC_DIRETRIZ_MESTRE.md`.
2. Leia `NEXT_ROUND.md` e `state.json` para identificar o módulo atual, os gates e os bloqueios.
3. Audite o módulo atual no banco, backend, APIs, frontend, permissões, auditoria, integrações, testes e documentação.
4. Não avance para o módulo seguinte enquanto houver pendência crítica ou funcionalidade incompleta no módulo atual.
5. Separe evidência local, evidência da VPS e evidência de produção. Código local aprovado não é deploy aprovado.
6. Preserve mudanças existentes e faça alterações pequenas, reversíveis e compatíveis com a arquitetura atual.
7. Não altere, sincronize, migre, escreva ou desligue o DataSIGH. Qualquer inspeção autorizada deve ser somente leitura.
8. Não execute deploy, migration remota, backup/restore/rollback ou abertura de portas sem autorização operacional explícita, plano de rollback e evidência do resultado.
9. Nunca coloque credenciais, tokens, dados clínicos ou segredos em código, logs, fixtures ou relatórios.
10. Ao concluir uma rodada, atualize `NEXT_ROUND.md`, `state.json`, a documentação do módulo e o relatório com arquivos, testes, evidências e pendências reais.
11. Consulte `docs/AGENTES_E_MCPS_AVALIADOS.md` antes de adicionar ou conectar qualquer agente, MCP, provider externo ou ferramenta de automação.

## Fonte normativa

`docs/PRONTOMEDIC_DIRETRIZ_MESTRE.md` é a fonte funcional e técnica principal do projeto. Em caso de conflito com um plano antigo, use a diretriz mais recente e registre a decisão em `NEXT_ROUND.md`.

## Gate de conclusão

Um módulo só pode ser marcado como concluído quando possuir banco/migrations aplicáveis, backend/API real, frontend integrado, autorização no backend e frontend, auditoria, tratamento de erros, testes unitários/integrados/E2E, documentação e validação ponta a ponta. Não declare produção liberada enquanto os gates remotos não forem comprovados.
