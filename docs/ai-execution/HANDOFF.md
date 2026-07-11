# Handoff Operacional

## Onde retomar

1. Confirmar o commit efetivamente publicado na VPS.
2. Rodar o script de auditoria da VPS e registrar portas, PM2, PostgreSQL, Nginx e HTTP.
3. Executar teste de login com usuario controlado.
4. Executar teste de isolamento com duas empresas.
5. Atualizar este diretorio antes de iniciar a proxima tarefa.

## Comando de referencia no Windows

`powershell -ExecutionPolicy Bypass -File "C:\Users\Meu Computador\Documents\Codex\2026-07-07\pr\check-prontomedic-vps.ps1"`

## Limite operacional

Esta sessao nao possui acesso direto a chave privada SSH. Nao registrar credenciais, tokens ou valores de JWT nos arquivos de estado.
