# Next Round

## Ultimo checkpoint

A rodada de isolamento do tenant de agendamento foi concluida no GitHub.

- Commit: `03344df6d52ce8f1859b702497a2621e21b361d8`
- F1 Runtime Gate: `29368282977` PASS
- CI: `29368282978` PASS
- Escopo: trigger de banco impede que uma sessao autenticada grave agendamento em outro tenant.
- Nenhuma escrita no DataSIGH e nenhum deploy irreversivel foram executados.

## Proxima ordem segura

1. Obter acesso validado a VPS e executar apenas healthcheck/login de homologacao.
2. Executar reconciliação DataSIGH somente leitura, sem `INSERT`, `UPDATE`, `DELETE`, DDL ou transmissao.
3. Executar backup/restore/rollback em ambiente controlado e guardar evidencias.
4. Validar owner/BYPASSRLS, replay de migrations e paridade RLS entre local e remoto.
5. Reabrir o gate final somente com logs e resultados reproduziveis.

Nao avançar para deploy/publicacao enquanto qualquer item acima estiver sem evidencia.

## Checkpoint adicional

A auditoria de owner/RLS passou no CI: `29376855228` (F1) e `29376855298` (CI). O teste impede BYPASSRLS em proprietarios nao-superusuarios e distingue o postgres superusuario do replay efemero. Ainda e obrigatoria a comprovacao equivalente na VPS antes da liberacao.

## Bloqueio externo confirmado

A leitura da VPS confirmou que frontend/backend respondem, mas o banco `prontoclinic` nao tem os roles de runtime esperados e possui tabelas protegidas sem RLS. A proxima acao correta e um replay controlado das migrations no banco da VPS, precedido por backup verificavel e autorizado. Nao executar automaticamente e nao tocar no DataSIGH.
