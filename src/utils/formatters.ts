import { AppointmentStatus, AppointmentType, PaymentStatus, ReturnStatus, TherapyPackageStatus, BillingType, PaymentMethod, ProfessionalStatus } from "@/types";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatDate(date: string): string {
  if (!date) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

export function formatCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function getAppointmentStatusLabel(status: AppointmentStatus): string {
  const map: Record<AppointmentStatus, string> = {
    scheduled: "Agendado", confirmed: "Confirmado", waiting: "Aguardando",
    in_progress: "Em atendimento", completed: "Finalizado", no_show: "Falta", cancelled: "Cancelado",
  };
  return map[status];
}

export function getAppointmentTypeLabel(type: AppointmentType): string {
  const map: Record<AppointmentType, string> = {
    consulta: "Consulta", retorno: "Retorno", exame: "Exame",
    procedimento: "Procedimento", terapia_avulsa: "Terapia Avulsa", terapia_pacote: "Terapia Pacote",
  };
  return map[type];
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  const map: Record<PaymentStatus, string> = {
    paid: "Pago", pending: "Pendente", overdue: "Atrasado", cancelled: "Cancelado",
  };
  return map[status];
}

export function getBillingTypeLabel(type: BillingType): string {
  const map: Record<BillingType, string> = {
    particular: "Particular", convenio: "Convênio", retorno: "Retorno",
    terapia_avulsa: "Terapia Avulsa", terapia_pacote: "Terapia Pacote",
  };
  return map[type];
}

export function getPaymentMethodLabel(method: PaymentMethod): string {
  const map: Record<PaymentMethod, string> = {
    dinheiro: "Dinheiro", pix: "PIX", cartao_debito: "Cartão Débito",
    cartao_credito: "Cartão Crédito", transferencia: "Transferência", convenio: "Convênio",
  };
  return map[method];
}

export function getProfessionalStatusLabel(status: ProfessionalStatus): string {
  return status === "active" ? "Ativo" : "Inativo";
}

export function getReturnStatusLabel(status: ReturnStatus): string {
  const map: Record<ReturnStatus, string> = { active: "Ativo", used: "Utilizado", expired: "Expirado", cancelled: "Cancelado" };
  return map[status];
}

export function getTherapyPackageStatusLabel(status: TherapyPackageStatus): string {
  const map: Record<TherapyPackageStatus, string> = { active: "Ativo", completed: "Concluído", expired: "Expirado", cancelled: "Cancelado" };
  return map[status];
}

export function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

export function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
