import {
  Patient, Appointment, Payment, MedicalRecord, DashboardStats, ReturnControl,
  TherapyPackage, Specialty, Doctor, AuditLog, AuditFilters, Professional, Billing,
  Company, Unit, ConsultationType, ExamType, ProcedureType, TherapyService,
  HealthInsurancePlan, Room, AttendanceType, BillingProduction, ProfessionalPayment,
  CallCenterRecord, WorklistItem, PACSStudy
} from "@/types";
import {
  mockPatients, mockAppointments, mockPayments, mockMedicalRecords, mockDashboardStats,
  mockReturnControls, mockTherapyPackages, mockSpecialties, mockDoctors,
  mockProfessionals, mockBillings, mockCompanies, mockUnits, mockConsultationTypes,
  mockExamTypes, mockProcedureTypes, mockTherapyServices, mockInsurancePlans, mockRooms,
  mockAttendanceTypes, mockBillingProductions, mockProfessionalPayments,
  mockCallCenterRecords, mockWorklistItems, mockPACSStudies
} from "./mockData";
import { auditService } from "./auditService";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const api = {
  async getDashboardStats(): Promise<DashboardStats> { await delay(500); return mockDashboardStats; },

  // Companies & Units
  async getCompanies(): Promise<Company[]> { await delay(300); return mockCompanies; },
  async getUnits(companyId?: string): Promise<Unit[]> { await delay(300); if (companyId) return mockUnits.filter((u) => u.companyId === companyId); return mockUnits; },

  // Patients
  async getPatients(): Promise<Patient[]> { await delay(400); return mockPatients; },
  async getPatientById(id: string): Promise<Patient | undefined> { await delay(300); return mockPatients.find((p) => p.id === id); },

  // Appointments
  async getAppointments(date?: string): Promise<Appointment[]> { await delay(400); if (date) return mockAppointments.filter((a) => a.date === date); return mockAppointments; },

  // Payments (legacy)
  async getPayments(): Promise<Payment[]> { await delay(400); return mockPayments; },

  // Billings
  async getBillings(): Promise<Billing[]> { await delay(400); return mockBillings; },

  // Billing Production
  async getBillingProductions(): Promise<BillingProduction[]> { await delay(400); return mockBillingProductions; },

  // Professional Payments
  async getProfessionalPayments(professionalId?: string): Promise<ProfessionalPayment[]> {
    await delay(400);
    if (professionalId) return mockProfessionalPayments.filter((p) => p.professionalId === professionalId);
    return mockProfessionalPayments;
  },

  // Medical Records
  async getMedicalRecords(patientId: string): Promise<MedicalRecord[]> { await delay(400); return mockMedicalRecords.filter((r) => r.patientId === patientId); },

  // Master Registries
  async getSpecialties(): Promise<Specialty[]> { await delay(200); return mockSpecialties; },
  async getDoctors(): Promise<Doctor[]> { await delay(200); return mockDoctors; },
  async getConsultationTypes(): Promise<ConsultationType[]> { await delay(200); return mockConsultationTypes; },
  async getExamTypes(): Promise<ExamType[]> { await delay(200); return mockExamTypes; },
  async getProcedureTypes(): Promise<ProcedureType[]> { await delay(200); return mockProcedureTypes; },
  async getTherapyServices(): Promise<TherapyService[]> { await delay(200); return mockTherapyServices; },
  async getInsurancePlans(): Promise<HealthInsurancePlan[]> { await delay(200); return mockInsurancePlans; },
  async getRooms(): Promise<Room[]> { await delay(200); return mockRooms; },
  async getAttendanceTypes(): Promise<AttendanceType[]> { await delay(200); return mockAttendanceTypes; },

  // Professionals
  async getProfessionals(): Promise<Professional[]> { await delay(400); return mockProfessionals; },
  async getProfessionalById(id: string): Promise<Professional | undefined> { await delay(300); return mockProfessionals.find((p) => p.id === id); },

  // Call Center
  async getCallCenterRecords(): Promise<CallCenterRecord[]> { await delay(400); return mockCallCenterRecords; },

  // Worklist
  async getWorklistItems(): Promise<WorklistItem[]> { await delay(400); return mockWorklistItems; },

  // PACS
  async getPACSStudies(): Promise<PACSStudy[]> { await delay(400); return mockPACSStudies; },

  // Return Controls
  async getReturnControls(patientId?: string): Promise<ReturnControl[]> { await delay(300); if (patientId) return mockReturnControls.filter((r) => r.patientId === patientId); return mockReturnControls; },

  // Therapy Packages
  async getTherapyPackages(patientId?: string): Promise<TherapyPackage[]> { await delay(300); if (patientId) return mockTherapyPackages.filter((p) => p.patientId === patientId); return mockTherapyPackages; },

  // Audit Logs — agora delega ao auditService (Supabase real, migration 20260101000007)
  async getAuditLogs(filters?: AuditFilters): Promise<AuditLog[]> {
    return auditService.getAll(filters);
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
      return { blocked: true, lastDate, daysPassed, availableDate: available.toISOString().split("T")[0] };
    }
    return { blocked: false };
  },

  async checkActiveReturns(patientId: string): Promise<ReturnControl[]> {
    await delay(200);
    const today = new Date().toISOString().split("T")[0];
    return mockReturnControls.filter((r) => r.patientId === patientId && r.status === "active" && r.expiresAt >= today);
  },
};
