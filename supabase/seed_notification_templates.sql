-- =============================================================================
-- Seed: notification_templates
-- Descrição: 12 templates essenciais para o sistema de notificações
--            Idioma: pt-BR | company_id: NULL (global, qualquer tenant pode usar)
--            Substitui o SMTP quebrado do SIGH
--
-- Como aplicar:
--   psql $DATABASE_URL -f supabase/seed_notification_templates.sql
-- Ou via Supabase Studio > SQL Editor.
-- =============================================================================

INSERT INTO public.notification_templates
  (company_id, code, channel, subject, body, variables_schema, language, version, is_active)
VALUES
  -- ===========================================================================
  -- 1. APPOINTMENT_CONFIRMATION (E-mail)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_CONFIRMATION',
    'EMAIL',
    'Consulta confirmada - {{clinica}}',
    E'Olá, {{nome_paciente}}!\n\nSua consulta com Dr(a). {{nome_medico}} está confirmada para:\n\n  Data: {{data}}\n  Hora: {{hora}}\n  Local: {{clinica}}\n  Endereço: {{endereco}}\n\nEm caso de dúvidas, entre em contato:\n  Telefone: {{telefone_clinica}}\n  E-mail: {{email_clinica}}\n\nCaso precise reagendar, acesse: {{link_reagendar}}\n\nAtenciosamente,\nEquipe {{clinica}}',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data": "date",
      "hora": "time",
      "clinica": "string",
      "endereco": "string",
      "telefone_clinica": "string",
      "email_clinica": "string",
      "link_reagendar": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 2. APPOINTMENT_REMINDER_24H (E-mail)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_REMINDER_24H',
    'EMAIL',
    'Lembrete: sua consulta é amanhã - {{clinica}}',
    E'Olá, {{nome_paciente}}!\n\nEste é um lembrete de que sua consulta com Dr(a). {{nome_medico}} está agendada para AMANHÃ:\n\n  Data: {{data}}\n  Hora: {{hora}}\n  Especialidade: {{especialidade}}\n  Local: {{clinica}}\n\nPara confirmar ou reagendar, acesse: {{link_confirmar}}\n\nCaso não possa comparecer, cancele com pelo menos 4 horas de antecedência para liberar a agenda.\n\nAté amanhã!\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data": "date",
      "hora": "time",
      "especialidade": "string",
      "clinica": "string",
      "link_confirmar": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 3. APPOINTMENT_REMINDER_24H (WhatsApp)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_REMINDER_24H',
    'WHATSAPP',
    NULL,
    E'Olá, {{nome_paciente}}! 👋\n\nLembrete da sua consulta *amanhã*:\n\n📅 {{data}} às {{hora}}\n👨‍⚕️ Dr(a). {{nome_medico}}\n🏥 {{clinica}}\n\nConfirme sua presença aqui: {{link_confirmar}}\n\nPara cancelar, responda *CANCELAR*.',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data": "date",
      "hora": "time",
      "clinica": "string",
      "link_confirmar": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 4. APPOINTMENT_REMINDER_1H (SMS — conciso)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_REMINDER_1H',
    'SMS',
    NULL,
    E'{{clinica}}: sua consulta com Dr(a). {{nome_medico}} é em 1 HORA ({{hora}}). Endereço: {{endereco}}. Confirmar: {{link_curto}}',
    '{
      "clinica": "string",
      "nome_medico": "string",
      "hora": "time",
      "endereco": "string",
      "link_curto": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 5. APPOINTMENT_CANCELLED (E-mail)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_CANCELLED',
    'EMAIL',
    'Consulta cancelada - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nSua consulta que estava agendada para {{data}} às {{hora}} com Dr(a). {{nome_medico}} foi *cancelada*.\n\nMotivo: {{motivo}}\n\nPara agendar uma nova consulta, acesse: {{link_agendar}}\nOu ligue: {{telefone_clinica}}\n\nLamentamos o inconveniente.\n\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data": "date",
      "hora": "time",
      "motivo": "string",
      "clinica": "string",
      "link_agendar": "url",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 6. APPOINTMENT_RESCHEDULED (E-mail)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_RESCHEDULED',
    'EMAIL',
    'Consulta reagendada - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nSua consulta com Dr(a). {{nome_medico}} foi *reagendada*:\n\n  De: {{data_antiga}} às {{hora_antiga}}\n  Para: {{data_nova}} às {{hora_nova}}\n  Local: {{clinica}}\n\nSe a nova data/hora não for conveniente, reagende aqui: {{link_reagendar}}\n\nAtenciosamente,\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data_antiga": "date",
      "hora_antiga": "time",
      "data_nova": "date",
      "hora_nova": "time",
      "clinica": "string",
      "link_reagendar": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 7. APPOINTMENT_NO_SHOW (E-mail)
  -- ===========================================================================
  (
    NULL,
    'APPOINTMENT_NO_SHOW',
    'EMAIL',
    'Sentimos sua falta - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nNotamos que você não compareceu à sua consulta de {{data}} às {{hora}} com Dr(a). {{nome_medico}}.\n\nEsperamos que esteja bem! Para reagendar, basta clicar aqui: {{link_agendar}}\n\nCaso tenha tido algum imprevisto, entre em contato: {{telefone_clinica}}\n\nEstamos à disposição.\n\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "nome_medico": "string",
      "data": "date",
      "hora": "time",
      "clinica": "string",
      "link_agendar": "url",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 8. NPS_POST_VISIT (E-mail)
  -- ===========================================================================
  (
    NULL,
    'NPS_POST_VISIT',
    'EMAIL',
    'Como foi sua consulta? - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nObrigado por visitar {{clinica}}!\n\nSua opinião é muito importante para melhorarmos continuamente. Leva menos de 30 segundos:\n\n⭐⭐⭐⭐⭐ Avalie sua experiência: {{link_nps}}\n\nEm uma escala de 0 a 10, o quanto você recomendaria nossa clínica a um amigo ou familiar?\n\nSua resposta é sigilosa e nos ajuda a oferecer um atendimento cada vez melhor.\n\nMuito obrigado!\nEquipe {{clinica}}',
    '{
      "nome_paciente": "string",
      "clinica": "string",
      "link_nps": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 9. NPS_POST_VISIT (WhatsApp — conciso)
  -- ===========================================================================
  (
    NULL,
    'NPS_POST_VISIT',
    'WHATSAPP',
    NULL,
    E'Oi, {{nome_paciente}}! 👋\n\nObrigado por visitar a {{clinica}} hoje.\n\nDe 0 a 10, quanto você nos recomenda?\n\n👉 Responda aqui: {{link_nps}}\n\nLeva 10 segundos! 🙏',
    '{
      "nome_paciente": "string",
      "clinica": "string",
      "link_nps": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 10. PRE_CADASTRO_CONFIRMATION (E-mail)
  -- ===========================================================================
  (
    NULL,
    'PRE_CADASTRO_CONFIRMATION',
    'EMAIL',
    'Bem-vindo(a) à {{clinica}}! Confirme seu pré-cadastro',
    E'Olá, {{nome_paciente}}!\n\nRecebemos seu pré-cadastro em {{clinica}}.\n\nPara finalizar seu cadastro, clique no link abaixo e complete seus dados:\n\n🔗 {{link_confirmacao}}\n\nSeus dados pré-cadastrados:\n  Nome: {{nome_paciente}}\n  E-mail: {{email}}\n  Telefone: {{telefone}}\n\nEm caso de dúvidas: {{telefone_clinica}}\n\nBem-vindo(a)!\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "email": "string",
      "telefone": "string",
      "clinica": "string",
      "link_confirmacao": "url",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 11. LAB_RESULT_READY (E-mail)
  -- ===========================================================================
  (
    NULL,
    'LAB_RESULT_READY',
    'EMAIL',
    'Resultado de exame disponível - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nSeu resultado de exame ({{tipo_exame}}) realizado em {{data_exame}} já está disponível.\n\nAcesse pelo portal do paciente: {{link_resultado}}\n\nLogin: {{email}}\nSenha provisória: enviada em e-mail separado\n\nCaso prefira retirar presencialmente, traga documento com foto.\n\nDúvidas: {{telefone_clinica}}\n\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "tipo_exame": "string",
      "data_exame": "date",
      "clinica": "string",
      "link_resultado": "url",
      "email": "string",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 12. BIRTHDAY_GREETING (E-mail)
  -- ===========================================================================
  (
    NULL,
    'BIRTHDAY_GREETING',
    'EMAIL',
    'Feliz aniversário, {{nome_paciente}}! 🎂 - {{clinica}}',
    E'Olá, {{nome_paciente}}!\n\nToda a equipe da {{clinica}} deseja um feliz aniversário! 🎉\n\nQue este novo ciclo seja repleto de saúde e alegrias.\n\nComo presente, preparamos algo especial para você: {{desconto}}\nVálido até {{data_validade}}. Aproveite: {{link_promocao}}\n\nCom carinho,\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "clinica": "string",
      "desconto": "string",
      "data_validade": "date",
      "link_promocao": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 13. BIRTHDAY_GREETING (WhatsApp)
  -- ===========================================================================
  (
    NULL,
    'BIRTHDAY_GREETING',
    'WHATSAPP',
    NULL,
    E'Parabéns, {{nome_paciente}}! 🎂🎉\n\nA equipe da {{clinica}} te deseja um feliz aniversário!\n\nPreparamos um presente especial: {{desconto}}\nVálido até {{data_validade}}. 👉 {{link_promocao}}',
    '{
      "nome_paciente": "string",
      "clinica": "string",
      "desconto": "string",
      "data_validade": "date",
      "link_promocao": "url"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 14. INSURANCE_AUTHORIZATION (E-mail)
  -- ===========================================================================
  (
    NULL,
    'INSURANCE_AUTHORIZATION',
    'EMAIL',
    'Autorização de convênio liberada - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nInformamos que sua solicitação de autorização junto a {{convenio}} para o procedimento {{procedimento}} foi *{{status_autorizacao}}*.\n\n  Protocolo: {{protocolo}}\n  Data da solicitação: {{data_solicitacao}}\n  Validade: {{data_validade}}\n  Senha/Guia: {{senha}}\n\nAgende seu procedimento: {{link_agendar}}\nDúvidas: {{telefone_clinica}}\n\nAtenciosamente,\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "convenio": "string",
      "procedimento": "string",
      "status_autorizacao": "string",
      "protocolo": "string",
      "data_solicitacao": "date",
      "data_validade": "date",
      "senha": "string",
      "clinica": "string",
      "link_agendar": "url",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  ),

  -- ===========================================================================
  -- 15. PAYMENT_REMINDER (E-mail)
  -- ===========================================================================
  (
    NULL,
    'PAYMENT_REMINDER',
    'EMAIL',
    'Lembrete de pagamento - {{clinica}}',
    E'Olá, {{nome_paciente}},\n\nIdentificamos a seguinte pendência financeira em seu cadastro:\n\n  Descrição: {{descricao}}\n  Valor: {{valor}}\n  Vencimento: {{vencimento}}\n  Dias em atraso: {{dias_atraso}}\n\nPara pagar, acesse: {{link_pagamento}}\nOu em boleto anexo.\n\nCaso já tenha efetuado o pagamento, desconsidere este aviso.\n\nDúvidas: {{telefone_clinica}}\n{{clinica}}',
    '{
      "nome_paciente": "string",
      "descricao": "string",
      "valor": "currency",
      "vencimento": "date",
      "dias_atraso": "number",
      "clinica": "string",
      "link_pagamento": "url",
      "telefone_clinica": "string"
    }'::JSONB,
    'pt-BR',
    1,
    TRUE
  )
ON CONFLICT (code, channel, language) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  variables_schema = EXCLUDED.variables_schema,
  version = public.notification_templates.version + 1,
  updated_at = NOW();

-- =============================================================================
-- Verificação
-- =============================================================================
SELECT
  channel,
  COUNT(*) AS total,
  STRING_AGG(code, ', ' ORDER BY code) AS templates
FROM public.notification_templates
GROUP BY channel
ORDER BY channel;