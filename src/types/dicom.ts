// ── DICOM/PACS Types ──────────────────────────────────

export type DicomNodeType = 'pacs' | 'modality' | 'ris' | 'worklist' | 'viewer';

export interface DicomNode {
  id: string;
  name: string;
  node_type: DicomNodeType;
  aetitle: string;
  ip_address?: string;
  port?: number;
  local_port?: number;
  description?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DicomModality {
  id: string;
  unit_id?: string;
  name: string;
  manufacturer?: string;
  model?: string;
  modality_type: string;
  aetitle: string;
  ip_address?: string;
  port?: number;
  worklist_enabled: boolean;
  pacs_node_id?: string;
  room_name?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  // joined
  unit_name?: string;
  pacs_node_name?: string;
}

export type ImagingOrderStatus =
  | 'agendado' | 'liberado_worklist' | 'em_aquisicao' | 'adquirido'
  | 'enviado_pacs' | 'recebido_pacs' | 'laudando' | 'laudado' | 'entregue' | 'cancelado';

export type ImagingPriority = 'normal' | 'urgent' | 'emergency';

export interface ImagingOrder {
  id: string;
  patient_id: string;
  encounter_id?: string;
  scheduling_id?: string;
  requesting_physician_id?: string;
  referring_physician_name?: string;
  clinical_indication?: string;
  priority: ImagingPriority;
  accession_number: string;
  status: ImagingOrderStatus;
  notes?: string;
  company_id?: string;
  unit_id?: string;
  created_at: string;
  updated_at: string;
  // joined
  patient_name?: string;
  physician_name?: string;
}

export interface ImagingOrderItem {
  id: string;
  imaging_order_id: string;
  exam_code?: string;
  exam_name: string;
  modality_type: string;
  body_part?: string;
  laterality?: 'left' | 'right' | 'bilateral' | 'na';
  contrast_required: boolean;
  station_aetitle?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  scheduled_datetime?: string;
  requested_procedure_id?: string;
  scheduled_procedure_step_id?: string;
  study_instance_uid?: string;
  status: ImagingOrderStatus;
  created_at: string;
  updated_at: string;
}

export type WorklistQueueStatus = 'pending' | 'exported' | 'acquired' | 'cancelled';

export interface DicomWorklistItem {
  id: string;
  imaging_order_item_id: string;
  patient_id: string;
  patient_name: string;
  patient_birth_date?: string;
  patient_sex?: string;
  patient_identifier?: string;
  accession_number: string;
  requested_procedure_description?: string;
  requested_procedure_id?: string;
  scheduled_procedure_step_id?: string;
  modality_type: string;
  scheduled_station_aetitle?: string;
  scheduled_station_name?: string;
  scheduled_datetime?: string;
  referring_physician_name?: string;
  status: WorklistQueueStatus;
  exported_to_worklist: boolean;
  export_state?: 'pending' | 'exporting' | 'exported' | 'failed';
  export_attempts?: number;
  last_export_error?: string;
  orthanc_worklist_id?: string;
  delete_state?: 'not_required' | 'pending' | 'deleting' | 'deleted' | 'failed';
  last_delete_error?: string;
  orthanc_deleted_at?: string;
  last_export_at?: string;
  created_at: string;
  updated_at: string;
}

export type PacsStudyStatus = 'pending' | 'received' | 'reported' | 'delivered';

export interface PacsStudy {
  id: string;
  patient_id: string;
  imaging_order_item_id?: string;
  study_instance_uid: string;
  accession_number?: string;
  study_date?: string;
  study_time?: string;
  modality_type?: string;
  station_aetitle?: string;
  pacs_status: PacsStudyStatus;
  received_at?: string;
  company_id?: string;
  unit_id?: string;
  created_at: string;
  updated_at: string;
  // joined
  patient_name?: string;
}

export type RadiologyReportStatus = 'draft' | 'preliminary' | 'final' | 'amended' | 'cancelled';

export interface RadiologyReport {
  id: string;
  patient_id: string;
  imaging_order_item_id?: string;
  pacs_study_id?: string;
  study_instance_uid?: string;
  report_text?: string;
  impression?: string;
  radiologist_id?: string;
  radiologist_name?: string;
  signed_at?: string;
  status: RadiologyReportStatus;
  company_id?: string;
  unit_id?: string;
  created_at: string;
  updated_at: string;
  // joined
  patient_name?: string;
}

// Status labels & colors for UI
export const imagingStatusLabels: Record<ImagingOrderStatus, string> = {
  agendado: 'Agendado',
  liberado_worklist: 'Liberado WL',
  em_aquisicao: 'Em Aquisição',
  adquirido: 'Adquirido',
  enviado_pacs: 'Enviado PACS',
  recebido_pacs: 'Recebido PACS',
  laudando: 'Laudando',
  laudado: 'Laudado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export const imagingStatusColors: Record<ImagingOrderStatus, string> = {
  agendado: 'bg-muted text-muted-foreground',
  liberado_worklist: 'bg-primary/10 text-primary',
  em_aquisicao: 'bg-warning/10 text-warning',
  adquirido: 'bg-accent text-accent-foreground',
  enviado_pacs: 'bg-primary/10 text-primary',
  recebido_pacs: 'bg-success/10 text-success',
  laudando: 'bg-warning/10 text-warning',
  laudado: 'bg-success/10 text-success',
  entregue: 'bg-muted text-muted-foreground',
  cancelado: 'bg-destructive/10 text-destructive',
};

export const priorityLabels: Record<ImagingPriority, string> = {
  normal: 'Normal',
  urgent: 'Urgente',
  emergency: 'Emergência',
};

export const priorityColors: Record<ImagingPriority, string> = {
  normal: 'bg-muted text-muted-foreground',
  urgent: 'bg-warning/10 text-warning',
  emergency: 'bg-destructive/10 text-destructive',
};
