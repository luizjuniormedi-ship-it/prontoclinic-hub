import { supabase } from "@/lib/supabase";

export interface Module19VitalSigns {
  systolicBloodPressure?: number | null;
  diastolicBloodPressure?: number | null;
  heartRate?: number | null;
  respiratoryRate?: number | null;
  temperature?: number | null;
  oxygenSaturation?: number | null;
  bloodGlucose?: number | null;
  painScale?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  glasgowEye?: number | null;
  glasgowVerbal?: number | null;
  glasgowMotor?: number | null;
}

export interface Module19ClinicalPayload extends Module19VitalSigns {
  chiefComplaint: string;
  currentIllnessHistory?: string;
  currentMedications?: string;
  allergies?: string;
  nursingNotes?: string;
}

export interface Module19News2Payload {
  respiratoryRateScore: number;
  oxygenSaturationScore: number;
  temperatureScore: number;
  systolicBloodPressureScore: number;
  heartRateScore: number;
  consciousnessScore: number;
  risk: "BAIXO" | "MEDIO" | "ALTO";
}

export interface CompleteModule19TriageInput {
  unitId: number;
  patientId: number;
  appointmentId?: number | null;
  queueId?: number | null;
  classificationId: number;
  classificationReason: string;
  clinical: Module19ClinicalPayload;
  news2?: Module19News2Payload | null;
}

export interface ReclassifyModule19TriageInput {
  triageId: number;
  classificationId: number;
  reason: string;
}

export interface Module19TriageRecord {
  id: number;
  company_id: string;
  unit_id: number | null;
  triagem_fila_id: number | null;
  cd_paciente: number;
  cd_appointment: number | null;
  cd_classificacao_id: number | null;
  cd_usuario_enfermeiro: string | null;
  ds_queixa_principal: string | null;
  ds_observacoes_enfermagem: string | null;
  tp_status: string;
  dt_triagem: string;
  updated_at: string;
}

export interface Module19News2Record {
  id: number;
  company_id: string;
  unit_id: number | null;
  cd_triagem: number;
  cd_usuario_avaliador: string | null;
  nr_score_total: number;
  cd_classificacao_risco: string | null;
  dt_avaliacao: string;
}

export interface Module19ReclassificationRecord {
  id: number;
  company_id: string;
  unit_id: number;
  triagem_id: number;
  classificacao_anterior_id: number | null;
  classificacao_nova_id: number;
  motivo: string;
  tipo: "CLASSIFICACAO_INICIAL" | "RECLASSIFICACAO";
  ator_usuario_id: string;
  created_at: string;
}

export interface Module19Classification {
  id: number;
  company_id: string | null;
  ds_classificacao: string;
  cd_cor_hex: string;
  nr_tempo_max_atendimento_min: number;
  ds_descricao: string | null;
  lg_ativo: boolean;
}

export interface Module19CompleteResult {
  triage: Module19TriageRecord;
  news2: Module19News2Record | null;
  idempotent: boolean;
}

export interface Module19ReclassificationResult {
  triage: Module19TriageRecord;
  reclassification: Module19ReclassificationRecord;
}

export interface M20SignedPrescriptionReference {
  id: string | number;
  company_id: string;
  unit_id: number;
  patient_id: number;
  appointment_id?: number | null;
  status: string;
  signed_at: string | null;
  revoked_at?: string | null;
}

export interface M20PrescriptionConsumptionContext {
  companyId: string;
  unitId: number;
  patientId: number;
  appointmentId?: number | null;
}

interface SupabaseLikeError {
  message: string;
}

interface Module19DataClient {
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): unknown;
      order(column: string, options?: { ascending?: boolean }): unknown;
    };
  };
}

function requirePositiveInteger(value: number | null | undefined, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} deve ser um identificador positivo.`);
  }
  return Number(value);
}

function requireOptionalPositiveInteger(
  value: number | null | undefined,
  label: string,
): number | null {
  if (value == null) return null;
  return requirePositiveInteger(value, label);
}

function assertRange(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (value == null) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} deve estar entre ${minimum} e ${maximum}.`);
  }
}

function assertNews2Score(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error(`${label} NEWS2 deve estar entre 0 e 3.`);
  }
}

export function resolveModule19TriageRequest(
  input: CompleteModule19TriageInput,
): CompleteModule19TriageInput {
  const unitId = requirePositiveInteger(input.unitId, "Unidade");
  const patientId = requirePositiveInteger(input.patientId, "Paciente");
  const classificationId = requirePositiveInteger(input.classificationId, "Classificação");
  const appointmentId = requireOptionalPositiveInteger(input.appointmentId, "Agendamento");
  const queueId = requireOptionalPositiveInteger(input.queueId, "Senha da fila");
  const classificationReason = input.classificationReason.trim();
  const chiefComplaint = input.clinical.chiefComplaint.trim();

  if (classificationReason.length < 3) {
    throw new Error("Informe o motivo clínico da classificação.");
  }
  if (!chiefComplaint) {
    throw new Error("Informe a queixa principal.");
  }

  assertRange(input.clinical.systolicBloodPressure, 0, 300, "Pressão sistólica");
  assertRange(input.clinical.diastolicBloodPressure, 0, 200, "Pressão diastólica");
  assertRange(input.clinical.heartRate, 0, 250, "Frequência cardíaca");
  assertRange(input.clinical.respiratoryRate, 0, 80, "Frequência respiratória");
  assertRange(input.clinical.temperature, 20, 45, "Temperatura");
  assertRange(input.clinical.oxygenSaturation, 0, 100, "Saturação");
  assertRange(input.clinical.bloodGlucose, 0, 700, "Glicemia");
  assertRange(input.clinical.painScale, 0, 10, "Escala de dor");
  assertRange(input.clinical.weightKg, 0, 500, "Peso");
  assertRange(input.clinical.heightCm, 0, 250, "Altura");
  assertRange(input.clinical.glasgowEye, 1, 4, "Glasgow ocular");
  assertRange(input.clinical.glasgowVerbal, 1, 5, "Glasgow verbal");
  assertRange(input.clinical.glasgowMotor, 1, 6, "Glasgow motor");

  if (input.news2) {
    assertNews2Score(input.news2.respiratoryRateScore, "Frequência respiratória");
    assertNews2Score(input.news2.oxygenSaturationScore, "Saturação");
    assertNews2Score(input.news2.temperatureScore, "Temperatura");
    assertNews2Score(input.news2.systolicBloodPressureScore, "Pressão sistólica");
    assertNews2Score(input.news2.heartRateScore, "Frequência cardíaca");
    assertNews2Score(input.news2.consciousnessScore, "Consciência");
  }

  return {
    ...input,
    unitId,
    patientId,
    appointmentId,
    queueId,
    classificationId,
    classificationReason,
    clinical: {
      ...input.clinical,
      chiefComplaint,
      currentIllnessHistory: input.clinical.currentIllnessHistory?.trim(),
      currentMedications: input.clinical.currentMedications?.trim(),
      allergies: input.clinical.allergies?.trim(),
      nursingNotes: input.clinical.nursingNotes?.trim(),
    },
  };
}

export function assertM20PrescriptionConsumable(
  prescription: M20SignedPrescriptionReference,
  context: M20PrescriptionConsumptionContext,
): M20SignedPrescriptionReference {
  if (
    prescription.company_id !== context.companyId
    || prescription.unit_id !== context.unitId
    || prescription.patient_id !== context.patientId
  ) {
    throw new Error("Prescrição M20 fora do escopo do atendimento.");
  }
  if (
    (prescription.appointment_id ?? null)
    !== (context.appointmentId ?? null)
  ) {
    throw new Error("Prescrição M20 pertence a outro agendamento.");
  }
  if (!["ACTIVE", "SIGNED", "ATIVA", "ASSINADA"].includes(prescription.status.toUpperCase())) {
    throw new Error("Somente prescrição M20 ativa pode ser consumida.");
  }
  if (!prescription.signed_at || prescription.revoked_at) {
    throw new Error("A prescrição M20 precisa estar assinada e não revogada.");
  }
  return prescription;
}

function assertCompleteResult(data: unknown): Module19CompleteResult {
  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida ao concluir triagem.");
  }
  const result = data as Partial<Module19CompleteResult>;
  if (!result.triage || typeof result.triage.id !== "number") {
    throw new Error("Resposta de triagem sem registro persistido.");
  }
  return result as Module19CompleteResult;
}

function assertReclassificationResult(data: unknown): Module19ReclassificationResult {
  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida ao reclassificar triagem.");
  }
  const result = data as Partial<Module19ReclassificationResult>;
  if (
    !result.triage
    || typeof result.triage.id !== "number"
    || !result.reclassification
    || typeof result.reclassification.id !== "number"
  ) {
    throw new Error("Resposta de reclassificação sem histórico persistido.");
  }
  return result as Module19ReclassificationResult;
}

export function createModule19NursingService(
  client: Module19DataClient = supabase as unknown as Module19DataClient,
) {
  return {
    async completeTriage(input: CompleteModule19TriageInput): Promise<Module19CompleteResult> {
      const resolved = resolveModule19TriageRequest(input);
      const { data, error } = await client.rpc("m19_complete_triage_secure", {
        p_unit_id: resolved.unitId,
        p_patient_id: resolved.patientId,
        p_appointment_id: resolved.appointmentId ?? null,
        p_queue_id: resolved.queueId ?? null,
        p_classification_id: resolved.classificationId,
        p_classification_reason: resolved.classificationReason,
        p_payload: resolved.clinical,
        p_news2: resolved.news2 ?? null,
      });
      if (error) {
        throw new Error(`Erro ao concluir triagem: ${error.message}`);
      }
      return assertCompleteResult(data);
    },

    async reclassify(
      input: ReclassifyModule19TriageInput,
    ): Promise<Module19ReclassificationResult> {
      const triageId = requirePositiveInteger(input.triageId, "Triagem");
      const classificationId = requirePositiveInteger(input.classificationId, "Classificação");
      const reason = input.reason.trim();
      if (reason.length < 3) {
        throw new Error("Informe o motivo clínico da reclassificação.");
      }
      const { data, error } = await client.rpc("m19_reclassify_triage_secure", {
        p_triage_id: triageId,
        p_classification_id: classificationId,
        p_reason: reason,
      });
      if (error) {
        throw new Error(`Erro ao reclassificar triagem: ${error.message}`);
      }
      return assertReclassificationResult(data);
    },

    async listClassifications(): Promise<Module19Classification[]> {
      const query = client
        .from("mnct_classificacao_risco")
        .select("id, company_id, ds_classificacao, cd_cor_hex, nr_tempo_max_atendimento_min, ds_descricao, lg_ativo")
        .eq("lg_ativo", true) as {
          order(
            column: string,
            options?: { ascending?: boolean },
          ): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
        };
      const { data, error } = await query.order("nr_tempo_max_atendimento_min", {
        ascending: true,
      });
      if (error) {
        throw new Error(`Erro ao listar classificações: ${error.message}`);
      }
      return (Array.isArray(data) ? data : []) as Module19Classification[];
    },

    async listRecent(unitId: number, limit = 25): Promise<Module19TriageRecord[]> {
      const resolvedUnitId = requirePositiveInteger(unitId, "Unidade");
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const query = client
        .from("triagens")
        .select("*")
        .eq("unit_id", resolvedUnitId) as {
          order(
            column: string,
            options?: { ascending?: boolean },
          ): {
            limit(
              value: number,
            ): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
          };
        };
      const { data, error } = await query
        .order("dt_triagem", { ascending: false })
        .limit(safeLimit);
      if (error) {
        throw new Error(`Erro ao listar triagens: ${error.message}`);
      }
      return (Array.isArray(data) ? data : []) as Module19TriageRecord[];
    },

    async listReclassificationHistory(
      triageId: number,
    ): Promise<Module19ReclassificationRecord[]> {
      const resolvedTriageId = requirePositiveInteger(triageId, "Triagem");
      const query = client
        .from("triagem_reclassificacoes")
        .select("*")
        .eq("triagem_id", resolvedTriageId) as {
          order(
            column: string,
            options?: { ascending?: boolean },
          ): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
        };
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) {
        throw new Error(`Erro ao listar histórico: ${error.message}`);
      }
      return (Array.isArray(data) ? data : []) as Module19ReclassificationRecord[];
    },
  };
}

export const module19NursingService = createModule19NursingService();
