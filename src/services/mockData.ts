import { Patient, Appointment, Payment, MedicalRecord, DashboardStats } from "@/types";

export const mockPatients: Patient[] = [
  { id: "1", name: "Maria Silva Santos", cpf: "123.456.789-00", birthDate: "1985-03-15", phone: "(11) 98765-4321", email: "maria@email.com", gender: "F", healthInsurance: "Unimed", healthInsuranceNumber: "12345", bloodType: "O+", allergies: "Dipirona", address: "Rua das Flores, 123 - São Paulo/SP", createdAt: "2024-01-15", updatedAt: "2024-03-20" },
  { id: "2", name: "João Pedro Oliveira", cpf: "987.654.321-00", birthDate: "1990-07-22", phone: "(11) 91234-5678", email: "joao@email.com", gender: "M", healthInsurance: "Bradesco Saúde", healthInsuranceNumber: "67890", bloodType: "A+", address: "Av. Paulista, 1000 - São Paulo/SP", createdAt: "2024-02-10", updatedAt: "2024-03-18" },
  { id: "3", name: "Ana Beatriz Costa", cpf: "456.789.123-00", birthDate: "1978-11-05", phone: "(21) 99876-5432", email: "ana@email.com", gender: "F", healthInsurance: "SulAmérica", healthInsuranceNumber: "11223", bloodType: "B-", allergies: "Penicilina", address: "Rua Copacabana, 500 - Rio de Janeiro/RJ", createdAt: "2024-01-20", updatedAt: "2024-03-15" },
  { id: "4", name: "Carlos Eduardo Lima", cpf: "321.654.987-00", birthDate: "1995-01-30", phone: "(31) 98765-1234", email: "carlos@email.com", gender: "M", address: "Rua Bahia, 200 - Belo Horizonte/MG", createdAt: "2024-03-01", updatedAt: "2024-03-22" },
  { id: "5", name: "Fernanda Rodrigues", cpf: "654.321.987-00", birthDate: "1982-09-12", phone: "(41) 91234-9876", email: "fernanda@email.com", gender: "F", healthInsurance: "Amil", healthInsuranceNumber: "33456", bloodType: "AB+", address: "Rua XV de Novembro, 300 - Curitiba/PR", createdAt: "2024-02-28", updatedAt: "2024-03-19" },
];

export const mockAppointments: Appointment[] = [
  { id: "1", patientId: "1", patientName: "Maria Silva Santos", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-22", time: "08:00", duration: 30, status: "confirmed", type: "Consulta de rotina" },
  { id: "2", patientId: "2", patientName: "João Pedro Oliveira", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-22", time: "08:30", duration: 30, status: "scheduled", type: "Retorno" },
  { id: "3", patientId: "3", patientName: "Ana Beatriz Costa", doctorId: "d2", doctorName: "Dra. Camila Ferreira", date: "2026-03-22", time: "09:00", duration: 45, status: "in_progress", type: "Primeira consulta" },
  { id: "4", patientId: "4", patientName: "Carlos Eduardo Lima", doctorId: "d2", doctorName: "Dra. Camila Ferreira", date: "2026-03-22", time: "10:00", duration: 30, status: "scheduled", type: "Exame" },
  { id: "5", patientId: "5", patientName: "Fernanda Rodrigues", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", date: "2026-03-22", time: "10:30", duration: 30, status: "completed", type: "Retorno" },
  { id: "6", patientId: "1", patientName: "Maria Silva Santos", doctorId: "d2", doctorName: "Dra. Camila Ferreira", date: "2026-03-23", time: "14:00", duration: 30, status: "scheduled", type: "Retorno" },
];

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
