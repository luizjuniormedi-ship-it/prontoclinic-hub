import { supabase } from "@/lib/supabase";

export interface ClinicalTimelinePatient {
  id: number;
  full_name: string;
}

export interface ClinicalTimelineEvent {
  event_type: "atendimento";
  event_id: string;
  event_date: string;
  title: string;
  detail: string | null;
  professional: string | null;
  status: "signed" | "legacy_locked";
}

interface EncounterTimelineRow {
  id: string;
  encounter_type: string | null;
  status: "signed" | "legacy_locked";
  chief_complaint: string | null;
  summary: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const READABLE_STATUSES = ["signed", "legacy_locked"] as const;

function mapEncounterToEvent(row: EncounterTimelineRow): ClinicalTimelineEvent {
  return {
    event_type: "atendimento",
    event_id: row.id,
    event_date: row.signed_at || row.finished_at || row.started_at || row.created_at,
    title: row.chief_complaint || row.encounter_type || "Atendimento clínico",
    detail: row.summary,
    professional: row.signed_by_name,
    status: row.status,
  };
}

export const clinicalTimelineService = {
  async searchPatients(search: string): Promise<ClinicalTimelinePatient[]> {
    const term = search.trim();
    if (!term) return [];

    const { data, error } = await supabase
      .from("patients")
      .select("id, full_name")
      .ilike("full_name", `%${term}%`)
      .eq("lg_ativo", true)
      .limit(20);

    if (error) throw new Error(`Erro ao buscar pacientes: ${error.message}`);
    return (data || []) as ClinicalTimelinePatient[];
  },

  async getPatientTimeline(patientId: number): Promise<ClinicalTimelineEvent[]> {
    const { data, error } = await supabase
      .from("v_encounters_read_model")
      .select(
        "id, encounter_type, status, chief_complaint, summary, signed_by_name, signed_at, started_at, finished_at, created_at",
      )
      .eq("patient_id", patientId)
      .in("status", [...READABLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(`Erro ao carregar timeline clínica: ${error.message}`);

    const events = ((data || []) as EncounterTimelineRow[]).map(mapEncounterToEvent);

    try {
      const { error: auditError } = await supabase.rpc("log_data_access", {
        p_tabela: "v_encounters_read_model",
        p_registro_id: String(patientId),
        p_acao: "VIEW_CLINICAL_TIMELINE",
        p_contexto: {
          record_count: events.length,
          statuses: [...READABLE_STATUSES],
        },
      });
      if (auditError) {
        console.warn("[clinicalTimelineService] Falha ao registrar auditoria:", auditError.message);
      }
    } catch (auditError) {
      console.warn("[clinicalTimelineService] Exceção ao registrar auditoria:", auditError);
    }

    return events;
  },
};

