-- Constraints opcionais para chaves de origem SIGH.
-- O baseline canônico não materializa cd_origem_sigh em todas as tabelas;
-- cada constraint só é aplicada quando a coluna existe.

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('units', 'units_cd_origem_sigh_key'),
      ('specialties', 'specialties_cd_origem_sigh_key'),
      ('professionals', 'professionals_cd_origem_sigh_key'),
      ('insurance_companies', 'insurance_companies_cd_origem_sigh_key'),
      ('insurance_plans', 'insurance_plans_cd_origem_sigh_key'),
      ('payment_sources', 'payment_sources_cd_origem_sigh_key'),
      ('fornecedores', 'fornecedores_cd_origem_sigh_key'),
      ('professional_insurances', 'professional_insurances_cd_origem_sigh_key'),
      ('patients', 'patients_cd_origem_sigh_key'),
      ('appointments', 'appointments_cd_origem_sigh_key'),
      ('tiss_xml', 'tiss_xml_cd_origem_sigh_key')
    ) AS v(table_name, constraint_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = item.table_name
        AND information_schema.columns.column_name = 'cd_origem_sigh'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = item.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (cd_origem_sigh)',
        item.table_name,
        item.constraint_name
      );
    END IF;
  END LOOP;
END
$$;
