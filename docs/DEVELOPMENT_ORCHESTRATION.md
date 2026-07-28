# Orquestração de desenvolvimento sem colisões

## Regra principal

Nenhum agente edita o checkout principal. Cada tarefa começa em um worktree
criado pelo coordenador, a partir de uma baseline explícita e imutável.

## Iniciar uma tarefa

```powershell
.\scripts\coordination.ps1 Begin `
  -TaskId module-11-reception `
  -Module 11 `
  -Paths @("src/pages/ReceptionPage.tsx", "src/components/patients") `
  -SharedPaths @("src/App.tsx")
```

O comando adquire uma trava compartilhada, rejeita caminhos sobrepostos, fixa o
commit-base, cria branch/worktree próprios e grava `.coordination/task.json`.
Cada PR substitui esse manifesto; o CI exige que ele tenha sido alterado no PR.

## Verificar e encerrar

```powershell
.\scripts\coordination.ps1 Verify -TaskId module-11-reception
.\scripts\coordination.ps1 End -TaskId module-11-reception
```

O verificador reprova arquivos fora do escopo. A claim só é liberada com
worktree limpo; o worktree é retido para auditoria.

## Regras

- Um agente por worktree e um módulo por PR.
- Migrations são sempre exclusivas.
- `package.json`, lockfiles, `src/App.tsx`, workflows e infraestrutura são
  compartilhados e passam por integração serial.
- Artefatos gerados não são misturados ao commit funcional.
- A baseline só avança após CI verde.
- Deploy usa release imutável, rollback preservado e fila única.

## Proibições

- Não editar no checkout principal.
- Não misturar módulos no mesmo PR.
- Não editar DataSIGH.
- Não aplicar migration ou deploy de worktree sujo.
- Não declarar módulo concluído por tela ou teste mockado.
- Não executar dois deploys simultâneos.
