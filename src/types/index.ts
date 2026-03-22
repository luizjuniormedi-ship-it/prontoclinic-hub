export type UserRole = "admin" | "reception" | "doctor" | "nursing" | "financial";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

// ── Multi-tenant ──────────────────────────────────
export type CompanyStatus = "active" | "inactive";
export interface Company {
  id: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  phone: string;
  email: string;
  status: CompanyStatus;
  createdAt: string;
}

export type UnitType = "matriz" | "filial" | "ambulatorio" | "laboratorio";
export type UnitStatus = "active" | "inactive";
export interface Unit {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  code: string;
  cnpj?: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  type: UnitType;
  status: UnitStatus;
}

// ── Patient ──────────────────────────────────
export interface Patient {
  id: string;
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  email: string;
  gender: "M" | "F" | "O";
  address?: string;
  healthInsurance?: string;
  healthInsuranceNumber?: string;
  bloodType?: string;
  allergies?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  guardian?: string;
  adminNotes?: string;
  clinicalNotes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Professional ──────────────────────────────────
export type ProfessionalStatus = "active" | "inactive";
export type RemunerationType = "fixed" | "package" | "ch";

export interface Professional {
  id: string;
  name: string;
  category: string;
  specialties: string[];
  council: string;
  councilNumber: string;
  cpf: string;
  phone: string;
  email: string;
  companyId?: string;
  unitIds?: string[];
  status: ProfessionalStatus;
  agendaColor: string;
  defaultDuration: number;
  remunerationType?: RemunerationType;
  notes?: string;
}

// ── Master Registries ──────────────────────────────────
export interface Specialty {
  id: string;
  name: string;
  code?: string;
  status?: "active" | "inactive";
  notes?: string;
}

export interface ConsultationType {
  id: string;
  name: string;
  specialtyId: string;
  specialtyName: string;
  defaultDuration: number;
  particularPrice: number;
  acceptedInsurances: string[];
  status: "active" | "inactive";
  notes?: string;
}

export interface ExamType {
  id: string;
  name: string;
  category: string;
  specialtyId?: string;
  specialtyName?: string;
  defaultDuration: number;
  particularPrice: number;
  acceptedInsurances: string[];
  requiresPrep: boolean;
  prepInstructions?: string;
  defaultPriority: "normal" | "urgent" | "emergency";
  status: "active" | "inactive";
  notes?: string;
}

export interface ProcedureType {
  id: string;
  name: string;
  specialtyId?: string;
  specialtyName?: string;
  defaultDuration: number;
  particularPrice: number;
  acceptedInsurances: string[];
  requiresAuthorization: boolean;
  status: "active" | "inactive";
  notes?: string;
}

export interface TherapyService {
  id: string;
  name: string;
  type: string;
  defaultDuration: number;
  particularPrice: number;
  allowsPackage: boolean;
  status: "active" | "inactive";
  notes?: string;
}

export interface HealthInsurancePlan {
  id: string;
  name: string;
  code: string;
  type: string;
  status: "active" | "inactive";
  notes?: string;
}

export interface Room {
  id: string;
  name: string;
  type: "consultorio" | "sala_exame" | "sala_procedimento" | "sala_terapia" | "recepcao";
  unitId: string;
  unitName: string;
  status: "active" | "inactive";
  notes?: string;
}

export interface AttendanceType {
  id: string;
  name: string;
  category: "consulta" | "retorno" | "exame" | "procedimento" | "terapia";
  defaultDuration: number;
  status: "active" | "inactive";
}

// ── Appointments ──────────────────────────────────
export type AppointmentType = "consulta" | "retorno" | "exame" | "procedimento" | "terapia_avulsa" | "terapia_pacote";
export type AppointmentStatus = "scheduled" | "confirmed" | "waiting" | "in_progress" | "completed" | "no_show" | "cancelled";

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientCpf?: string;
  patientPhone?: string;
  doctorId: string;
  doctorName: string;
  specialty?: string;
  unitId?: string;
  unitName?: string;
  date: string;
  time: string;
  duration: number;
  status: AppointmentStatus;
  type: AppointmentType;
  typeLabel?: string;
  notes?: string;
  returnOriginId?: string;
  therapyPackageId?: string;
  therapyType?: string;
  value?: number;
  overrideInterval?: boolean;
  overrideReason?: string;
  overrideBy?: string;
  overrideAt?: string;
}

// ── Financial ──────────────────────────────────
export type PaymentStatus = "paid" | "pending" | "overdue" | "cancelled";
export type BillingType = "particular" | "convenio" | "retorno" | "terapia_avulsa" | "terapia_pacote";
export type PaymentMethod = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "transferencia" | "convenio";

export interface Billing {
  id: string;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  professionalId: string;
  professionalName: string;
  unitId?: string;
  unitName?: string;
  billingType: BillingType;
  appointmentType: AppointmentType;
  grossAmount: number;
  discount: number;
  finalAmount: number;
  paymentMethod?: PaymentMethod;
  status: PaymentStatus;
  dueDate: string;
  paidAt?: string;
  notes?: string;
  description: string;
}

// Keep legacy Payment for backwards compat
export interface Payment {
  id: string;
  patientId: string;
  patientName: string;
  description: string;
  amount: number;
  status: "paid" | "pending" | "overdue";
  dueDate: string;
  paidAt?: string;
  method?: string;
}

// ── Billing Production (Faturamento) ──────────────────────────────────
export type BillingProductionStatus = "em_aberto" | "faturado" | "cancelado" | "glosa";

export interface BillingProduction {
  id: string;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  professionalId: string;
  professionalName: string;
  unitId?: string;
  unitName?: string;
  billingType: BillingType;
  appointmentType: AppointmentType;
  insuranceName?: string;
  grossAmount: number;
  discount: number;
  finalAmount: number;
  status: BillingProductionStatus;
  description: string;
  notes?: string;
  createdAt: string;
}

// ── Professional Payment / Repasse ──────────────────────────────────
export type ProfessionalPaymentStatus = "apurado" | "conferido" | "pago" | "cancelado";

export interface ProfessionalPayment {
  id: string;
  professionalId: string;
  professionalName: string;
  unitId?: string;
  unitName?: string;
  period: string; // e.g. "2026-03"
  remunerationType: RemunerationType;
  referenceDescription: string;
  quantity: number;
  unitValue: number;
  chQuantity?: number;
  chValue?: number;
  totalValue: number;
  status: ProfessionalPaymentStatus;
  notes?: string;
  createdAt: string;
}

// ── Medical Records ──────────────────────────────────
export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  unitId?: string;
  unitName?: string;
  date: string;
  type: "anamnesis" | "evolution" | "vital_signs" | "attachment";
  content: string;
  vitalSigns?: {
    bloodPressure?: string;
    heartRate?: number;
    temperature?: number;
    weight?: number;
    height?: number;
    oxygenSaturation?: number;
  };
}

// ── Return Control ──────────────────────────────────
export type ReturnStatus = "active" | "used" | "expired" | "cancelled";

export interface ReturnControl {
  id: string;
  patientId: string;
  patientName: string;
  originAppointmentId: string;
  specialty: string;
  doctorId: string;
  doctorName: string;
  originDate: string;
  expiresAt: string;
  status: ReturnStatus;
  usedAppointmentId?: string;
}

// ── Therapy Packages ──────────────────────────────────
export type TherapyPackageStatus = "active" | "completed" | "expired" | "cancelled";

export interface TherapyPackage {
  id: string;
  patientId: string;
  patientName: string;
  therapyType: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  value: number;
  startDate: string;
  expiresAt: string;
  status: TherapyPackageStatus;
  sessions: TherapySession[];
}

export interface TherapySession {
  id: string;
  packageId: string;
  appointmentId?: string;
  date: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
}

// ── Call Center ──────────────────────────────────
export type CallCenterContactStatus = "agendado" | "confirmado" | "cancelado" | "remarcado" | "nao_atendeu" | "recado";

export interface CallCenterRecord {
  id: string;
  patientId?: string;
  patientName: string;
  cpf?: string;
  phone: string;
  birthDate?: string;
  insuranceName?: string;
  insuranceNumber?: string;
  appointmentId?: string;
  unitId?: string;
  unitName?: string;
  specialtyName?: string;
  professionalName?: string;
  appointmentType?: AppointmentType;
  contactStatus: CallCenterContactStatus;
  operatorId?: string;
  operatorName: string;
  notes?: string;
  createdAt: string;
}

// ── Worklist ──────────────────────────────────
export type WorklistStatus = "solicitado" | "agendado" | "aguardando" | "em_execucao" | "concluido" | "cancelado" | "enviado_pacs" | "laudado";
export type WorklistPriority = "normal" | "urgent" | "emergency";

export interface WorklistItem {
  id: string;
  patientId: string;
  patientName: string;
  examName: string;
  modality: string;
  requestingDoctorId: string;
  requestingDoctorName: string;
  unitId?: string;
  unitName?: string;
  date: string;
  time?: string;
  priority: WorklistPriority;
  status: WorklistStatus;
  notes?: string;
  createdAt: string;
}

// ── PACS ──────────────────────────────────
export type PACSStatus = "pending" | "received" | "reported" | "delivered";

export interface PACSStudy {
  id: string;
  patientId: string;
  patientName: string;
  worklistItemId?: string;
  examName: string;
  modality: string;
  requestingDoctorId: string;
  requestingDoctorName: string;
  unitId?: string;
  unitName?: string;
  priority: WorklistPriority;
  accessionNumber: string;
  studyInstanceUID: string;
  pacsStatus: PACSStatus;
  externalLink?: string;
  reportId?: string;
  reportSummary?: string;
  studyDate: string;
}

// ── Dashboard ──────────────────────────────────
export interface DashboardStats {
  todayAppointments: number;
  totalPatients: number;
  monthlyRevenue: number;
  pendingPayments: number;
  pendingWorklist?: number;
  productionByUnit?: { unitName: string; count: number }[];
}

// ── Audit ──────────────────────────────────
export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// Keep legacy Doctor for backwards compat - maps to Professional
export interface Doctor {
  id: string;
  name: string;
  specialtyId: string;
  specialty: string;
}
