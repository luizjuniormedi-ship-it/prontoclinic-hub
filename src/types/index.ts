export type UserRole = "admin" | "reception" | "doctor" | "nursing" | "financial";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

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
  createdAt: string;
  updatedAt: string;
}

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

export type PaymentStatus = "paid" | "pending" | "overdue";

export interface Payment {
  id: string;
  patientId: string;
  patientName: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  dueDate: string;
  paidAt?: string;
  method?: string;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
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

export interface DashboardStats {
  todayAppointments: number;
  totalPatients: number;
  monthlyRevenue: number;
  pendingPayments: number;
}

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

export interface Specialty {
  id: string;
  name: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialtyId: string;
  specialty: string;
}
