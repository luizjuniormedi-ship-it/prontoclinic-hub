# Fronteiras de modulo: Convenios e jornada administrativa

## Fonte oficial

O modulo **Convenios** e proprietario de:

- regras de elegibilidade;
- regras de autorizacao;
- cobertura, carencia, coparticipacao e limites;
- protocolos, senhas, validade e quantidades autorizadas;
- historico oficial versionado de autorizacoes e elegibilidades.

Tabelas oficiais de historico:

- `insurance_authorization_history`;
- `insurance_eligibility_history`.

Registros centrais unicos:

- `insurance_authorizations`;
- `insurance_eligibility_checks`.

Essas tabelas sao imutaveis. Correcoes geram nova versao; registros anteriores nunca sao alterados ou excluidos.

## Modulos consumidores

| Modulo | Responsabilidade |
| --- | --- |
| Agendamento / Call Center | Consultar regras antes de marcar e informar pendencias. |
| Recepcao | Consultar elegibilidade, solicitar e acompanhar autorizacao, registrar protocolos e resultados. |
| Modulo assistencial | Validar liberacao antes de executar procedimento. |
| Faturamento | Validar autorizacao, quantidade, validade e documentos antes de faturar. |

## Projecoes operacionais

`reception_authorizations` e `reception_eligibility_checks` sao views operacionais, sem armazenamento proprio. Elas projetam diretamente os registros centrais de Convenios para a Recepcao. Toda inclusao ou alteracao gera automaticamente uma nova versao no historico oficial.

## Regra de integridade

Nenhum modulo consumidor deve duplicar regras de cobertura ou editar historico oficial. Excecoes precisam de perfil autorizado, justificativa e evento auditavel.
