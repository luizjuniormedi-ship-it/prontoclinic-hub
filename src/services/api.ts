/**
 * API Service Layer
 * Centralizes all API communication. Currently uses mock data.
 * Replace with real API calls when backend is ready.
 */

import { Patient, Appointment, Payment, MedicalRecord, DashboardStats } from "@/types";
import { mockPatients, mockAppointments, mockPayments, mockMedicalRecords, mockDashboardStats } from "./mockData";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const api = {
  // Dashboard
  async getDashboardStats(): Promise<DashboardStats> {
    await delay(500);
    return mockDashboardStats;
  },

  // Patients
  async getPatients(): Promise<Patient[]> {
    await delay(400);
    return mockPatients;
  },
  async getPatientById(id: string): Promise<Patient | undefined> {
    await delay(300);
    return mockPatients.find((p) => p.id === id);
  },

  // Appointments
  async getAppointments(date?: string): Promise<Appointment[]> {
    await delay(400);
    if (date) return mockAppointments.filter((a) => a.date === date);
    return mockAppointments;
  },

  // Payments
  async getPayments(): Promise<Payment[]> {
    await delay(400);
    return mockPayments;
  },

  // Medical Records
  async getMedicalRecords(patientId: string): Promise<MedicalRecord[]> {
    await delay(400);
    return mockMedicalRecords.filter((r) => r.patientId === patientId);
  },
};
