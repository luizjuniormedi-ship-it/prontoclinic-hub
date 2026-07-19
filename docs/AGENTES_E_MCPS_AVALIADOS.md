# Agentes e MCPs avaliados para o ProntoMedic

**Data da avaliação:** 2026-07-19  
**Regra:** nenhum servidor MCP recebe acesso à VPS, Supabase ou DICOM clínico sem revisão, escopo mínimo, credencial separada e teste controlado.

## Recomendados para adoção controlada

| Recurso | Repositório público | Uso no projeto | Política de uso |
|---|---|---|---|
| GitHub MCP Server | https://github.com/github/github-mcp-server | Issues, PRs, Actions, código e segurança do repositório | Começar com `--read-only` e toolsets `repos,issues,pull_requests,actions,code_security`; PAT mínimo e sem publicar/mesclar automaticamente. |
| Supabase MCP | https://github.com/supabase-community/supabase-mcp | Auditar schema, migrations, RLS, funções e configuração do projeto Supabase correto | Usar somente no projeto ProntoMedic autorizado; iniciar em leitura; nunca apontar para DataSIGH; confirmar organização/projeto antes de qualquer operação. |
| Playwright MCP | https://github.com/microsoft/playwright-mcp | Exploração e validação de telas, fluxos autenticados e regressões do sistema | Preferir Playwright CLI/skill para os gates repetíveis; quando usar MCP, limitar hosts/origins, manter browser isolado e não habilitar acesso irrestrito a arquivos. |
| MCP Server Audit | https://github.com/ModelContextProtocol-Security/mcpserver-audit | Avaliar vulnerabilidades e riscos dos servidores MCP antes de instalar | Gate obrigatório para qualquer servidor comunitário ou ferramenta que tenha acesso a rede, arquivos, banco ou credenciais. |
| MCP Conformance | https://github.com/modelcontextprotocol/conformance | Validar conformidade de um gateway/MCP próprio | Executar contra servidor local ou ambiente descartável antes de qualquer publicação. |

## Úteis somente em laboratório isolado

| Recurso | Repositório | Motivo da restrição |
|---|---|---|
| DICOM MCP | https://github.com/ChristianHinge/dicom-mcp | Permite C-ECHO, consulta e movimentação DICOM, mas o próprio projeto alerta que não é para uso clínico. Usar apenas com Orthanc local e estudos sintéticos; nunca com DataSIGH, CT/USG real ou PACS de produção. |
| Postgres MCP Pro | https://github.com/crystaldba/postgres-mcp | Pode ajudar em schema, índices e planos, mas deve operar em modo restrito/read-only, com usuário PostgreSQL sem escrita e banco descartável sempre que possível. |
| PostgreSQL read-only MCP | https://github.com/sgaunet/postgresql-mcp | Alternativa simples para inspeção de schema; validar dependências, manutenção e limites antes de adotar. Não usar credencial de produção com permissão de escrita. |

## Agentes de engenharia avaliados

| Agente/framework | Repositório | Decisão |
|---|---|---|
| OpenHands | https://github.com/OpenHands/OpenHands | Pode ser usado em worktree descartável para auditoria e patches locais. Não deve receber token de produção, sessão RDP ou acesso direto ao DataSIGH. |
| LangGraph | https://github.com/langchain-ai/langgraph | Adequado para orquestrar agentes especializados com estado, aprovação humana e retomada. Não é necessário adicionar ao frontend; manter como orquestrador externo se adotado. |
| Microsoft Agent Framework | https://github.com/microsoft/semantic-kernel | Opção para futura orquestração multiagente com MCP/A2A. Não é dependência necessária para fechar os módulos atuais. |

## Frente recomendada para o próximo ciclo

1. Usar o GitHub MCP em modo somente leitura para conferir PRs, CI e issues.
2. Usar o Supabase MCP somente no projeto ProntoMedic, primeiro para inspeção read-only da migration do Módulo 2.
3. Rodar o replay em PostgreSQL descartável e validar RLS/RBAC com duas empresas e duas unidades.
4. Usar Playwright para E2E autenticado contra ambiente autorizado, sem mutações destrutivas.
5. Validar qualquer MCP comunitário com `mcpserver-audit` antes de instalação.
6. Só depois avaliar publicação controlada, backup e rollback.

## Proibições operacionais

- Não configurar MCP com credenciais ou dados do DataSIGH.
- Não permitir que um agente execute migration, deploy, reset, C-STORE, alteração de firewall ou publicação sem aprovação explícita e rollback.
- Não usar DICOM MCP em equipamento real ou com estudo clínico.
- Não colocar PAT, senha, JWT, DSN ou token em este arquivo, no código ou nos logs.
- Não considerar uma resposta de agente como evidência de runtime; exigir logs, status HTTP, banco e teste reproduzível.
