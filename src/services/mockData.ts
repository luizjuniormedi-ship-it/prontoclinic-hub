import {
  Patient, Appointment, Payment, MedicalRecord, DashboardStats, ReturnControl,
  TherapyPackage, Specialty, Doctor, AuditLog, Professional, Billing,
  Company, Unit, ConsultationType, ExamType, ProcedureType, TherapyService,
  HealthInsurancePlan, Room, AttendanceType, BillingProduction, ProfessionalPayment,
  CallCenterRecord, WorklistItem, PACSStudy
} from "@/types";

// ── Companies & Units ──────────────────────────────────
export const mockCompanies: Company[] = [
  { id: "c1", legalName: "ProntoMedic Serviços Médicos Ltda", tradeName: "ProntoMedic", cnpj: "12.345.678/0001-00", stateRegistration: "123.456.789.000", municipalRegistration: "9876543", phone: "(11) 3000-0001", email: "contato@prontomedic.com", status: "active", createdAt: "2025-01-01" },
  { id: "c2", legalName: "ProntoMedic Diagnósticos S.A.", tradeName: "ProntoMedic Imagem", cnpj: "12.345.678/0002-81", phone: "(11) 3000-0002", email: "imagem@prontomedic.com", status: "active", createdAt: "2025-06-01" },
];

export const mockUnits: Unit[] = [
  { id: "u1", companyId: "c1", companyName: "ProntoMedic", name: "Unidade Centro", code: "UC01", cnpj: "12.345.678/0001-00", address: "Av. Paulista, 1000", city: "São Paulo", state: "SP", phone: "(11) 3000-1001", email: "centro@prontomedic.com", type: "matriz", status: "active" },
  { id: "u2", companyId: "c1", companyName: "ProntoMedic", name: "Unidade Sul", code: "US02", cnpj: "12.345.678/0003-62", address: "Rua Vergueiro, 500", city: "São Paulo", state: "SP", phone: "(11) 3000-1002", email: "sul@prontomedic.com", type: "filial", status: "active" },
  { id: "u3", companyId: "c2", companyName: "ProntoMedic Imagem", name: "Centro de Imagem", code: "CI01", address: "Rua Augusta, 200", city: "São Paulo", state: "SP", phone: "(11) 3000-2001", email: "ci@prontomedic.com", type: "laboratorio", status: "active" },
];

// ── Master Registries ──────────────────────────────────
export const mockSpecialties: Specialty[] = [
  { id: "sp1", name: "Cardiologia", code: "CARD", status: "active" },
  { id: "sp2", name: "Dermatologia", code: "DERM", status: "active" },
  { id: "sp3", name: "Ortopedia", code: "ORTO", status: "active" },
  { id: "sp4", name: "Fisioterapia", code: "FISIO", status: "active" },
  { id: "sp5", name: "Psicologia", code: "PSI", status: "active" },
  { id: "sp6", name: "Clínica Geral", code: "CG", status: "active" },
  { id: "sp7", name: "Radiologia", code: "RAD", status: "active" },
];

export const mockConsultationTypes: ConsultationType[] = [
  { id: "ct1", name: "Consulta Cardiológica", specialtyId: "sp1", specialtyName: "Cardiologia", defaultDuration: 30, particularPrice: 350, acceptedInsurances: ["Unimed", "Bradesco Saúde"], status: "active" },
  { id: "ct2", name: "Consulta Dermatológica", specialtyId: "sp2", specialtyName: "Dermatologia", defaultDuration: 30, particularPrice: 450, acceptedInsurances: ["Unimed", "SulAmérica"], status: "active" },
  { id: "ct3", name: "Consulta Ortopédica", specialtyId: "sp3", specialtyName: "Ortopedia", defaultDuration: 30, particularPrice: 400, acceptedInsurances: ["Unimed", "Amil"], status: "active" },
];

export const mockExamTypes: ExamType[] = [
  { id: "ex1", name: "Eletrocardiograma", category: "Cardiologia", specialtyId: "sp1", specialtyName: "Cardiologia", defaultDuration: 20, particularPrice: 150, acceptedInsurances: ["Unimed", "Bradesco Saúde"], requiresPrep: false, defaultPriority: "normal", status: "active" },
  { id: "ex2", name: "Raio-X Tórax", category: "Radiologia", specialtyId: "sp7", specialtyName: "Radiologia", defaultDuration: 15, particularPrice: 120, acceptedInsurances: ["Unimed", "SulAmérica", "Amil"], requiresPrep: false, defaultPriority: "normal", status: "active" },
  { id: "ex3", name: "Ressonância Magnética Joelho", category: "Radiologia", specialtyId: "sp7", specialtyName: "Radiologia", defaultDuration: 45, particularPrice: 800, acceptedInsurances: ["Unimed"], requiresPrep: true, prepInstructions: "Remover objetos metálicos. Jejum de 4h se com contraste.", defaultPriority: "normal", status: "active" },
  { id: "ex4", name: "Ultrassom Abdômen", category: "Radiologia", specialtyId: "sp7", specialtyName: "Radiologia", defaultDuration: 30, particularPrice: 250, acceptedInsurances: ["Unimed", "Bradesco Saúde", "SulAmérica"], requiresPrep: true, prepInstructions: "Jejum de 8 horas.", defaultPriority: "normal", status: "active" },
];

export const mockProcedureTypes: ProcedureType[] = [
  { id: "pr1", name: "Infiltração Articular", specialtyId: "sp3", specialtyName: "Ortopedia", defaultDuration: 30, particularPrice: 500, acceptedInsurances: ["Unimed"], requiresAuthorization: false, status: "active" },
  { id: "pr2", name: "Biópsia de Pele", specialtyId: "sp2", specialtyName: "Dermatologia", defaultDuration: 45, particularPrice: 600, acceptedInsurances: ["Unimed", "SulAmérica"], requiresAuthorization: true, status: "active" },
];

export const mockTherapyServices: TherapyService[] = [
  { id: "ts1", name: "Fisioterapia Motora", type: "Fisioterapia", defaultDuration: 50, particularPrice: 150, allowsPackage: true, status: "active" },
  { id: "ts2", name: "Acupuntura", type: "Fisioterapia", defaultDuration: 50, particularPrice: 180, allowsPackage: true, status: "active" },
  { id: "ts3", name: "Psicoterapia", type: "Psicologia", defaultDuration: 50, particularPrice: 200, allowsPackage: true, status: "active" },
];

export const mockInsurancePlans: HealthInsurancePlan[] = [
  { id: "ins1", name: "Unimed", code: "UNI001", type: "Cooperativa", status: "active" },
  { id: "ins2", name: "Bradesco Saúde", code: "BRAD01", type: "Seguradora", status: "active" },
  { id: "ins3", name: "SulAmérica", code: "SUL001", type: "Seguradora", status: "active" },
  { id: "ins4", name: "Amil", code: "AMI001", type: "Operadora", status: "active" },
];

export const mockRooms: Room[] = [
  { id: "r1", name: "Consultório 01", type: "consultorio", unitId: "u1", unitName: "Unidade Centro", status: "active" },
  { id: "r2", name: "Consultório 02", type: "consultorio", unitId: "u1", unitName: "Unidade Centro", status: "active" },
  { id: "r3", name: "Sala de Exames", type: "sala_exame", unitId: "u1", unitName: "Unidade Centro", status: "active" },
  { id: "r4", name: "Sala de Fisioterapia", type: "sala_terapia", unitId: "u1", unitName: "Unidade Centro", status: "active" },
  { id: "r5", name: "Sala RM", type: "sala_exame", unitId: "u3", unitName: "Centro de Imagem", status: "active" },
];

export const mockAttendanceTypes: AttendanceType[] = [
  { id: "at1", name: "Consulta", category: "consulta", defaultDuration: 30, status: "active" },
  { id: "at2", name: "Retorno", category: "retorno", defaultDuration: 20, status: "active" },
  { id: "at3", name: "Exame", category: "exame", defaultDuration: 30, status: "active" },
  { id: "at4", name: "Procedimento", category: "procedimento", defaultDuration: 60, status: "active" },
  { id: "at5", name: "Terapia", category: "terapia", defaultDuration: 50, status: "active" },
];

// ── Professionals ──────────────────────────────────
export const mockProfessionals: Professional[] = [
  { id: "d1", name: "Dr. Ricardo Mendes", category: "Médico", specialties: ["Cardiologia"], council: "CRM", councilNumber: "12345-SP", cpf: "111.222.333-44", phone: "(11) 99999-0001", email: "ricardo@prontomedic.com", companyId: "c1", unitIds: ["u1", "u2"], status: "active", agendaColor: "#2563EB", defaultDuration: 30, remunerationType: "fixed", notes: "Atende seg a sex, 8h às 18h" },
  { id: "d2", name: "Dra. Camila Ferreira", category: "Médica", specialties: ["Dermatologia"], council: "CRM", councilNumber: "67890-SP", cpf: "222.333.444-55", phone: "(11) 99999-0002", email: "camila@prontomedic.com", companyId: "c1", unitIds: ["u1"], status: "active", agendaColor: "#7C3AED", defaultDuration: 30, remunerationType: "ch" },
  { id: "d3", name: "Dr. André Souza", category: "Médico", specialties: ["Ortopedia"], council: "CRM", councilNumber: "11223-SP", cpf: "333.444.555-66", phone: "(11) 99999-0003", email: "andre@prontomedic.com", companyId: "c1", unitIds: ["u1", "u2"], status: "active", agendaColor: "#059669", defaultDuration: 30, remunerationType: "fixed" },
  { id: "d4", name: "Dra. Patrícia Lima", category: "Fisioterapeuta", specialties: ["Fisioterapia"], council: "CREFITO", councilNumber: "44556-3", cpf: "444.555.666-77", phone: "(11) 99999-0004", email: "patricia@prontomedic.com", companyId: "c1", unitIds: ["u1"], status: "active", agendaColor: "#D97706", defaultDuration: 50, remunerationType: "package" },
  { id: "d5", name: "Dr. Felipe Costa", category: "Psicólogo", specialties: ["Psicologia"], council: "CRP", councilNumber: "06/78901", cpf: "555.666.777-88", phone: "(11) 99999-0005", email: "felipe@prontomedic.com", companyId: "c1", unitIds: ["u1"], status: "active", agendaColor: "#DC2626", defaultDuration: 50, remunerationType: "fixed" },
  { id: "d6", name: "Dra. Marina Alves", category: "Médica", specialties: ["Clínica Geral", "Cardiologia"], council: "CRM", councilNumber: "33445-RJ", cpf: "666.777.888-99", phone: "(21) 99999-0006", email: "marina@prontomedic.com", companyId: "c1", unitIds: ["u2"], status: "inactive", agendaColor: "#6366F1", defaultDuration: 30, notes: "Afastada desde jan/2026" },
];

// Legacy doctors derived from professionals
export const mockDoctors: Doctor[] = mockProfessionals
  .filter((p) => p.status === "active")
  .map((p) => ({
    id: p.id,
    name: p.name,
    specialtyId: mockSpecialties.find((s) => p.specialties.includes(s.name))?.id || "",
    specialty: p.specialties[0] || "",
  }));

// ── Patients ──────────────────────────────────
export const mockPatients: Patient[] = [
  { id: "1", name: "Maria Silva Santos", cpf: "123.456.789-00", birthDate: "1985-03-15", phone: "(11) 98765-4321", email: "maria@email.com", gender: "F", healthInsurance: "Unimed", healthInsuranceNumber: "12345", allergies: "Dipirona", clinicalAlerts: "Alergia a Dipirona", createdAt: "2024-01-15", updatedAt: "2024-03-20" },
  { id: "2", name: "João Pedro Oliveira", cpf: "987.654.321-00", birthDate: "1990-07-22", phone: "(11) 91234-5678", email: "joao@email.com", gender: "M", healthInsurance: "Bradesco Saúde", healthInsuranceNumber: "67890", createdAt: "2024-02-10", updatedAt: "2024-03-18" },
  { id: "3", name: "Ana Beatriz Costa", cpf: "456.789.123-00", birthDate: "1978-11-05", phone: "(21) 99876-5432", email: "ana@email.com", gender: "F", healthInsurance: "SulAmérica", healthInsuranceNumber: "11223", allergies: "Penicilina", clinicalAlerts: "Alergia a Penicilina", createdAt: "2024-01-20", updatedAt: "2024-03-15" },
  { id: "4", name: "Carlos Eduardo Lima", cpf: "321.654.987-00", birthDate: "1995-01-30", phone: "(31) 98765-1234", email: "carlos@email.com", gender: "M", createdAt: "2024-03-01", updatedAt: "2024-03-22" },
  { id: "5", name: "Fernanda Rodrigues", cpf: "654.321.987-00", birthDate: "1982-09-12", phone: "(41) 91234-9876", email: "fernanda@email.com", gender: "F", healthInsurance: "Amil", healthInsuranceNumber: "33456", createdAt: "2024-02-28", updatedAt: "2024-03-19" },
];

// ── Appointments ──────────────────────────────────
export const mockAppointments: Appointment[] = [
  { id: "1", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "08:00", duration: 30, status: "confirmed", type: "consulta", value: 350 },
  { id: "2", patientId: "2", patientName: "João Pedro Oliveira", patientCpf: "987.654.321-00", patientPhone: "(11) 91234-5678", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "08:30", duration: 20, status: "scheduled", type: "retorno", returnOriginId: "prev1" },
  { id: "3", patientId: "3", patientName: "Ana Beatriz Costa", patientCpf: "456.789.123-00", patientPhone: "(21) 99876-5432", doctorId: "d2", doctorName: "Dra. Camila Ferreira", specialty: "Dermatologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "09:00", duration: 45, status: "in_progress", type: "consulta", value: 450 },
  { id: "4", patientId: "4", patientName: "Carlos Eduardo Lima", patientCpf: "321.654.987-00", patientPhone: "(31) 98765-1234", doctorId: "d3", doctorName: "Dr. André Souza", specialty: "Ortopedia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "10:00", duration: 30, status: "scheduled", type: "exame", value: 150 },
  { id: "5", patientId: "5", patientName: "Fernanda Rodrigues", patientCpf: "654.321.987-00", patientPhone: "(41) 91234-9876", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "10:30", duration: 30, status: "completed", type: "consulta", value: 350 },
  { id: "6", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d4", doctorName: "Dra. Patrícia Lima", specialty: "Fisioterapia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "11:00", duration: 50, status: "waiting", type: "terapia_pacote", therapyPackageId: "pkg1", therapyType: "Fisioterapia Motora", value: 0 },
  { id: "7", patientId: "3", patientName: "Ana Beatriz Costa", patientCpf: "456.789.123-00", patientPhone: "(21) 99876-5432", doctorId: "d4", doctorName: "Dra. Patrícia Lima", specialty: "Fisioterapia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "14:00", duration: 50, status: "scheduled", type: "terapia_avulsa", therapyType: "Acupuntura", value: 180 },
  { id: "8", patientId: "2", patientName: "João Pedro Oliveira", patientCpf: "987.654.321-00", patientPhone: "(11) 91234-5678", doctorId: "d3", doctorName: "Dr. André Souza", specialty: "Ortopedia", unitId: "u2", unitName: "Unidade Sul", date: "2026-03-22", time: "15:00", duration: 60, status: "scheduled", type: "procedimento", value: 800 },
  { id: "9", patientId: "4", patientName: "Carlos Eduardo Lima", patientCpf: "321.654.987-00", patientPhone: "(31) 98765-1234", doctorId: "d5", doctorName: "Dr. Felipe Costa", specialty: "Psicologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "16:00", duration: 50, status: "no_show", type: "consulta", value: 300 },
  { id: "10", patientId: "5", patientName: "Fernanda Rodrigues", patientCpf: "654.321.987-00", patientPhone: "(41) 91234-9876", doctorId: "d2", doctorName: "Dra. Camila Ferreira", specialty: "Dermatologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-23", time: "09:00", duration: 30, status: "scheduled", type: "retorno", returnOriginId: "prev2" },
  { id: "prev-maria", patientId: "1", patientName: "Maria Silva Santos", patientCpf: "123.456.789-00", patientPhone: "(11) 98765-4321", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", specialty: "Cardiologia", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-12", time: "09:00", duration: 30, status: "completed", type: "consulta", value: 350 },
];

// ── Billings ──────────────────────────────────
export const mockBillings: Billing[] = [
  { id: "b1", patientId: "1", patientName: "Maria Silva Santos", appointmentId: "1", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "consulta", grossAmount: 350, discount: 0, finalAmount: 350, paymentMethod: "cartao_credito", status: "paid", dueDate: "2026-03-22", paidAt: "2026-03-22", description: "Consulta Cardiologia" },
  { id: "b2", patientId: "2", patientName: "João Pedro Oliveira", appointmentId: "2", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", billingType: "retorno", appointmentType: "retorno", grossAmount: 0, discount: 0, finalAmount: 0, status: "paid", dueDate: "2026-03-22", paidAt: "2026-03-22", description: "Retorno Cardiologia" },
  { id: "b3", patientId: "3", patientName: "Ana Beatriz Costa", appointmentId: "3", professionalId: "d2", professionalName: "Dra. Camila Ferreira", unitId: "u1", unitName: "Unidade Centro", billingType: "convenio", appointmentType: "consulta", grossAmount: 450, discount: 0, finalAmount: 450, status: "pending", dueDate: "2026-03-25", description: "Consulta Dermatologia — SulAmérica" },
  { id: "b4", patientId: "4", patientName: "Carlos Eduardo Lima", appointmentId: "4", professionalId: "d3", professionalName: "Dr. André Souza", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "exame", grossAmount: 150, discount: 0, finalAmount: 150, status: "pending", dueDate: "2026-03-28", description: "Exame Ortopedia" },
  { id: "b5", patientId: "5", patientName: "Fernanda Rodrigues", appointmentId: "5", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "consulta", grossAmount: 400, discount: 50, finalAmount: 350, paymentMethod: "pix", status: "paid", dueDate: "2026-03-22", paidAt: "2026-03-22", description: "Consulta Cardiologia" },
  { id: "b6", patientId: "3", patientName: "Ana Beatriz Costa", appointmentId: "7", professionalId: "d4", professionalName: "Dra. Patrícia Lima", unitId: "u1", unitName: "Unidade Centro", billingType: "terapia_avulsa", appointmentType: "terapia_avulsa", grossAmount: 180, discount: 0, finalAmount: 180, status: "pending", dueDate: "2026-03-22", description: "Acupuntura avulsa" },
  { id: "b7", patientId: "2", patientName: "João Pedro Oliveira", appointmentId: "8", professionalId: "d3", professionalName: "Dr. André Souza", unitId: "u2", unitName: "Unidade Sul", billingType: "particular", appointmentType: "procedimento", grossAmount: 800, discount: 0, finalAmount: 800, status: "overdue", dueDate: "2026-03-15", description: "Procedimento Ortopedia" },
  { id: "b8", patientId: "4", patientName: "Carlos Eduardo Lima", professionalId: "d5", professionalName: "Dr. Felipe Costa", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "consulta", grossAmount: 300, discount: 0, finalAmount: 300, status: "cancelled", dueDate: "2026-03-22", description: "Consulta Psicologia — falta", notes: "Paciente não compareceu" },
];

// ── Billing Production (Faturamento) ──────────────────────────────────
export const mockBillingProductions: BillingProduction[] = [
  { id: "bp1", patientId: "1", patientName: "Maria Silva Santos", appointmentId: "1", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "consulta", grossAmount: 350, discount: 0, finalAmount: 350, status: "faturado", description: "Consulta Cardiologia", createdAt: "2026-03-22" },
  { id: "bp2", patientId: "3", patientName: "Ana Beatriz Costa", appointmentId: "3", professionalId: "d2", professionalName: "Dra. Camila Ferreira", unitId: "u1", unitName: "Unidade Centro", billingType: "convenio", appointmentType: "consulta", insuranceName: "SulAmérica", grossAmount: 450, discount: 0, finalAmount: 450, status: "em_aberto", description: "Consulta Dermatologia", createdAt: "2026-03-22" },
  { id: "bp3", patientId: "5", patientName: "Fernanda Rodrigues", appointmentId: "5", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", billingType: "particular", appointmentType: "consulta", grossAmount: 350, discount: 0, finalAmount: 350, status: "faturado", description: "Consulta Cardiologia", createdAt: "2026-03-22" },
  { id: "bp4", patientId: "2", patientName: "João Pedro Oliveira", appointmentId: "8", professionalId: "d3", professionalName: "Dr. André Souza", unitId: "u2", unitName: "Unidade Sul", billingType: "particular", appointmentType: "procedimento", grossAmount: 800, discount: 0, finalAmount: 800, status: "em_aberto", description: "Procedimento Ortopedia", createdAt: "2026-03-22" },
];

// ── Professional Payment ──────────────────────────────────
export const mockProfessionalPayments: ProfessionalPayment[] = [
  { id: "pp1", professionalId: "d1", professionalName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", period: "2026-03", remunerationType: "fixed", referenceDescription: "Consultas Cardiologia", quantity: 3, unitValue: 200, totalValue: 600, status: "apurado", createdAt: "2026-03-22" },
  { id: "pp2", professionalId: "d2", professionalName: "Dra. Camila Ferreira", unitId: "u1", unitName: "Unidade Centro", period: "2026-03", remunerationType: "ch", referenceDescription: "Consultas Dermatologia", quantity: 2, unitValue: 0, chQuantity: 50, chValue: 12, totalValue: 600, status: "apurado", createdAt: "2026-03-22" },
  { id: "pp3", professionalId: "d4", professionalName: "Dra. Patrícia Lima", unitId: "u1", unitName: "Unidade Centro", period: "2026-03", remunerationType: "package", referenceDescription: "Pacote Fisioterapia - mar/2026", quantity: 1, unitValue: 3000, totalValue: 3000, status: "conferido", createdAt: "2026-03-01" },
  { id: "pp4", professionalId: "d3", professionalName: "Dr. André Souza", unitId: "u2", unitName: "Unidade Sul", period: "2026-03", remunerationType: "fixed", referenceDescription: "Procedimentos Ortopedia", quantity: 1, unitValue: 400, totalValue: 400, status: "pago", createdAt: "2026-03-22", notes: "Pago em 25/03" },
];

// ── Call Center ──────────────────────────────────
export const mockCallCenterRecords: CallCenterRecord[] = [
  { id: "cc1", patientId: "1", patientName: "Maria Silva Santos", cpf: "123.456.789-00", phone: "(11) 98765-4321", unitId: "u1", unitName: "Unidade Centro", specialtyName: "Cardiologia", professionalName: "Dr. Ricardo Mendes", appointmentType: "consulta", contactStatus: "confirmado", operatorName: "Juliana Costa", createdAt: "2026-03-21T10:30:00" },
  { id: "cc2", patientName: "Roberto Nascimento", phone: "(11) 97777-8888", birthDate: "1970-05-20", insuranceName: "Unimed", insuranceNumber: "99887", unitId: "u1", unitName: "Unidade Centro", specialtyName: "Ortopedia", appointmentType: "consulta", contactStatus: "agendado", operatorName: "Juliana Costa", notes: "Paciente novo, primeira consulta", createdAt: "2026-03-22T09:15:00" },
  { id: "cc3", patientId: "3", patientName: "Ana Beatriz Costa", cpf: "456.789.123-00", phone: "(21) 99876-5432", unitId: "u1", unitName: "Unidade Centro", specialtyName: "Fisioterapia", professionalName: "Dra. Patrícia Lima", appointmentType: "terapia_avulsa", contactStatus: "nao_atendeu", operatorName: "Juliana Costa", notes: "Tentar novamente às 14h", createdAt: "2026-03-22T11:00:00" },
  { id: "cc4", patientId: "5", patientName: "Fernanda Rodrigues", cpf: "654.321.987-00", phone: "(41) 91234-9876", unitId: "u2", unitName: "Unidade Sul", specialtyName: "Dermatologia", contactStatus: "cancelado", operatorName: "Carla Santos", notes: "Paciente cancelou, remarcará próxima semana", createdAt: "2026-03-21T16:00:00" },
];

// ── Worklist ──────────────────────────────────
export const mockWorklistItems: WorklistItem[] = [
  { id: "wl1", patientId: "1", patientName: "Maria Silva Santos", examName: "Eletrocardiograma", modality: "ECG", requestingDoctorId: "d1", requestingDoctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-22", time: "14:00", priority: "normal", status: "agendado", createdAt: "2026-03-22" },
  { id: "wl2", patientId: "2", patientName: "João Pedro Oliveira", examName: "Raio-X Tórax", modality: "RX", requestingDoctorId: "d1", requestingDoctorName: "Dr. Ricardo Mendes", unitId: "u3", unitName: "Centro de Imagem", date: "2026-03-22", time: "15:30", priority: "urgent", status: "aguardando", createdAt: "2026-03-22" },
  { id: "wl3", patientId: "3", patientName: "Ana Beatriz Costa", examName: "Ressonância Magnética Joelho", modality: "RM", requestingDoctorId: "d3", requestingDoctorName: "Dr. André Souza", unitId: "u3", unitName: "Centro de Imagem", date: "2026-03-23", time: "10:00", priority: "normal", status: "solicitado", notes: "Joelho direito, com contraste", createdAt: "2026-03-22" },
  { id: "wl4", patientId: "4", patientName: "Carlos Eduardo Lima", examName: "Ultrassom Abdômen", modality: "US", requestingDoctorId: "d3", requestingDoctorName: "Dr. André Souza", unitId: "u3", unitName: "Centro de Imagem", date: "2026-03-22", time: "11:00", priority: "normal", status: "concluido", createdAt: "2026-03-21" },
  { id: "wl5", patientId: "5", patientName: "Fernanda Rodrigues", examName: "Eletrocardiograma", modality: "ECG", requestingDoctorId: "d1", requestingDoctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-21", time: "16:00", priority: "normal", status: "enviado_pacs", createdAt: "2026-03-21" },
];

// ── PACS Studies ──────────────────────────────────
export const mockPACSStudies: PACSStudy[] = [
  { id: "pacs1", patientId: "4", patientName: "Carlos Eduardo Lima", worklistItemId: "wl4", examName: "Ultrassom Abdômen", modality: "US", requestingDoctorId: "d3", requestingDoctorName: "Dr. André Souza", unitId: "u3", unitName: "Centro de Imagem", priority: "normal", accessionNumber: "ACC-20260322-001", studyInstanceUID: "1.2.840.113619.2.55.3.123456.2026032211", pacsStatus: "reported", externalLink: "https://pacs.prontomedic.com/viewer/ACC-20260322-001", reportSummary: "Exame sem alterações significativas. Órgãos abdominais com dimensões e ecogenicidade normais.", studyDate: "2026-03-22" },
  { id: "pacs2", patientId: "5", patientName: "Fernanda Rodrigues", worklistItemId: "wl5", examName: "Eletrocardiograma", modality: "ECG", requestingDoctorId: "d1", requestingDoctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", priority: "normal", accessionNumber: "ACC-20260321-005", studyInstanceUID: "1.2.840.113619.2.55.3.123456.2026032116", pacsStatus: "received", studyDate: "2026-03-21" },
];

// ── Return Controls ──────────────────────────────────
export const mockReturnControls: ReturnControl[] = [
  { id: "ret1", patientId: "2", patientName: "João Pedro Oliveira", originAppointmentId: "prev1", specialty: "Cardiologia", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", originDate: "2026-02-20", expiresAt: "2026-03-22", status: "active" },
  { id: "ret2", patientId: "5", patientName: "Fernanda Rodrigues", originAppointmentId: "prev2", specialty: "Dermatologia", doctorId: "d2", doctorName: "Dra. Camila Ferreira", originDate: "2026-03-10", expiresAt: "2026-04-09", status: "active" },
  { id: "ret3", patientId: "3", patientName: "Ana Beatriz Costa", originAppointmentId: "prev3", specialty: "Ortopedia", doctorId: "d3", doctorName: "Dr. André Souza", originDate: "2026-01-15", expiresAt: "2026-02-14", status: "expired" },
];

// ── Therapy Packages ──────────────────────────────────
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

// Legacy payments (kept for backwards compat)
export const mockPayments: Payment[] = [
  { id: "1", patientId: "1", patientName: "Maria Silva Santos", description: "Consulta - Dr. Ricardo Mendes", amount: 350, status: "paid", dueDate: "2026-03-15", paidAt: "2026-03-15", method: "Cartão de crédito" },
  { id: "2", patientId: "2", patientName: "João Pedro Oliveira", description: "Retorno - Dr. Ricardo Mendes", amount: 200, status: "pending", dueDate: "2026-03-25" },
  { id: "3", patientId: "3", patientName: "Ana Beatriz Costa", description: "Primeira consulta - Dra. Camila Ferreira", amount: 450, status: "overdue", dueDate: "2026-03-10" },
  { id: "4", patientId: "5", patientName: "Fernanda Rodrigues", description: "Consulta + Exames", amount: 780, status: "paid", dueDate: "2026-03-18", paidAt: "2026-03-17", method: "PIX" },
  { id: "5", patientId: "4", patientName: "Carlos Eduardo Lima", description: "Exame - Dra. Camila Ferreira", amount: 150, status: "pending", dueDate: "2026-03-28" },
];

export const mockMedicalRecords: MedicalRecord[] = [
  { id: "1", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-15", type: "anamnesis", content: "Paciente relata dores de cabeça frequentes nas últimas 2 semanas, principalmente ao final do dia. Nega febre ou outros sintomas associados. Histórico de enxaqueca na família." },
  { id: "2", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-15", type: "vital_signs", content: "Sinais vitais aferidos", vitalSigns: { bloodPressure: "120/80", heartRate: 72, temperature: 36.5, weight: 65, height: 165, oxygenSaturation: 98 } },
  { id: "3", patientId: "1", doctorId: "d1", doctorName: "Dr. Ricardo Mendes", unitId: "u1", unitName: "Unidade Centro", date: "2026-03-20", type: "evolution", content: "Paciente retornou com melhora significativa após uso de medicação prescrita. Mantém acompanhamento mensal." },
];

export const mockDashboardStats: DashboardStats = {
  todayAppointments: 12,
  totalPatients: 847,
  monthlyRevenue: 45780,
  pendingPayments: 8,
  pendingWorklist: 3,
  productionByUnit: [
    { unitName: "Unidade Centro", count: 9 },
    { unitName: "Unidade Sul", count: 2 },
    { unitName: "Centro de Imagem", count: 3 },
  ],
};
