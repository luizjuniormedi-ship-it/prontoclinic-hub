## Descrição

<!-- O que esse PR faz? Seja objetivo no primeiro parágrafo. -->

## Issues relacionadas

<!-- Use keywords do GitHub: Fixes, Closes, Resolves, Relates to -->

- Fixes #
- Relates to #

## Tipo de mudança

<!-- Marque com [x] o que se aplica -->

- [ ] Bug fix (mudança que corrige um problema sem quebrar nada)
- [ ] Nova feature (mudança que adiciona funcionalidade sem quebrar nada)
- [ ] Breaking change (mudança que pode quebrar funcionalidades existentes)
- [ ] Refatoração (sem mudança funcional)
- [ ] Documentação
- [ ] Performance
- [ ] Testes
- [ ] Build / CI / Dependências

## Motivação e contexto

<!-- Por que essa mudança é necessária? Qual problema resolve? -->

## Como testar

<!-- Passo a passo para o reviewer testar. Numerar sempre que possível. -->

1.
2.
3.
4.

## Screenshots / Vídeos

<!-- Se aplicável, adicione antes/depois ou GIFs. -->

## Checklist

<!-- Marque com [x] o que se aplica. Marque [N/A] se não se aplica. -->

### Qualidade

- [ ] Lint passa (`npm run lint`)
- [ ] Type check passa (`npx tsc --noEmit`)
- [ ] Testes unitários passam (`npm run test`)
- [ ] Testes E2E passam (`npm run test:e2e`)
- [ ] Self-review feita
- [ ] Comentários em código complexo adicionados

### Documentação

- [ ] README atualizado (se aplicável)
- [ ] DOCUMENTAÇÃO adicional atualizada (MODULES, MANUAL, FAQ, etc.)
- [ ] Comentários JSDoc em funções públicas

### Banco de Dados

- [ ] Migration criada em `supabase/migrations/`
- [ ] Migration testada localmente (`supabase db reset`)
- [ ] RLS aplicado em tabelas novas
- [ ] Seed atualizado (se necessário)

### Segurança

- [ ] Sem credenciais commitadas
- [ ] Sem dados sensíveis em logs/screenshots
- [ ] Validação Zod em inputs novos
- [ ] Sem `any` adicionado
- [ ] Sem uso de `dangerouslySetInnerHTML` sem sanitização

### Conventional Commits

- [ ] Commits seguem padrão (`feat:`, `fix:`, etc.)
- [ ] Breaking changes marcados com `!`

## Notas para o reviewer

<!-- Qualquer ponto de atenção, decisões de design, dúvidas, áreas que precisam de mais atenção. -->

## Deploy

<!-- Há plano de deploy específico? Feature flag? Migration precisa rodar antes do deploy? -->

- [ ] Migration precisa rodar antes do deploy
- [ ] Feature flag configurada
- [ ] Rollback planejado