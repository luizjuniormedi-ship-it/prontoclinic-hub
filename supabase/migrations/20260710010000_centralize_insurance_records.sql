-- One central record in Convenios; reception_* become compatibility projections.
DO $$
BEGIN
 IF to_regclass('public.insurance_authorizations') IS NULL
    AND EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.reception_authorizations') AND relkind='r') THEN
  ALTER TABLE public.reception_authorizations RENAME TO insurance_authorizations;
 END IF;
 IF to_regclass('public.insurance_eligibility_checks') IS NULL
    AND EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.reception_eligibility_checks') AND relkind='r') THEN
  ALTER TABLE public.reception_eligibility_checks RENAME TO insurance_eligibility_checks;
 END IF;
END $$;

CREATE OR REPLACE VIEW public.reception_authorizations
WITH (security_invoker=true) AS SELECT * FROM public.insurance_authorizations;
CREATE OR REPLACE VIEW public.reception_eligibility_checks
WITH (security_invoker=true) AS SELECT * FROM public.insurance_eligibility_checks;

COMMENT ON TABLE public.insurance_authorizations IS 'Registro central unico do dominio Convenios. Consultado por Agenda, Recepcao, Assistencia e Faturamento.';
COMMENT ON TABLE public.insurance_eligibility_checks IS 'Registro central unico de elegibilidade do dominio Convenios.';
COMMENT ON VIEW public.reception_authorizations IS 'Projecao operacional sem armazenamento proprio para a Central de Autorizacoes da Recepcao.';
COMMENT ON VIEW public.reception_eligibility_checks IS 'Projecao operacional sem armazenamento proprio para consulta de elegibilidade na Recepcao.';

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
  GRANT SELECT,INSERT,UPDATE ON public.insurance_authorizations,public.insurance_eligibility_checks TO app_prontomedic;
  GRANT SELECT,INSERT,UPDATE ON public.reception_authorizations,public.reception_eligibility_checks TO app_prontomedic;
 END IF;
END $$;
