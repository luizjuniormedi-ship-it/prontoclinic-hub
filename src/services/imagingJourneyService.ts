import { supabase } from "@/lib/supabase";

export interface AttendanceImagingOrderInput {
  appointmentId: string;
  examName: string;
  modalityType: string;
  clinicalIndication?: string;
  priority?: "normal" | "urgent" | "emergency";
  scheduledDatetime?: string;
}

export interface AttendanceImagingOrderResult {
  order_id: string;
  item_id: string;
  accession_number: string;
}

export const imagingJourneyService = {
  async createFromAttendance(input: AttendanceImagingOrderInput): Promise<AttendanceImagingOrderResult> {
    if (!input.examName.trim()) throw new Error("Informe o exame de imagem solicitado.");
    const { data, error } = await supabase.rpc("create_imaging_order_from_attendance", {
      p_appointment_id: input.appointmentId,
      p_exam_name: input.examName.trim(),
      p_modality_type: input.modalityType,
      p_clinical_indication: input.clinicalIndication?.trim() || null,
      p_priority: input.priority || "normal",
      p_scheduled_datetime: input.scheduledDatetime || new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return data as AttendanceImagingOrderResult;
  },
};
