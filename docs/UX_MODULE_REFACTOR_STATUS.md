# PRONTOMEDIC — Refatoração de Interface Módulo a Módulo

## Regra de execução

Um módulo somente pode ser marcado como validado quando possuir:

- responsabilidade visual clara;
- fluxo principal compreensível;
- funções preservadas;
- ações contextuais com explicação;
- estados de carregamento, vazio, erro e sucesso;
- permissões coerentes;
- testes unitários;
- testes de componente ou integração;
- type-check, lint e build aprovados;
- evidência de fluxo E2E quando o ambiente autenticado estiver disponível.

## Ordem de trabalho

1. Navegação global e menu por perfil.
2. Recepção e check-in.
3. Agenda e grades profissionais.
4. Atendimento clínico, prontuário e timeline.
5. Faturamento, TISS e financeiro.
6. Enfermagem e triagem.
7. Laboratório, imagem, PACS e laudos.
8. Farmácia, estoque e compras.
9. Internação, leitos e centro cirúrgico.
10. Administração, convênios e cadastros mestres.
11. BI, relatórios, CRM, comunicação e portal.

## Status

| Área | Situação | Escopo concluído | Gate pendente |
|---|---|---|---|
| Navegação global | Validada em CI anterior | menu por perfil, launcher, busca de telas, breadcrumbs e tooltips | validação visual autenticada por perfil |
| Recepção e check-in | Em validação | separação entre Chegadas, Sala de espera, Pendências, Em atendimento e Finalizados; jornada visual; remoção da ação clínica para recepção; explicações de ações e bloqueios | CI do commit atual e integração futura de cobrança/TISS no mesmo fluxo |
| Agenda e grades | Não iniciada nesta sequência | — | depende da validação da Recepção |
| Atendimento/Prontuário | Não iniciada nesta sequência | — | depende da Agenda |
| Faturamento/Financeiro | Não iniciada nesta sequência | — | depende do desenho do check-in e eventos de cobrança |

## Recepção — decisões aplicadas

### O que foi separado

- **Chegadas:** pacientes que ainda precisam de check-in.
- **Sala de espera:** pacientes já liberados e encaminhados.
- **Pendências:** elegibilidades e autorizações que exigem ação administrativa.
- **Em atendimento:** acompanhamento do status, sem permitir que a recepção inicie ato clínico.
- **Finalizados:** histórico operacional do dia.

### Jornada do check-in

1. Identificação.
2. Cadastro e documentos.
3. Pagador e convênio.
4. Elegibilidade.
5. Autorização.
6. Fila e destino.

A interface mostra o estado de cada etapa e direciona para a correção correspondente. A liberação por exceção permanece condicionada ao perfil autorizado e à justificativa obrigatória.

### Testes adicionados

- estados da jornada de check-in;
- mapeamento de pendências para a etapa correta;
- filtragem de bloqueios;
- acessibilidade e motivo de indisponibilidade dos botões;
- separação visual de Chegadas, Sala de espera e Pendências;
- ausência do botão clínico para o perfil Recepção;
- abertura do fluxo guiado;
- abertura da atualização de autorização.

## Pendência funcional explícita

O módulo Recepção ainda não deve ser considerado integralmente concluído até que cobrança, coparticipação, forma de pagamento, pré-conta e geração/assinatura de guia TISS estejam integradas ao mesmo contexto do check-in com backend transacional e testes próprios. Nenhum botão simulado deve ser criado para encobrir essa lacuna.
