import { Patient, Appointment, Payment, MedicalRecord, DashboardStats, ReturnControl, TherapyPackage, Specialty, Doctor, AuditLog } from "@/types";

export const mockSpecialties: Specialty[] = [
  { id: "sp1", name: "Cardiologia" },
  { id: "sp2", name: "Dermatologia" },
  { id: "sp3", name: "Ortopedia" },
  { id: "sp4", name: "Fisioterapia" },
  { id: "sp5", name: "Psicologia" },
];

export const mockDoctors: Doctor[] = [
  { id: "d1", name: "Dr. Ricardo Mendes", specialtyId: "sp1", specialty: "Cardiologia" },
  { id: "d2", name: "Dra. Camila Ferreira", specialtyId: "sp2", specialty: "Dermatologia" },
  { id: "d3", name: "Dr. André Souza", specialtyId: "sp3", specialty: "Ortopedia" },
  { id: "d4", name: "Dra. Patrícia Lima", specialtyId: "sp4", specialty: "Fisioterapia" },
  { id: "d5", name: "Dr. Felipe Costa", specialtyId: "sp5", specialty: "Psicologia" },
];

export const mockPatients: Patient[] = [
  { id: "1", name: "Maria Silva Santos", cpf: "123.456.789-00", birthDate: "1985-03-15", phone: "(11) 98765-4321", email: "maria@email.com", gender: "F", healthInsurance: "Unimed", healthInsuranceNumber: "12345", bloodType: "O+", allergies: "Dipirona", address: "Rua das Flores, 123 - São Paulo/SP", createdAt: "2024-01-15", updatedAt: "2024-03-20" },
  { id: "2", name: "João Pedro Oliveira", cpf: "987.654.321-00", birthDate: "1990-07-22", phone: "(11) 91234-5678", email: "joao@email.com", gender: "M", healthInsurance: "Bradesco Saúde", healthInsuranceNumber: "67890", bloodType: "A+", address: "Av. Paulista, 1000 - São Paulo/SP", createdAt: "2024-02-10", updatedAt: "2024-03-18" },
  { id: "3", name: "Ana Beatriz Costa", cpf: "456.789.123-00", birthDate: "1978-11-05", phone: "(21) 99876-5432", email: "ana@email.com", gender: "F", healthInsurance: "SulAmérica", healthInsuranceNumber: "11223", bloodType: "B-", allergies: "Penicilina", address: "Rua Copacabana, 500 - Rio de Janeiro/RJ", createdAt: "2024-01-20", updatedAt: "2024-03-15" },
  { id: "4", name: "Carlos Eduardo Lima", cpf: "321.654.987-00", birthDate: "1995-01-30", phone: "(31) 98765-1234", email: "carlos@email.com", gender: "M", address: "Rua Bahia, 200 - Belo Horizonte/MG", createdAt: "2024-03-01", updatedAt: "2024-03-22" },
  { id: "5", name: "Fernanda Rodrigues", cpf: "654.321.987-00", birthDate: "1982-09-12", phone: "(41) 91234-9876", email: "fernanda@email.com", gender: "F", healthInsurance: "Amil", healthInsuranceNumber: "33456", bloodType: "AB+", address: "Rua XV de Novembro, 300 - Curitiba/PR", createdAt: "2024-02-28", updatedAt: "2024-03-19" },
];

export const mockAppointments: Appointment[] = [
  { id: "1", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", date: "2026-03-22", time: "08:00", duration: 30, status: "confirmed", type: "consulta", value: 350 },
  { id: "2", patientId: "2", patientName: "João Pedro Oliveira", patientCpf: "987.654.321-00", patientPhone: "(11) 91234-5678", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", date: "2026-03-22", time: "08:30", duration: 30, status: "scheduled", type: "retorno", returnOriginId: "prev1" },
  { id: "3", patientId: "3", patientName: "Ana Beatriz Costa", patientCpf: "456.789.123-00", patientPhone: "(21) 99876-5432", doctorId: "d2", doctorName: "Dra. Camila Ferreira", specialty: "Dermatologia", date: "2026-03-22", time: "09:00", duration: 45, status: "in_progress", type: "consulta", value: 450 },
  { id: "4", patientId: "4", patientName: "Carlos Eduardo Lima", patientCpf: "321.654.987-00", patientPhone: "(31) 98765-1234", doctorId: "d3", doctorName: "Dr. André Souza", specialty: "Ortopedia", date: "2026-03-22", time: "10:00", duration: 30, status: "scheduled", type: "exame", value: 150 },
  { id: "5", patientId: "5", patientName: "Fernanda Rodrigues", patientCpf: "654.321.987-00", patientPhone: "(41) 91234-9876", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", date: "2026-03-22", time: "10:30", duration: 30, status: "completed", type: "consulta", value: 350 },
  { id: "6", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d4", doctorName: "Dra. Patrícia Lima", specialty: "Fisioterapia", date: "2026-03-22", time: "11:00", duration: 50, status: "waiting", type: "terapia_pacote", therapyPackageId: "pkg1", therapyType: "Fisioterapia Motora", value: 0 },
  { id: "7", patientId: "3", patientName: "Ana Beatriz Costa", patientCpf: "456.789.123-00", patientPhone: "(21) 99876-5432", doctorId: "d4", doctorName: "Dra. Patrícia Lima", specialty: "Fisioterapia", date: "2026-03-22", time: "14:00", duration: 50, status: "scheduled", type: "terapia_avulsa", therapyType: "Acupuntura", value: 180 },
  { id: "8", patientId: "2", patientName: "João Pedro Oliveira", patientCpf: "987.654.321-00", patientPhone: "(11) 91234-5678", doctorId: "d3", doctorName: "Dr. André Souza", specialty: "Ortopedia", date: "2026-03-22", time: "15:00", duration: 60, status: "scheduled", type: "procedimento", value: 800 },
  { id: "9", patientId: "4", patientName: "Carlos Eduardo Lima", patientCpf: "321.654.987-00", patientPhone: "(31) 98765-1234", doctorId: "d5", doctorName: "Dr. Felipe Costa", specialty: "Psicologia", date: "2026-03-22", time: "16:00", duration: 50, status: "no_show", type: "consulta", value: 300 },
  { id: "10", patientId: "5", patientName: "Fernanda Rodrigues", patientCpf: "654.321.987-00", patientPhone: "(41) 91234-9876", doctorId: "d2", doctorName: "Dra. Camila Ferreira", specialty: "Dermatologia", date: "2026-03-23", time: "09:00", duration: 30, status: "scheduled", type: "retorno", returnOriginId: "prev2" },
  // Consulta completed 10 days ago for Maria in Cardiologia (for interval rule testing)
  { id: "prev-maria", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", date: "2026-03-12", time: "09:00", duration: 30, status: "completed", type: "consulta", value: 350 },
];

export const mockReturnControls: ReturnControl[] = [
  { id: "ret1", patientId: "2", patientName: "João Pedro Oliveira", originAppointmentId: "prev1", specialty: "Cardiologia", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", originDate: "2026-02-20", expiresAt: "2026-03-22", status: "active" },
  { id: "ret2", patientId: "5", patientName: "Fernanda Rodrigues", originAppointmentId: "prev2", specialty: "Dermatologia", doctorId: "d2", doctorName: "Dra. Camila Ferreira", originDate: "2026-03-10", expiresAt: "2026-04-09", status: "active" },
  { id: "ret3", patientId: "3", patientName: "Ana Beatriz Costa", originAppointmentId: "prev3", specialty: "Ortopedia", doctorId: "d3", doctorName: "Dr. André Souza", originDate: "2026-01-15", expiresAt: "2026-02-14", status: "expired" },
];

export const mockTherapyPackages: TherapyPackage[] = [
  {
    id: "pkg1", patientId: "1", patientName: "Maria Silva Santos", therapyType: "Fisioterapia Motora",
    totalSessions: 10, usedSessions: 4, remainingSessions: 6, value: 1500,
    startDate: "2026-02-01", expiresAt: "2026-05-01", status: "active",
    sessions: [
      { id: "s1", packageId: "pkg1", appointmentId: "past1", date: "2026-02-05", status: "completed" },
      { id: "s2", packageId: "pkg1", appointmentId: "past2", date: "2026-02-12", status: "completed" },
      { id: "s3", packageId: "pkg1", appointmentId: "past3", date: "2026-02-26", status: "completed" },
      { id: "s4", packageId: "pkg1", appointmentId: "past4", date: "2026-03-05", status: "completed" },
      { id: "s5", packageId: "pkg1", appointmentId: "6", date: "2026-03-22", status: "scheduled" },
    ],
  },
  {
    id: "pkg2", patientId: "4", patientName: "Carlos Eduardo Lima", therapyType: "Psicoterapia",
    totalSessions: 12, usedSessions: 12, remainingSessions: 0, value: 2400,
    startDate: "2025-10-01", expiresAt: "2026-04-01", status: "completed",
    sessions: [],
  },
];

export const mockAuditLogs: AuditLog[] = [];

export const mockPayments: Payment[] = [
  { id: "1", patientId: "1", patientName: "Maria Silva Santos", description: "Consulta - Dr. Ricardo Mendes", amount: 350, status: "paid", dueDate: "2026-03-15", paidAt: "2026-03-15", method: "Cartão de crédito" },
  { id: "2", patientId: "2", patientName: "João Pedro Oliveira", description: "Retorno - Dr. Ricardo Mendes", amount: 200, status: "pending", dueDate: "2026-03-25" },
  { id: "3", patientId: "3", patientName: "Ana Beatriz Costa", description: "Primeira consulta - Dra. Camila Ferreira", amount: 450, status: "overdue", dueDate: "2026-03-10" },
  { id: "4", patientId: "5", patientName: "Fernanda Rodrigues", description: "Consulta + Exames", amount: 780, status: "paid", dueDate: "2026-03-18", paidAt: "2026-03-17", method: "PIX" },
  { id: "5", patientId: "4", patientName: "Carlos Eduardo Lima", description: "Exame - Dra. Camila Ferreira", amount: 150, status: "pending", dueDate: "2026-03-28" },
];

export const mockMedicalRecords: MedicalRecord[] = [
  { id: "1", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-15", type: "anamnesis", content: "Paciente relata dores de cabeça frequentes nas últimas 2 semanas, principalmente ao final do dia. Nega febre ou outros sintomas associados. Histórico de enxaqueca na família." },
  { id: "2", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-15", type: "vital_signs", content: "Sinais vitais aferidos", vitalSigns: { bloodPressure: "120/80", heartRate: 72, temperature: 36.5, weight: 65, height: 165, oxygenSaturation: 98 } },
  { id: "3", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-20", type: "evolution", content: "Paciente retornou com melhora significativa após uso de medicação prescrita. Mantém acompanhamento mensal." },
];

export const mockDashboardStats: DashboardStats = {
  todayAppointments: 12,
  totalPatients: 847,
  monthlyRevenue: 45780,
  pendingPayments: 8,
};
