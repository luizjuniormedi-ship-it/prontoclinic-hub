/**
 * Status transition validation for appointments and imaging orders.
 * Centralizes all business rules for status changes.
 */

import { AppointmentStatus } from '@/types';
import { ImagingOrderStatus, RadiologyReportStatus } from '@/types/dicom';

// ── Appointment status transitions ──

const appointmentTransitions: Record<string, string[]> = {
  scheduled: ['confirmed', 'waiting', 'cancelled', 'no_show'],
  confirmed: ['waiting', 'cancelled', 'no_show'],
  waiting: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [], // terminal
  no_show: ['scheduled'], // allow rescheduling
  cancelled: ['scheduled'], // allow rescheduling
};

export function canTransitionAppointment(from: string, to: string): boolean {
  const allowed = appointmentTransitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidAppointmentTransitions(status: string): string[] {
  return appointmentTransitions[status] || [];
}

export function canStartAppointment(status: string): boolean {
  return status === 'waiting';
}

// ── Imaging order status transitions ──

const imagingTransitions: Record<string, string[]> = {
  agendado: ['liberado_worklist', 'cancelado'],
  liberado_worklist: ['em_aquisicao', 'cancelado'],
  em_aquisicao: ['adquirido', 'cancelado'],
  adquirido: ['enviado_pacs', 'cancelado'],
  enviado_pacs: ['recebido_pacs', 'cancelado'],
  recebido_pacs: ['laudando', 'cancelado'],
  laudando: ['laudado', 'cancelado'],
  laudado: ['entregue'],
  entregue: [], // terminal
  cancelado: ['agendado'], // allow re-scheduling
};

export function canTransitionImaging(from: string, to: string): boolean {
  const allowed = imagingTransitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidImagingTransitions(status: string): string[] {
  return imagingTransitions[status] || [];
}

// ── Radiology report status transitions ──

const reportTransitions: Record<string, string[]> = {
  draft: ['preliminary', 'final', 'cancelled'],
  preliminary: ['final', 'cancelled'],
  final: ['amended'],
  amended: ['final'],
  cancelled: ['draft'],
};

export function canTransitionReport(from: string, to: string): boolean {
  const allowed = reportTransitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidReportTransitions(status: string): string[] {
  return reportTransitions[status] || [];
}

// ── Appointment status labels (PT-BR) ──

export const appointmentStatusLabels: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  waiting: 'Aguardando',
  in_progress: 'Em Atendimento',
  completed: 'Finalizado',
  no_show: 'Falta',
  cancelled: 'Cancelado',
};

// ── Billing status transitions ──

const billingTransitions: Record<string, string[]> = {
  em_aberto: ['faturado', 'cancelado'],
  faturado: ['glosa', 'cancelado'],
  glosa: ['em_aberto', 'cancelado'],
  cancelado: [],
};

export function canTransitionBilling(from: string, to: string): boolean {
  const allowed = billingTransitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
