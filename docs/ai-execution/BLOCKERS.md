# Bloqueios

## P0

1. Nao ha evidencia registrada de teste de isolamento entre duas empresas contra banco e backend reais.
2. O CI precisa ser revalidado apos deixar falhas de migracao em modo fail-closed.
3. A reconciliacao TISS depende de credenciais DataSIGH fornecidas em ambiente seguro e com grants somente leitura verificaveis.
4. A VPS nao pode ser operada diretamente por esta sessao; os comandos SSH/deploy precisam ser executados no PowerShell do usuario.

## P1

1. A arquitetura de proxy aplica escopo por empresa, mas o escopo por unidade ainda nao esta formalizado.
2. Nao existe suite de integracao completa para o backend customizado.
3. A trilha de auditoria imutavel ainda nao foi implementada.

## Regra

Nenhum bloqueio e removido por prompt, suposicao ou resposta HTTP isolada. Cada desbloqueio exige comando, log ou teste reproduzivel.
