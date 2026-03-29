import { supabase } from '@/lib/supabase';
import type {
  DicomNode, DicomModality, ImagingOrder, ImagingOrderItem,
  DicomWorklistItem, PacsStudy, RadiologyReport, ImagingOrderStatus,
} from '@/types/dicom';

// ── Helper ─────────────────────────────────────
function generateAccessionNumber(): string {
  const d = new Date();
  const prefix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ACC-${prefix}-${rand}`;
}

function generateUID(): string {
  const root = '1.2.826.0.1.3680043.8.1055';
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 99999);
  return `${root}.${ts}.${rand}`;
}

// ── DICOM Nodes ─────────────────────────────────
export const dicomNodesService = {
  async list() {
    const { data, error } = await supabase
      .from('dicom_nodes')
      .select('*')
      .order('name');
    if (error) throw error;
    return data as DicomNode[];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('dicom_nodes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as DicomNode;
  },

  async create(node: Partial<DicomNode>) {
    const { data, error } = await supabase
      .from('dicom_nodes')
      .insert(node)
      .select()
      .single();
    if (error) throw error;
    return data as DicomNode;
  },

  async update(id: string, updates: Partial<DicomNode>) {
    const { data, error } = await supabase
      .from('dicom_nodes')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as DicomNode;
  },
};

// ── DICOM Modalities ─────────────────────────────
export const dicomModalitiesService = {
  async list() {
    const { data, error } = await supabase
      .from('dicom_modalities')
      .select('*, units(name), dicom_nodes(name)')
      .order('name');
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      unit_name: d.units?.name,
      pacs_node_name: d.dicom_nodes?.name,
      units: undefined,
      dicom_nodes: undefined,
    })) as DicomModality[];
  },

  async create(mod: Partial<DicomModality>) {
    const { data, error } = await supabase
      .from('dicom_modalities')
      .insert(mod)
      .select()
      .single();
    if (error) throw error;
    return data as DicomModality;
  },

  async update(id: string, updates: Partial<DicomModality>) {
    const { data, error } = await supabase
      .from('dicom_modalities')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as DicomModality;
  },
};

// ── Imaging Orders ─────────────────────────────
export const imagingOrdersService = {
  async list(filters?: { status?: string; patient_id?: string; date?: string }) {
    let query = supabase
      .from('imaging_orders')
      .select('*, patients(full_name), professionals(full_name)')
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters?.patient_id) query = query.eq('patient_id', filters.patient_id);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      patient_name: d.patients?.full_name,
      physician_name: d.professionals?.full_name,
      patients: undefined,
      professionals: undefined,
    })) as ImagingOrder[];
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('imaging_orders')
      .select('*, patients(full_name), professionals(full_name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return {
      ...data,
      patient_name: data.patients?.full_name,
      physician_name: data.professionals?.full_name,
    } as ImagingOrder;
  },

  async create(order: Partial<ImagingOrder>) {
    const accession = generateAccessionNumber();
    const { data, error } = await supabase
      .from('imaging_orders')
      .insert({ ...order, accession_number: accession })
      .select()
      .single();
    if (error) throw error;
    return data as ImagingOrder;
  },

  async updateStatus(id: string, status: ImagingOrderStatus) {
    const { error } = await supabase
      .from('imaging_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── Imaging Order Items ────────────────────────
export const imagingOrderItemsService = {
  async listByOrder(orderId: string) {
    const { data, error } = await supabase
      .from('imaging_order_items')
      .select('*')
      .eq('imaging_order_id', orderId)
      .order('created_at');
    if (error) throw error;
    return data as ImagingOrderItem[];
  },

  async create(item: Partial<ImagingOrderItem>) {
    const procedureId = generateUID();
    const stepId = generateUID();
    const { data, error } = await supabase
      .from('imaging_order_items')
      .insert({
        ...item,
        requested_procedure_id: item.requested_procedure_id || procedureId,
        scheduled_procedure_step_id: item.scheduled_procedure_step_id || stepId,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ImagingOrderItem;
  },

  async updateStatus(id: string, status: ImagingOrderStatus) {
    const { error } = await supabase
      .from('imaging_order_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── Worklist Queue ──────────────────────────────
export const worklistQueueService = {
  async list(filters?: { status?: string; modality?: string }) {
    let query = supabase
      .from('dicom_worklist_queue')
      .select('*')
      .order('scheduled_datetime', { ascending: true });

    if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters?.modality && filters.modality !== 'all') query = query.eq('modality_type', filters.modality);

    const { data, error } = await query;
    if (error) throw error;
    return data as DicomWorklistItem[];
  },

  async createFromOrderItem(item: ImagingOrderItem, order: ImagingOrder, patient: { id: string; full_name: string; birth_date?: string; sex?: string; cpf?: string }) {
    const wlItem: Partial<DicomWorklistItem> = {
      imaging_order_item_id: item.id,
      patient_id: patient.id,
      patient_name: patient.full_name,
      patient_birth_date: patient.birth_date,
      patient_sex: patient.sex,
      patient_identifier: patient.cpf,
      accession_number: order.accession_number,
      requested_procedure_description: item.exam_name,
      requested_procedure_id: item.requested_procedure_id,
      scheduled_procedure_step_id: item.scheduled_procedure_step_id,
      modality_type: item.modality_type,
      scheduled_station_aetitle: item.station_aetitle,
      scheduled_datetime: item.scheduled_datetime,
      referring_physician_name: order.referring_physician_name,
      status: 'pending',
    };

    const { data, error } = await supabase
      .from('dicom_worklist_queue')
      .insert(wlItem)
      .select()
      .single();
    if (error) throw error;

    // Update item status
    await imagingOrderItemsService.updateStatus(item.id, 'liberado_worklist');

    return data as DicomWorklistItem;
  },

  async markExported(id: string) {
    const { error } = await supabase
      .from('dicom_worklist_queue')
      .update({ exported_to_worklist: true, last_export_at: new Date().toISOString(), status: 'exported', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async cancel(id: string) {
    const { error } = await supabase
      .from('dicom_worklist_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── PACS Studies ────────────────────────────────
export const pacsStudiesService = {
  async list(filters?: { status?: string; patient_id?: string }) {
    let query = supabase
      .from('pacs_studies')
      .select('*, patients(full_name)')
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') query = query.eq('pacs_status', filters.status);
    if (filters?.patient_id) query = query.eq('patient_id', filters.patient_id);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      patient_name: d.patients?.full_name,
      patients: undefined,
    })) as PacsStudy[];
  },

  async create(study: Partial<PacsStudy>) {
    const uid = study.study_instance_uid || generateUID();
    const { data, error } = await supabase
      .from('pacs_studies')
      .insert({ ...study, study_instance_uid: uid })
      .select()
      .single();
    if (error) throw error;
    return data as PacsStudy;
  },

  async updateStatus(id: string, status: PacsStudy['pacs_status']) {
    const { error } = await supabase
      .from('pacs_studies')
      .update({ pacs_status: status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── Radiology Reports ──────────────────────────
export const radiologyReportsService = {
  async list(filters?: { status?: string; patient_id?: string }) {
    let query = supabase
      .from('radiology_reports')
      .select('*, patients(full_name)')
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters?.patient_id) query = query.eq('patient_id', filters.patient_id);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      patient_name: d.patients?.full_name,
      patients: undefined,
    })) as RadiologyReport[];
  },

  async create(report: Partial<RadiologyReport>) {
    const { data, error } = await supabase
      .from('radiology_reports')
      .insert(report)
      .select()
      .single();
    if (error) throw error;
    return data as RadiologyReport;
  },

  async update(id: string, updates: Partial<RadiologyReport>) {
    const { data, error } = await supabase
      .from('radiology_reports')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as RadiologyReport;
  },

  async sign(id: string, radiologistName: string, radiologistId?: string) {
    const { error } = await supabase
      .from('radiology_reports')
      .update({
        status: 'final',
        signed_at: new Date().toISOString(),
        radiologist_name: radiologistName,
        radiologist_id: radiologistId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── Dashboard Stats ─────────────────────────────
export const dicomDashboardService = {
  async getStats() {
    const [modalities, worklist, orders, reports] = await Promise.all([
      supabase.from('dicom_modalities').select('id, active, worklist_enabled'),
      supabase.from('dicom_worklist_queue').select('id, status'),
      supabase.from('imaging_orders').select('id, status'),
      supabase.from('radiology_reports').select('id, status'),
    ]);

    const mods = modalities.data || [];
    const wl = worklist.data || [];
    const ord = orders.data || [];
    const rep = reports.data || [];

    return {
      totalModalities: mods.length,
      activeModalities: mods.filter((m: any) => m.active).length,
      worklistEnabled: mods.filter((m: any) => m.worklist_enabled).length,
      worklistPending: wl.filter((w: any) => w.status === 'pending').length,
      worklistExported: wl.filter((w: any) => w.status === 'exported').length,
      ordersInAcquisition: ord.filter((o: any) => o.status === 'em_aquisicao').length,
      ordersSentPacs: ord.filter((o: any) => o.status === 'enviado_pacs').length,
      pendingReports: rep.filter((r: any) => r.status === 'draft' || r.status === 'preliminary').length,
      completedReports: rep.filter((r: any) => r.status === 'final').length,
    };
  },
};
