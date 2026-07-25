# Padrões de componentes e ações

## Cabeçalho de página

Toda tela privada recebe do `AppLayout` o breadcrumb
`Área de trabalho > Tela`. A página deve usar `PageHeader` com:

1. título único em `h1`;
2. descrição curta e operacional;
3. ação principal, quando houver;
4. ações secundárias agrupadas;
5. ações raras ou críticas em `Mais ações`.

O breadcrumb não deve ser repetido dentro da página. Rotas contextuais usam a
tela proprietária do catálogo como referência; nomes de pacientes e outras
entidades permanecem no cabeçalho ou no conteúdo clínico, sem substituir a
localização funcional.

Listas e processos devem implementar estados de carregamento, vazio, erro e
sucesso. Estado, histórico e ajuda contextual devem aparecer quando fizerem
parte do contrato da tela.

## ExplainedActionButton

Use `ExplainedActionButton` para ações que precisam explicar efeito,
indisponibilidade ou confirmação.

```tsx
<ExplainedActionButton
  label="Concluir check-in"
  description="Finaliza a validação e encaminha o paciente."
  disabled={!canFinish}
  disabledReason="A autorização obrigatória ainda está pendente."
  onClick={finishCheckIn}
/>
```

Contrato:

- `label`: comando objetivo e sempre visível em ações principais;
- `description`: efeito da ação no fluxo;
- `icon`: opcional e nunca substitui o texto no celular;
- `allowed`: controla apenas oferta visual, nunca a segurança real;
- `disabled` e `disabledReason`: mostram imediatamente por que não é possível;
- `loading`: bloqueia repetição e expõe `aria-busy`;
- `confirmation`: obrigatório para cancelamento, estorno e outras ações críticas;
- `variant` e `size`: seguem o design system;
- `onClick`: executa o comando real.

O componente oferece tooltip no hover e foco, `aria-label`,
`aria-describedby`, motivo textual fora do tooltip para ações desabilitadas e
diálogo cancelável com Esc para confirmação.

## Responsividade e acessibilidade

- Ação principal mantém texto em celular e tablet.
- Ícone isolado é permitido apenas para controles universalmente reconhecíveis
  e com nome acessível.
- Nenhuma função depende de hover.
- Controles possuem foco visível e alvo estável.
- Tooltips usam atraso entre 300 e 500 ms e não ocultam o controle.
- Diálogos possuem título e descrição acessíveis.
- Texto longo trunca somente quando o conteúdo completo existe no tooltip ou em
  região acessível.
- Não exibir contadores, estados ou notificações sem fonte de dados real.

## Barra superior

Controles obrigatórios: alternância da lateral, busca de telas e funções,
launcher, seletor de contexto, notificações, ajuda e menu do usuário. Em telas
estreitas, ajuda continua disponível no menu do usuário e o launcher mantém um
nome acessível.
