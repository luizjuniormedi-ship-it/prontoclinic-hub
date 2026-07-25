# Permissões de navegação

## Papéis canônicos

`admin`, `gestor`, `recepcao`, `medico`, `enfermagem`, `laboratorio`,
`diagnostico`, `farmacia`, `financeiro`, `dpo` e `administrativo`.

Aliases com acento ou nomes operacionais são normalizados em
`src/config/routePermissions.ts`. Papel desconhecido não recebe acesso por
aproximação.

## Camadas de autorização

1. O catálogo filtra o launcher.
2. A composição por perfil filtra a lateral.
3. `ProtectedRoute` bloqueia acesso direto por URL.
4. A API valida usuário, empresa, unidade, papel e ação.
5. O banco/RLS limita os dados do tenant.

As três primeiras camadas são experiência e defesa em profundidade. A API e o
banco permanecem autoridades de segurança.

## Regras de correspondência

Uma permissão de `/patients` vale para `/patients` e `/patients/...`, mas não
para `/patients-legacy`. Prefixos mais específicos vencem os mais gerais. Rotas
sem regra são negadas.

## Matriz resumida

| Domínio | Papéis |
|---|---|
| Agenda, pacientes e recepção | ADM/GES/REC; MED conforme rota |
| Prontuário e atendimento | ADM/MED |
| Enfermagem | ADM/MED/REC/ENF |
| Laboratório | ADM/GES/MED/DIA/LAB |
| DICOM e imagem | ADM/DIA; PACS e laudos incluem MED conforme rota |
| Faturamento e financeiro | ADM/GES/FIN; TISS inclui ADO |
| Farmácia e compras | ADM/GES/FAR/ADO; MED apenas na Farmácia |
| Administração de acesso | ADM/ADO |
| LGPD e auditoria | ADM/DPO |
| Empresas e configurações | ADM/GES/ADO |

## Contexto ativo

O papel efetivo vem da sessão ativada para empresa/unidade. O evento
`prontomedic:access-context-changed` atualiza lateral, launcher, atalhos,
`ProtectedRoute` e mensagem de acesso negado. O papel original do cadastro não
pode sobrepor o papel selecionado na sessão.

Trocar contexto não concede permissões novas por si só: a ativação precisa ser
aceita pelo backend e vinculada a uma associação autorizada. O frontend nunca
deve confiar em contexto arbitrário gravado pelo navegador.

## Testes obrigatórios

- aliases e papéis desconhecidos;
- limite de segmento de rota;
- itens da lateral autorizados;
- launcher sem módulos proibidos;
- acesso direto negado;
- troca de contexto sincronizada;
- isolamento de dados entre empresas/unidades no backend e RLS.
