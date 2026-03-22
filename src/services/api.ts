import { Patient, Appointment, Payment, MedicalRecord, DashboardStats, ReturnControl, TherapyPackage, Specialty, Doctor, AuditLog } from "@/types";
import { mockPatients, mockAppointments, mockPayments, mockMedicalRecords, mockDashboardStats, mockReturnControls, mockTherapyPackages, mockSpecialties, mockDoctors, mockAuditLogs } from "./mockData";

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

  // Specialties & Doctors
  async getSpecialties(): Promise<Specialty[]> {
    await delay(200);
    return mockSpecialties;
  },
  async getDoctors(): Promise<Doctor[]> {
    await delay(200);
    return mockDoctors;
  },

  // Return Controls
  async getReturnControls(patientId?: string): Promise<ReturnControl[]> {
    await delay(300);
    if (patientId) return mockReturnControls.filter((r) => r.patientId === patientId);
    return mockReturnControls;
  },

  // Therapy Packages
  async getTherapyPackages(patientId?: string): Promise<TherapyPackage[]> {
    await delay(300);
    if (patientId) return mockTherapyPackages.filter((p) => p.patientId === patientId);
    return mockTherapyPackages;
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLog[]> {
    await delay(300);
    return mockAuditLogs;
  },

  // Check 30-day interval rule
  async checkConsultaInterval(patientId: string, specialty: string): Promise<{ blocked: boolean; lastDate?: string; daysPassed?: number; availableDate?: string }> {
    await delay(200);
    const completedConsultas = mockAppointments.filter(
      (a) => a.patientId === patientId && a.specialty === specialty && a.type === "consulta" && a.status === "completed"
    ).sort((a, b) => b.date.localeCompare(a.date));

    if (completedConsultas.length === 0) return { blocked: false };

    const lastDate = completedConsultas[0].date;
    const today = new Date().toISOString().split("T")[0];
    const last = new Date(lastDate + "T00:00:00");
    const now = new Date(today + "T00:00:00");
    const daysPassed = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPassed < 30) {
      const available = new Date(last);
      available.setDate(available.getDate() + 30);
      return {
        blocked: true,
        lastDate,
        daysPassed,
        availableDate: available.toISOString().split("T")[0],
      };
    }
    return { blocked: false };
  },

  // Check active returns for patient
  async checkActiveReturns(patientId: string): Promise<ReturnControl[]> {
    await delay(200);
    const today = new Date().toISOString().split("T")[0];
    return mockReturnControls.filter(
      (r) => r.patientId === patientId && r.status === "active" && r.expiresAt >= today
    );
  },
};
