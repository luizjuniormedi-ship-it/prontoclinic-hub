# Changelog

## Não publicado - refatoração de navegação

### Adicionado

- Catálogo central completo, incluindo `/meus-agendamentos` e rotas contextuais.
- Launcher acessível e pesquisável por título, descrição e palavra-chave.
- Hook de papel ativo sincronizado com empresa/unidade/perfil.
- Componente `ExplainedActionButton` para ação, indisponibilidade e confirmação.
- Matriz E2E de navegação para dez perfis operacionais.
- Documentação de auditoria, mapa, permissões, módulos e padrões de componente.

### Alterado

- Lateral limitada a cinco a oito tarefas diárias por perfil.
- Breadcrumbs orientados pelas oito áreas de trabalho.
- Busca renomeada para “Buscar telas e funções”.
- Menu do usuário, ajuda, notificações e tema reorganizados na barra superior.
- Matching de permissões e catálogo agora respeita limite de segmento.
- Menu, launcher, atalhos, gates e acesso negado usam o papel do contexto ativo.
- O contexto visual exige correspondência com a sessão registrada pelo backend.
- Oito telas legadas receberam breadcrumb sem duplicar seus títulos.
- Telemedicina usa papel e empresa do contexto ativo.

### Corrigido

- Rota privada sem representação no catálogo.
- Contador fictício de notificações.
- Launcher sem título e descrição acessíveis.
- Atalhos que podiam navegar para uma rota não autorizada.
- Gates administrativos genéricos que bloqueavam perfis autorizados ou
  divergiam da matriz específica.
- Seletor de contexto travado após uma troca bem-sucedida.
- Layout duplicado no dashboard de BI.

### Não incluído

- Nenhuma rota removida.
- Nenhuma alteração de RLS, migration ou DataSIGH.
- Nenhum deploy ou merge em `main`.
- Agenda profissional completa, check-in de 12 etapas e feed pessoal de
  notificações permanecem como lacunas funcionais documentadas.
