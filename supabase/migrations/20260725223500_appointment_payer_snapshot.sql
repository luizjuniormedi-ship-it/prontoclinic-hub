-- Preserva a matrícula/carteirinha apresentada no momento do agendamento.
-- O nome legado ds_matricula é mantido para compatibilidade com integrações e
-- migrations existentes; novos fluxos devem tratá-lo como snapshot imutável do
-- pagador, sem substituir o cadastro mestre do paciente.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ds_matricula VARCHAR(120);

COMMENT ON COLUMN public.appointments.ds_matricula IS
  'Snapshot da matrícula/carteirinha utilizada no agendamento e na geração da guia.';
