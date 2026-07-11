-- ProntoMedic - compatibilidade entre metadados TISS migrados e modulo operacional.
-- Nao remove nem renomeia colunas legadas; preserva tp_status e storage_path.

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS cd_fatura BIGINT,
  ADD COLUMN IF NOT EXISTS ds_descricao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ds_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dt_fatura DATE,
  ADD COLUMN IF NOT EXISTS ds_tipo_guia VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ds_protocolo VARCHAR(100),
  ADD COLUMN IF NOT EXISTS dt_recurso DATE,
  ADD COLUMN IF NOT EXISTS ds_recurso_xml TEXT,
  ADD COLUMN IF NOT EXISTS vl_informado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS bl_xml_enviado TEXT,
  ADD COLUMN IF NOT EXISTS bl_xml_retorno TEXT,
  ADD COLUMN IF NOT EXISTS bl_xml_recurso TEXT,
  ADD COLUMN IF NOT EXISTS ds_hash_envio VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ds_hash_retorno VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ds_versao_tiss VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tp_ambiente VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ds_motivo_rejeicao TEXT,
  ADD COLUMN IF NOT EXISTS lg_deletado BOOLEAN,
  ADD COLUMN IF NOT EXISTS dt_pagamento DATE,
  ADD COLUMN IF NOT EXISTS cd_user_envio UUID,
  ADD COLUMN IF NOT EXISTS cd_user_recebimento UUID;

UPDATE public.tiss_xml
SET
  dt_fatura = COALESCE(dt_fatura, dt_envio::date, created_at::date),
  ds_filename = COALESCE(ds_filename, NULLIF(regexp_replace(COALESCE(storage_path,''), '^.*/', ''), ''), 'tiss_' || id || '.xml'),
  ds_descricao = COALESCE(ds_descricao, ds_observacao),
  ds_protocolo = COALESCE(ds_protocolo, nr_protocolo),
  ds_versao_tiss = COALESCE(ds_versao_tiss, nr_versao_tiss, '3.05.00'),
  vl_informado = COALESCE(vl_informado, vl_total, 0),
  tp_ambiente = COALESCE(tp_ambiente, 'HOMOLOGACAO'),
  status = COALESCE(status, CASE lower(COALESCE(tp_status,''))
    WHEN 'glosado' THEN 'GLOSADO'
    WHEN 'em_recurso' THEN 'GLOSADO'
    WHEN 'enviado' THEN 'ENVIADO'
    WHEN 'processado' THEN 'PROCESSADO'
    WHEN 'recebido' THEN 'RECEBIDO'
    WHEN 'pago' THEN 'PAGO'
    WHEN 'cancelado' THEN 'CANCELADO'
    WHEN 'rejeitado' THEN 'REJEITADO'
    ELSE 'PENDENTE'
  END),
  lg_deletado = COALESCE(lg_deletado, NOT COALESCE(lg_ativo, TRUE)),
  ds_tipo_guia = COALESCE(ds_tipo_guia, 'AUXILIAR');

ALTER TABLE public.tiss_xml
  ALTER COLUMN status SET DEFAULT 'PENDENTE',
  ALTER COLUMN lg_deletado SET DEFAULT FALSE,
  ALTER COLUMN tp_ambiente SET DEFAULT 'HOMOLOGACAO',
  ALTER COLUMN ds_versao_tiss SET DEFAULT '3.05.00';

CREATE OR REPLACE FUNCTION public.sync_tiss_operational_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.dt_fatura := COALESCE(NEW.dt_fatura, NEW.dt_envio::date, CURRENT_DATE);
  NEW.vl_informado := COALESCE(NEW.vl_informado, NEW.vl_total, 0);
  NEW.vl_total := COALESCE(NEW.vl_total, NEW.vl_informado, 0);
  NEW.ds_protocolo := COALESCE(NEW.ds_protocolo, NEW.nr_protocolo);
  NEW.nr_protocolo := COALESCE(NEW.nr_protocolo, NEW.ds_protocolo);
  NEW.ds_versao_tiss := COALESCE(NEW.ds_versao_tiss, NEW.nr_versao_tiss, '3.05.00');
  NEW.nr_versao_tiss := COALESCE(NEW.nr_versao_tiss, NEW.ds_versao_tiss);
  NEW.status := COALESCE(NEW.status, CASE lower(COALESCE(NEW.tp_status,''))
    WHEN 'glosado' THEN 'GLOSADO'
    WHEN 'em_recurso' THEN 'GLOSADO'
    WHEN 'enviado' THEN 'ENVIADO'
    WHEN 'processado' THEN 'PROCESSADO'
    WHEN 'recebido' THEN 'RECEBIDO'
    WHEN 'pago' THEN 'PAGO'
    WHEN 'cancelado' THEN 'CANCELADO'
    WHEN 'rejeitado' THEN 'REJEITADO'
    ELSE 'PENDENTE'
  END);
  NEW.tp_status := COALESCE(NEW.tp_status, lower(NEW.status));
  NEW.lg_deletado := COALESCE(NEW.lg_deletado, NOT COALESCE(NEW.lg_ativo, TRUE));
  NEW.lg_ativo := COALESCE(NEW.lg_ativo, NOT NEW.lg_deletado);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tiss_operational_columns ON public.tiss_xml;
CREATE TRIGGER trg_sync_tiss_operational_columns
BEFORE INSERT OR UPDATE ON public.tiss_xml
FOR EACH ROW EXECUTE FUNCTION public.sync_tiss_operational_columns();

CREATE INDEX IF NOT EXISTS idx_tiss_xml_operational_status ON public.tiss_xml(company_id,status,dt_fatura DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_operational_month ON public.tiss_xml(company_id,dt_fatura DESC) WHERE lg_deletado IS FALSE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_prontomedic') THEN
    GRANT SELECT,INSERT,UPDATE ON public.tiss_xml TO app_prontomedic;
    GRANT EXECUTE ON FUNCTION public.sync_tiss_operational_columns() TO app_prontomedic;
  END IF;
END $$;

