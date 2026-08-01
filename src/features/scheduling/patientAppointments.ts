export type PatientAppointmentSection = "today" | "upcoming" | "history";

export interface PatientAppointmentRecord {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string | null;
  timezone: string;
  status: string;
  appointmentType: string | null;
  isReturn: boolean;
  isWalkin: boolean;
  isTeleconsult: boolean;
  unitId: number | null;
  unitName: string | null;
  professionalId: string | null;
  professionalName: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  roomName: string | null;
  equipmentName: string | null;
  insuranceName: string | null;
  insuranceId: number | null;
  insurancePlanName: string | null;
  cardNumber: string | null;
  authorizationStatus: string | null;
  authorizationNumber: string | null;
  paymentStatus: string | null;
  preparationStatus: string | null;
  confirmationStatus: string | null;
  sourceChannel: string | null;
  operatorName: string | null;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: string[];
}

export interface PatientAppointmentGroup {
  date: string;
  section: PatientAppointmentSection;
  appointments: PatientAppointmentRecord[];
}

export interface PatientAppointmentsSummary {
  nextAppointment: {
    id: string;
    appointmentDate: string;
    startTime: string;
    status: string;
    timezone: string;
  } | null;
  todayCount: number;
  upcomingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  pendingConfirmationCount: number;
  pendingAuthorizationCount: number;
  pendingPaymentCount: number;
  pendingPreparationCount: number;
}

export interface PatientAppointmentsTimelineResponse {
  patient: {
    id: string;
    name: string;
    socialName: string | null;
    birthDate: string | null;
    cpfMasked: string | null;
    phone: string | null;
    insuranceName: string | null;
  };
  summary: PatientAppointmentsSummary;
  groups: PatientAppointmentGroup[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  permissions: {
    viewFinancial: boolean;
    viewAuthorization: boolean;
    reschedule: boolean;
    cancel: boolean;
    overrideConflict: boolean;
    viewAudit: boolean;
  };
}

export interface PatientAppointmentsFilters {
  from?: string;
  to?: string;
  status?: string;
  appointmentType?: string;
  unitId?: number;
  professionalId?: number;
  specialtyId?: number;
  serviceId?: number;
  insuranceId?: number;
  authorizationStatus?: string;
  paymentStatus?: string;
  preparationStatus?: string;
  sourceChannel?: string;
  isReturn?: boolean;
  isWalkin?: boolean;
  isTeleconsult?: boolean;
  section?: PatientAppointmentSection | "all";
}

export interface AppointmentConflict {
  appointmentId: string;
  level: "informative" | "attention" | "blocking";
  reason: string;
  appointmentDate: string;
  startTime: string;
  endTime: string | null;
  unitName: string | null;
  professionalName: string | null;
  serviceName: string | null;
  status: string;
}

export interface AppointmentConflictResult {
  hasConflict: boolean;
  blocked: boolean;
  justificationRequired: boolean;
  canOverride: boolean;
  conflicts: AppointmentConflict[];
}

const HISTORY_STATUSES = new Set([
  "completed",
  "cancelled",
  "no_show",
  "no-show",
  "noshow",
  "rescheduled",
]);

export function compareAppointmentAscending(
  left: PatientAppointmentRecord,
  right: PatientAppointmentRecord,
): number {
  return (
    left.appointmentDate.localeCompare(right.appointmentDate) ||
    left.startTime.localeCompare(right.startTime) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

export function compareAppointmentDescending(
  left: PatientAppointmentRecord,
  right: PatientAppointmentRecord,
): number {
  return (
    right.appointmentDate.localeCompare(left.appointmentDate) ||
    right.startTime.localeCompare(left.startTime) ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function classifyAppointmentSection(
  appointment: PatientAppointmentRecord,
  today: string,
): PatientAppointmentSection {
  if (appointment.appointmentDate === today) {
    return "today";
  }
  if (
    appointment.appointmentDate < today ||
    HISTORY_STATUSES.has(appointment.status.toLowerCase())
  ) {
    return "history";
  }
  return "upcoming";
}

export function groupPatientAppointments(
  appointments: PatientAppointmentRecord[],
  today: string,
): PatientAppointmentGroup[] {
  const bySectionAndDate = new Map<string, PatientAppointmentRecord[]>();
  for (const appointment of appointments) {
    const section = classifyAppointmentSection(appointment, today);
    const key = `${section}|${appointment.appointmentDate}`;
    const current = bySectionAndDate.get(key) ?? [];
    current.push(appointment);
    bySectionAndDate.set(key, current);
  }

  const groups = Array.from(bySectionAndDate, ([key, entries]) => {
    const [section, date] = key.split("|") as [
      PatientAppointmentSection,
      string,
    ];
    const appointmentsForDay = [...entries].sort(
      section === "history"
        ? compareAppointmentDescending
        : compareAppointmentAscending,
    );
    return { date, section, appointments: appointmentsForDay };
  });

  return groups.sort((left, right) => {
    const sectionOrder: Record<PatientAppointmentSection, number> = {
      today: 0,
      upcoming: 1,
      history: 2,
    };
    const sectionDifference =
      sectionOrder[left.section] - sectionOrder[right.section];
    if (sectionDifference !== 0) return sectionDifference;
    return left.section === "history"
      ? right.date.localeCompare(left.date)
      : left.date.localeCompare(right.date);
  });
}

export function dateKeyInTimeZone(
  instant: string | Date,
  timeZone: string,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data inválida para conversão de fuso horário.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pre_scheduled: "Pré-agendado",
    scheduled: "Agendado",
    pending_confirmation: "Aguardando confirmação",
    confirmed: "Confirmado",
    waiting: "Aguardando",
    in_progress: "Em atendimento",
    completed: "Realizado",
    cancelled: "Cancelado",
    rescheduled: "Remarcado",
    no_show: "Faltou",
    "no-show": "Faltou",
    noshow: "Faltou",
    evaded: "Evadiu",
    blocked: "Bloqueado",
  };
  return labels[status.toLowerCase()] ?? status;
}
