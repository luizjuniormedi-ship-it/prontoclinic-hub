/**
 * nursingCareService — Enfermagem Fase 1 (assistencial)
 *
 * Complementa o nursingService (triagem/NEWS2/fila) com:
 * administração de medicamento (checagem beira-leito), procedimentos,
 * intercorrências (alerta automático ao médico via trigger) e passagem de plantão.
 */
import { supabase } from "@/lib/supabase";

interface NursingActorContext {
  professionalId: number | null;
  unitId: number;
}

async function currentNursingActor(): Promise<NursingActorContext> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const userId = authData.user?.id;
  if (!userId) throw new Error("Sessao autenticada obrigatoria");

  const [professionalResult, profileResult] = await Promise.all([
    supabase
      .from("professionals")
      .select("id")
      .eq("user_id", userId)
      .eq("lg_ativo", true)
      .maybeSingle(),
    supabase
      .from("user_profiles")
      .select("primary_unit_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (professionalResult.error) throw new Error(professionalResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);

  const unitId = Number(profileResult.data?.primary_unit_id);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throw new Error("Unidade principal obrigatoria para operacoes de enfermagem");
  }

  return {
    professionalId: professionalResult.data?.id == null
      ? null
      : Number(professionalResult.data.id),
    unitId,
  };
}

export type MedAdminStatus = "pendente" | "em_preparo" | "administrado" | "recusado" | "suspenso" | "atrasado" | "cancelado";

export interface MedAdmin {
  id: number; patient_id: number; medication: string; dose: string | null; via: string | null;
  scheduled_at: string | null; administered_at: string | null; status: MedAdminStatus;
  bedside_check_ok: boolean; refusal_reason: string | null; patient_name?: string;
}
export interface NursingIncident {
  id: number; patient_id: number; incident_type: string; severity: string;
  description: string; medico_notificado: boolean; created_at: string; patient_name?: string;
}
export interface NursingProcedure { id: number; patient_id: number; procedure_type: string; description: string | null; performed_at: string; faturavel: boolean; }

async function withNames<T extends { patient_id: number }>(rows: T[]): Promise<(T & { patient_name?: string })[]> {
  const pids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
  const byId: Record<string, string> = {};
  if (pids.length > 0) {
    const { data } = await supabase.from("patients").select("id, full_name").in("id", pids);
    for (const p of (data || []) as Array<{ id: number; full_name: string }>) byId[String(p.id)] = p.full_name;
  }
  return rows.map((r) => ({ ...r, patient_name: byId[String(r.patient_id)] }));
}

export const nursingCareService = {
  async medications(status?: string): Promise<MedAdmin[]> {
    let q = supabase.from("nursing_medication_administrations").select("*").order("id", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return withNames((data || []) as unknown as MedAdmin[]);
  },
  async createMedication(m: { patient_id: number; medication: string; dose?: string; via?: string; scheduled_at?: string }): Promise<MedAdmin> {
    const actor = await currentNursingActor();
    const { data, error } = await supabase.from("nursing_medication_administrations").insert({
      ...m,
      status: "em_preparo",
      prepared_by: actor.professionalId,
      unit_id: actor.unitId,
    }).select().single();
    if (error) throw new Error(error.message);
    return data as unknown as MedAdmin;
  },
  async bedsideCheck(adminId: number, patientId: number): Promise<Array<{ certo: string; ok: boolean }>> {
    const { data, error } = await supabase.rpc("bedside_check", { p_admin_id: adminId, p_patient_confirmado: patientId });
    if (error) throw new Error(error.message);
    const raw = data as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => {
      if (typeof x === "object" && x !== null) return x as { certo: string; ok: boolean };
      const s = String(x).replace(/^\(|\)$/g, "").split(",");
      return { certo: s[0], ok: s[1] === "t" || s[1] === "true" };
    });
  },
  async administer(adminId: number): Promise<void> {
    const actor = await currentNursingActor();
    const { error } = await supabase.from("nursing_medication_administrations").update({
      status: "administrado", bedside_check_ok: true, administered_at: new Date().toISOString(), administered_by: actor.professionalId,
    }).eq("id", adminId);
    if (error) throw new Error(error.message);
  },
  async refuse(adminId: number, reason: string): Promise<void> {
    const { error } = await supabase.from("nursing_medication_administrations").update({ status: "recusado", refusal_reason: reason }).eq("id", adminId);
    if (error) throw new Error(error.message);
  },

  async incidents(): Promise<NursingIncident[]> {
    const { data, error } = await supabase.from("nursing_incidents").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return withNames((data || []) as unknown as NursingIncident[]);
  },
  async createIncident(i: { patient_id: number; incident_type: string; severity: string; description: string }): Promise<NursingIncident> {
    const actor = await currentNursingActor();
    const { data, error } = await supabase.from("nursing_incidents").insert({
      reported_by: actor.professionalId,
      unit_id: actor.unitId,
      ...i,
    }).select().single();
    if (error) throw new Error(error.message);
    return data as unknown as NursingIncident;
  },

  async procedures(): Promise<NursingProcedure[]> {
    const { data, error } = await supabase.from("nursing_procedures").select("*").order("performed_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as NursingProcedure[];
  },
  async createProcedure(p: { patient_id: number; procedure_type: string; description?: string; faturavel?: boolean }): Promise<void> {
    const actor = await currentNursingActor();
    const { error } = await supabase.from("nursing_procedures").insert({
      performed_by: actor.professionalId,
      unit_id: actor.unitId,
      ...p,
    });
    if (error) throw new Error(error.message);
  },

  async createHandoff(h: Record<string, unknown>): Promise<void> {
    const actor = await currentNursingActor();
    const { error } = await supabase.from("nursing_shift_handoffs").insert({
      ...h,
      unit_id: actor.unitId,
    });
    if (error) throw new Error(error.message);
  },

  async stats(): Promise<{ medPendentes: number; medAdministradas: number; incidentesGraves: number; procedimentos: number }> {
    const [meds, incs, procs] = await Promise.all([this.medications(), this.incidents(), this.procedures()]);
    return {
      medPendentes: meds.filter((m) => ["pendente", "em_preparo"].includes(m.status)).length,
      medAdministradas: meds.filter((m) => m.status === "administrado").length,
      incidentesGraves: incs.filter((i) => ["grave", "critica"].includes(i.severity)).length,
      procedimentos: procs.length,
    };
  },
};
