/**
 * DICOM Integration Service
 * 
 * Provides the contract layer for communication with external PACS/Worklist servers.
 * Designed for integration with Orthanc or any DICOM-compliant server.
 * 
 * Architecture:
 *   ProntoMedic Web App  <-->  Edge Function / Local Bridge  <-->  Orthanc (PACS + MWL SCP)
 *                                                                      |
 *                                                              DICOM Modalities (CT, MR, CR...)
 * 
 * This service does NOT implement DICOM protocol directly.
 * It prepares data in DICOM-compatible format and provides hooks for:
 *   1. Exporting worklist items to Orthanc REST API
 *   2. Receiving study notifications from Orthanc via webhooks
 *   3. Querying PACS for studies via QIDO-RS / DICOMweb
 *   4. Linking received studies back to imaging orders
 */

import { supabase } from '@/lib/supabase';
import type { DicomWorklistItem, ImagingOrderItem, ImagingOrder, ImagingOrderStatus, PacsStudy } from '@/types/dicom';
import { imagingOrderItemsService, worklistQueueService } from './dicomService';

// ── Orthanc REST API contract ──────────────────────────
// These interfaces define the data contract for Orthanc integration.
// The actual HTTP calls would go through an Edge Function or local bridge service.

export interface OrthancConfig {
  Name: string;
  DicomAet: string;
  DicomPort: number;
  HttpPort: number;
  Worklists: {
    Enable: boolean;
    Database: string;
  };
  DicomModalities: {
    [aet: string]: [string, string, number] | string;
  };
  RegisteredUsers: Record<string, string>;
  StableStudyTimeout: number;
  LuaScripts: string[];
  [key: string]: unknown;
}

export interface OrthancStats {
  [key: string]: unknown;
}

export interface OrthancWorklistEntry {
  // Mapped from DICOM Worklist tags
  '0008,0050': string;  // AccessionNumber
  '0008,0060': string;  // Modality
  '0008,0090': string;  // ReferringPhysicianName
  '0010,0010': string;  // PatientName (DICOM format: Last^First)
  '0010,0020': string;  // PatientID
  '0010,0030': string;  // PatientBirthDate (YYYYMMDD)
  '0010,0040': string;  // PatientSex (M/F/O)
  '0020,000D'?: string; // StudyInstanceUID
  '0032,1060': string;  // RequestedProcedureDescription
  '0040,0100': {        // ScheduledProcedureStepSequence
    '0008,0060': string;  // Modality
    '0040,0001': string;  // ScheduledStationAETitle
    '0040,0002': string;  // ScheduledProcedureStepStartDate (YYYYMMDD)
    '0040,0003': string;  // ScheduledProcedureStepStartTime (HHMMSS)
    '0040,0007': string;  // ScheduledProcedureStepDescription
    '0040,0009': string;  // ScheduledProcedureStepID
  };
  '0040,1001': string;  // RequestedProcedureID
}

export interface OrthancStudyNotification {
  ID: string;
  Path: string;
  PatientID: string;
  StudyInstanceUID: string;
  AccessionNumber?: string;
  StudyDate?: string;
  StudyTime?: string;
  Modality?: string;
  StationName?: string;
}

export interface DICOMwebStudy {
  '00080020'?: { Value: string[] }; // StudyDate
  '00080030'?: { Value: string[] }; // StudyTime
  '00080050'?: { Value: string[] }; // AccessionNumber
  '00080060'?: { Value: string[] }; // Modality
  '0020000D'?: { Value: string[] }; // StudyInstanceUID
  '00100010'?: { Value: { Alphabetic: string }[] }; // PatientName
  '00100020'?: { Value: string[] }; // PatientID
}

// ── Format converters ─────────────────────────────────

function formatDicomDate(dateStr?: string): string {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '').substring(0, 8);
}

function formatDicomTime(timeStr?: string): string {
  if (!timeStr) return '';
  return timeStr.replace(/:/g, '').substring(0, 6);
}

function formatDicomName(name: string): string {
  // Convert "João Silva" to DICOM format "SILVA^JOAO"
  // Remove diacritics to ensure compatibility with modalities that
  // don't support UTF-8 in DICOM PN VR (most do, but some legacy ones don't)
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const parts = normalized.trim().split(/\s+/);
  if (parts.length <= 1) return normalized.toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const first = parts.slice(0, -1).join(' ').toUpperCase();
  return `${last}^${first}`;
}

function parseDicomDate(dicomDate: string): string | undefined {
  if (!dicomDate || dicomDate.length < 8) return undefined;
  return `${dicomDate.substring(0, 4)}-${dicomDate.substring(4, 6)}-${dicomDate.substring(6, 8)}`;
}

// ── Integration Service ──────────────────────────────

export const dicomIntegrationService = {
  /**
   * Convert a worklist queue item to Orthanc-compatible worklist entry.
   * This is the data that would be sent to Orthanc's REST API to create
   * a worklist file, or exposed via MWL SCP for modalities to query.
   */
  formatWorklistForOrthanc(item: DicomWorklistItem): OrthancWorklistEntry {
    const dt = item.scheduled_datetime ? new Date(item.scheduled_datetime) : new Date();
    const dateStr = formatDicomDate(dt.toISOString().split('T')[0]);
    const timeStr = formatDicomTime(dt.toTimeString().substring(0, 8));

    return {
      '0008,0050': item.accession_number,
      '0008,0060': item.modality_type,
      '0008,0090': item.referring_physician_name || '',
      '0010,0010': formatDicomName(item.patient_name),
      '0010,0020': item.patient_identifier || item.patient_id,
      '0010,0030': formatDicomDate(item.patient_birth_date),
      '0010,0040': (item.patient_sex || 'O').charAt(0).toUpperCase(),
      '0032,1060': item.requested_procedure_description || '',
      '0040,0100': {
        '0008,0060': item.modality_type,
        '0040,0001': item.scheduled_station_aetitle || 'ANY',
        '0040,0002': dateStr,
        '0040,0003': timeStr,
        '0040,0007': item.requested_procedure_description || '',
        '0040,0009': item.scheduled_procedure_step_id || '',
      },
      '0040,1001': item.requested_procedure_id || '',
    };
  },

  /**
   * Batch export all pending worklist items formatted for Orthanc.
   * Returns the formatted entries and marks them as exported.
   */
  async exportPendingWorklist(): Promise<{ exported: OrthancWorklistEntry[]; count: number }> {
    const items = await worklistQueueService.list({ status: 'pending' });

    const entries = items.map((item) => this.formatWorklistForOrthanc(item));

    // Mark all as exported
    for (const item of items) {
      await worklistQueueService.markExported(item.id);
    }

    return { exported: entries, count: entries.length };
  },

  /**
   * Handle incoming study notification from Orthanc (or PACS webhook).
   * Links the received study to the imaging order via accession_number.
   * 
   * Flow:
   *   1. Match by accession_number or StudyInstanceUID
   *   2. Create pacs_studies record
   *   3. Update imaging_order_item status to recebido_pacs
   *   4. Update worklist_queue status to acquired
   *   5. Create draft radiology_report
   */
  async handleStudyReceived(notification: OrthancStudyNotification): Promise<PacsStudy | null> {
    // 1. Find matching worklist item by accession
    const accession = notification.AccessionNumber;
    if (!accession) return null;

    const { data: wlItems } = await supabase
      .from('dicom_worklist_queue')
      .select('*, imaging_order_items(*, imaging_orders(*))')
      .eq('accession_number', accession)
      .limit(1);

    const wlItem = wlItems?.[0];
    if (!wlItem) return null;

    // 2. Create pacs_study
    const { data: study, error } = await supabase
      .from('pacs_studies')
      .insert({
        patient_id: wlItem.patient_id,
        imaging_order_item_id: wlItem.imaging_order_item_id,
        study_instance_uid: notification.StudyInstanceUID,
        accession_number: accession,
        study_date: parseDicomDate(notification.StudyDate || ''),
        study_time: notification.StudyTime,
        modality_type: notification.Modality || wlItem.modality_type,
        station_aetitle: notification.StationName,
        pacs_status: 'received',
        received_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // 3. Update item status
    await imagingOrderItemsService.updateStatus(wlItem.imaging_order_item_id, 'recebido_pacs' as ImagingOrderStatus);

    // 4. Update worklist queue
    await supabase
      .from('dicom_worklist_queue')
      .update({ status: 'acquired', updated_at: new Date().toISOString() })
      .eq('id', wlItem.id);

    // 5. Create draft report
    await supabase.from('radiology_reports').insert({
      patient_id: wlItem.patient_id,
      imaging_order_item_id: wlItem.imaging_order_item_id,
      pacs_study_id: study.id,
      study_instance_uid: notification.StudyInstanceUID,
      status: 'draft',
    });

    return study as PacsStudy;
  },

  /**
   * Cancel an imaging order and cascade to all related items.
   * Removes items from worklist and marks everything as cancelled.
   */
  async cancelOrder(orderId: string): Promise<void> {
    // Get all items
    const items = await imagingOrderItemsService.listByOrder(orderId);

    for (const item of items) {
      // Cancel worklist entries
      const { data: wlItems } = await supabase
        .from('dicom_worklist_queue')
        .select('id')
        .eq('imaging_order_item_id', item.id)
        .neq('status', 'cancelled');

      for (const wl of wlItems || []) {
        await worklistQueueService.cancel(wl.id);
      }

      // Cancel item
      await imagingOrderItemsService.updateStatus(item.id, 'cancelado' as ImagingOrderStatus);
    }

    // Cancel order
    await supabase
      .from('imaging_orders')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', orderId);
  },

  /**
   * Propagate the highest-progressed item status to the parent order.
   * Used after individual items change status.
   */
  async syncOrderStatus(orderId: string): Promise<void> {
    const items = await imagingOrderItemsService.listByOrder(orderId);
    if (items.length === 0) return;

    const statusPriority: Record<string, number> = {
      cancelado: 0, agendado: 1, liberado_worklist: 2, em_aquisicao: 3,
      adquirido: 4, enviado_pacs: 5, recebido_pacs: 6, laudando: 7,
      laudado: 8, entregue: 9,
    };

    // Use the highest-progressed non-cancelled item status
    const activeItems = items.filter(i => i.status !== 'cancelado');
    if (activeItems.length === 0) {
      // All cancelled
      await supabase.from('imaging_orders').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', orderId);
      return;
    }

    // Find the minimum (least progressed) - the order status represents the bottleneck
    const minStatus = activeItems.reduce((min, item) =>
      (statusPriority[item.status] || 0) < (statusPriority[min.status] || 0) ? item : min
    );

    await supabase
      .from('imaging_orders')
      .update({ status: minStatus.status, updated_at: new Date().toISOString() })
      .eq('id', orderId);
  },

  /**
   * Generate the Orthanc configuration snippet for connecting to this system.
   * This is informational — helps the admin set up Orthanc correctly.
   */
  getOrthancConfigTemplate(pacsNodeAeTitle: string, worlistScpPort: number): OrthancConfig {
    return {
      Name: 'ProntoMedic PACS',
      DicomAet: pacsNodeAeTitle,
      DicomPort: 4242,
      HttpPort: 8042,
      Worklists: {
        Enable: true,
        Database: '/var/lib/orthanc/worklists',
      },
      DicomModalities: {
        comment: 'Add modalities here as [AETitle, IP, Port]',
      },
      RegisteredUsers: {
        prontomedic: 'change-this-password',
      },
      StableStudyTimeout: 10,
      LuaScripts: ['/etc/orthanc/on-stable-study.lua'],
      comment_lua: 'The Lua script should POST to ProntoMedic webhook on stable study',
    };
  },
};
