import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Clock, UserCheck, AlertTriangle, Search, Stethoscope, PhoneCall, RotateCcw, ArrowRightLeft, Volume2, Receipt, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, servicesCatalogLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType, DbServiceCatalog } from "@/services/appointmentsService";
import { unitsService } from "@/services/catalogService";
import { supabase } from "@/lib/supabase";
import { Appointment, Patient, Unit, type AppointmentStatus } from "@/types";
import type { AppointmentTypeLiteral, AppointmentStatusForBadge } from "@/types/missing";
import { useToast } from "@/hooks/use-toast";
import { calculateAge, localDateKey } from "@/utils/formatters";
import { friendlyError } from "@/utils/friendlyError";
import { useDebounce } from "@/hooks/useDebounce";
import { CheckinReadiness, formatReceptionQueueTicketLabel, ReceptionPendingItem, ReceptionPrecheckinContext, ReceptionQueueTicket, receptionService } from "@/services/receptionService";
import { insuranceCompanyService, insurancePlanService, type InsuranceCompany, type InsurancePlan } from "@/services/insuranceService";
import {
  assertReceptionBillingIntegrity,
  assertReceptionPriceFound,
  assertReceptionReceivableIntegrity,
  assertReceptionReceivableRequired,
  clearWalkinKey,
  clearWorkflowKey,
  getOrCreateWalkinKey,
  getOrCreateWorkflowKey,
  receptionWorkflowService,
  resolveReceptionPayer,
  type ReceptionBillingQuote,
  type ReceptionWorkflowInput,
} from "@/services/receptionWorkflowService";
import { priceTableService } from "@/services/priceTableService";
import { usePermissionGate } from "@/hooks/usePermissionGate";
import { useAuth } from "@/hooks/useAuth";
import { ReceptionPatientOperationsPanel } from "@/components/patients/ReceptionPatientOperationsPanel";
import { ReceptionPatientAppointmentsSheet } from "@/components/patients/ReceptionPatientAppointmentsSheet";
import { receptionExceptionReasonLength } from "@/config/receptionPermissions";
import { AUTHORIZATION_STATUSES } from "@/services/insuranceAuthorizationService";
import { ELIGIBILITY_STATUSES, type EligibilityStatus } from "@/services/insuranceEligibilityService";
import { withTimeout } from "@/utils/asyncTimeout";
import { patientsService } from "@/services/patientsService";
import { receptionCompletionService } from "@/services/receptionCompletionService";
import { module19NursingService } from "@/services/module19NursingService";

export interface PatientRow { id: string; full_name: string; cpf: string | null; birth_date: string | null; phone: string | null; allergies: string | null; clinical_alerts?: string | null; insurance_plan_id: string | null; }

interface CheckinHandoffReceipt {
  appointmentId: string;
  patientName: string;
  billingType: "particular" | "convenio";
  billingAccountId: string;
  financialTransactionId: number | null;
  ticket?: string;
  totalGrossAmount: number;
}

function parseCurrency(value: string): number {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized || "0");
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Informe um valor monetário válido");
  return Math.round(parsed * 100) / 100;
}

function parseCatalogAmount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Tabela de preços inválida: ${label}`);
  }
  return parsed;
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  warnings: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  warnings.push(label);
  return fallback;
}

function toDisplayAppointment(db: DbAppointment, patients: PatientRow[], professionals: DbProfessional[], specialties: DbSpecialty[], appointmentTypes: DbAppointmentType[]): Appointment {
  const patient = patients.find((p) => p.id === db.patient_id);
  const professional = professionals.find((p) => p.id === db.professional_id);
  const specialty = specialties.find((s) => s.id === db.specialty_id);
  const appType = appointmentTypes.find((t) => t.id === db.appointment_type_id);
  let duration = 30;
  if (db.start_time && db.end_time) { const [sh, sm] = db.start_time.split(":").map(Number); const [eh, em] = db.end_time.split(":").map(Number); duration = (eh * 60 + em) - (sh * 60 + sm); if (duration <= 0) duration = 30; }
  const typeCategory = appType?.category || "consulta";
  const validTypes = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];
  return {
    id: db.id, patientId: db.patient_id || "", patientName: patient?.full_name || "Paciente não encontrado",
    patientCpf: patient?.cpf || undefined, patientPhone: patient?.phone || undefined,
    doctorId: db.professional_id || "", doctorName: professional?.full_name || "—",
    specialty: specialty?.name, unitId: db.unit_id || undefined,
    date: db.appointment_date, time: db.start_time?.substring(0, 5) || "00:00", duration,
    status: (db.status as AppointmentStatus) || "scheduled",
    type: (validTypes.includes(typeCategory) ? typeCategory : "consulta") as AppointmentTypeLiteral,
    typeLabel: appType?.name, notes: db.notes || undefined,
  };
}

export default function ReceptionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedAppointmentId = searchParams.get("appointment");
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [services, setServices] = useState<DbServiceCatalog[]>([]);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);
  const [insuranceCatalogReady, setInsuranceCatalogReady] = useState(false);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [checkinTarget, setCheckinTarget] = useState<Appointment | null>(null);
  const [readiness, setReadiness] = useState<CheckinReadiness | null>(null);
  const [precheckContext, setPrecheckContext] = useState<ReceptionPrecheckinContext | null>(null);
  const [canReleaseByException, setCanReleaseByException] = useState(false);
  const [priority, setPriority] = useState<"normal" | "legal" | "urgent">("normal");
  const [exceptionReason, setExceptionReason] = useState("");
  const [workflowKey, setWorkflowKey] = useState("");
  const [billingType, setBillingType] = useState<"particular" | "convenio">("particular");
  const [insuranceId, setInsuranceId] = useState("");
  const [grossAmount, setGrossAmount] = useState("0,00");
  const [validatedBillingQuote, setValidatedBillingQuote] =
    useState<ReceptionBillingQuote | null>(null);
  const [createReceivable, setCreateReceivable] = useState(false);
  const [receivableType, setReceivableType] = useState<NonNullable<ReceptionWorkflowInput["receivable"]>["type"]>("copayment");
  const [receivableAmount, setReceivableAmount] = useState("");
  const [receivableDueDate, setReceivableDueDate] = useState(localDateKey());
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinReceipt, setCheckinReceipt] = useState<CheckinHandoffReceipt | null>(null);
  const [pendingItems, setPendingItems] = useState<ReceptionPendingItem[]>([]);
  const [pendingTarget, setPendingTarget] = useState<ReceptionPendingItem | null>(null);
  const [pendingStatus, setPendingStatus] = useState("");
  const [pendingProtocol, setPendingProtocol] = useState("");
  const [authorizationNumber, setAuthorizationNumber] = useState("");
  const [authorizationPassword, setAuthorizationPassword] = useState("");
  const [authorizationValidUntil, setAuthorizationValidUntil] = useState("");
  const [pendingDetail, setPendingDetail] = useState("");
  const [queueItems, setQueueItems] = useState<ReceptionQueueTicket[]>([]);
  const [queueUpdatingId, setQueueUpdatingId] = useState<number | null>(null);
  const [queueUnits, setQueueUnits] = useState<Unit[]>([]);
  const [transferTarget, setTransferTarget] = useState<ReceptionQueueTicket | null>(null);
  const [transferUnitId, setTransferUnitId] = useState("");
  const [historyPatient, setHistoryPatient] = useState<{ id: string; name: string } | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkinSearch, setWalkinSearch] = useState("");
  const [walkinPatients, setWalkinPatients] = useState<Patient[]>([]);
  const [walkinPatientId, setWalkinPatientId] = useState("");
  const [walkinTypeId, setWalkinTypeId] = useState("");
  const [walkinProfessionalId, setWalkinProfessionalId] = useState("");
  const [walkinServiceId, setWalkinServiceId] = useState("");
  const [walkinNotes, setWalkinNotes] = useState("");
  const [walkinBusy, setWalkinBusy] = useState(false);
  const [walkinHandoffAppointmentId, setWalkinHandoffAppointmentId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search, 300);
  const navigate = useNavigate();
  const { toast } = useToast();
  const today = localDateKey();
  const { allowed: canOpenClinicalTriage } = usePermissionGate("/nursing/clinical");
  const { allowed: canOpenBilling } = usePermissionGate("/billing-accounts");
  const { allowed: canOpenFinancial } = usePermissionGate("/financial");
  const { activeCompanyId, activeUnitId } = useAuth();
  const unitId = Number.isInteger(activeUnitId) && Number(activeUnitId) > 0
    ? Number(activeUnitId)
    : null;
  const loadSequence = useRef(0);
  const checkinValidationSequence = useRef(0);
  const exceptionReasonLength = receptionExceptionReasonLength(exceptionReason);

  const loadAll = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      setLoading(true); setError(null); setWarnings([]);
      setInsuranceCatalogReady(false);
      if (unitId === null) {
        throw new Error("Selecione uma unidade operacional válida para abrir a recepção.");
      }
      const appts = await withTimeout(
        appointmentsService.getByDateForUnit(today, unitId),
        15_000,
        "A agenda da recepção não respondeu no prazo. Tente novamente.",
      );
      const results = await Promise.allSettled([
        withTimeout(professionalsLookup.getAll(), 15_000, "Profissionais não responderam no prazo."),
        withTimeout(specialtiesLookup.getAll(), 15_000, "Especialidades não responderam no prazo."),
        withTimeout(appointmentTypesLookup.getAll(), 15_000, "Tipos de agendamento não responderam no prazo."),
        withTimeout(receptionService.listPending(unitId), 15_000, "Pendências não responderam no prazo."),
        withTimeout(receptionService.listQueue(unitId, today), 15_000, "Fila não respondeu no prazo."),
        withTimeout(unitsService.getAll(true), 15_000, "Unidades não responderam no prazo."),
        withTimeout(insuranceCompanyService.getAll(), 15_000, "Convênios não responderam no prazo."),
        withTimeout(insurancePlanService.getAll(), 15_000, "Planos não responderam no prazo."),
        withTimeout(servicesCatalogLookup.getAll(), 15_000, "Serviços não responderam no prazo."),
      ]);
      const partialWarnings: string[] = [];
      const profs = settledValue(results[0], [] as DbProfessional[], "profissionais", partialWarnings);
      const specs = settledValue(results[1], [] as DbSpecialty[], "especialidades", partialWarnings);
      const types = settledValue(results[2], [] as DbAppointmentType[], "tipos de agendamento", partialWarnings);
      const pendingRows = settledValue(results[3], [] as ReceptionPendingItem[], "pendências administrativas", partialWarnings);
      const queueRows = settledValue(results[4], [] as ReceptionQueueTicket[], "fila de recepção", partialWarnings);
      const units = settledValue(results[5], [] as Unit[], "unidades", partialWarnings);
      const insurers = settledValue(results[6], [] as InsuranceCompany[], "convênios", partialWarnings);
      const plans = settledValue(results[7], [] as InsurancePlan[], "planos de convênio", partialWarnings);
      const serviceRows = settledValue(results[8], [] as DbServiceCatalog[], "serviços", partialWarnings);

      // Load patients for today's appointments
      const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))];
      let pats: PatientRow[] = [];
      if (patientIds.length > 0) {
        const { data, error: patientsError } = await withTimeout(
          supabase.from("patients").select("id, full_name, cpf, birth_date, phone, allergies, clinical_alerts, insurance_plan_id").in("id", patientIds),
          15_000,
          "O cadastro dos pacientes não respondeu no prazo. O check-in foi bloqueado.",
        );
        if (patientsError) {
          throw new Error("Não foi possível carregar o cadastro dos pacientes. O check-in foi bloqueado.");
        }
        pats = data || [];
        const loadedPatientIds = new Set(pats.map((patient) => String(patient.id)));
        if (patientIds.some((patientId) => !loadedPatientIds.has(String(patientId)))) {
          throw new Error("Um ou mais agendamentos possuem paciente indisponível. O check-in foi bloqueado.");
        }
      }
      if (sequence !== loadSequence.current) return;
      setProfessionals(profs); setSpecialties(specs); setAppointmentTypes(types); setPatients(pats); setDbAppointments(appts);
      setPendingItems(pendingRows); setQueueItems(queueRows); setQueueUnits(units);
      setInsuranceCompanies(insurers); setInsurancePlans(plans);
      setServices(serviceRows);
      setInsuranceCatalogReady(
        results[6].status === "fulfilled" && results[7].status === "fulfilled",
      );
      setWarnings(partialWarnings);
    } catch (err) {
      if (sequence === loadSequence.current) setError(friendlyError(err, "Carregar recepção"));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [today, unitId]);

  useEffect(() => {
    void loadAll();
    return () => { loadSequence.current += 1; };
  }, [loadAll]);

  const appointments = useMemo(() => dbAppointments.map((db) => toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes)), [dbAppointments, patients, professionals, specialties, appointmentTypes]);
  const queueSummary = useMemo(() => ({
    waiting: queueItems.filter((ticket) => ticket.status === "waiting").length,
    called: queueItems.filter((ticket) => ticket.status === "called").length,
    transferred: queueItems.filter((ticket) => ticket.status === "transferred").length,
    overdue: queueItems.filter((ticket) => ["waiting", "called", "transferred"].includes(ticket.status) && new Date(ticket.sla_due_at).getTime() < Date.now()).length,
  }), [queueItems]);

  const [preparingTriageId, setPreparingTriageId] = useState<string | null>(null);

  const openClinicalTriage = useCallback(async (appointment: Appointment) => {
    if (preparingTriageId) return;
    setPreparingTriageId(appointment.id);
    try {
      if (!activeUnitId) throw new Error("Selecione a unidade ativa antes de encaminhar.");
      const handoff = await module19NursingService.prepareHandoff(
        Number(appointment.id),
        Number(appointment.patientId),
        Number(activeUnitId),
        appointment.notes,
      );
      const params = new URLSearchParams({
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        queueId: String(handoff.queue.id),
      });
      navigate(`/nursing/clinical?${params.toString()}`);
    } catch (cause) {
      toast({
        title: "Não foi possível encaminhar para a triagem",
        description: friendlyError(cause, "Preparar triagem"),
        variant: "destructive",
      });
    } finally {
      setPreparingTriageId(null);
    }
  }, [activeUnitId, navigate, preparingTriageId, toast]);

  const fetchCheckinReadiness = useCallback(async (appointmentId: string): Promise<{
    readiness: CheckinReadiness;
    precheck: ReceptionPrecheckinContext;
  }> => {
    const [baseReadiness, precheck] = await Promise.all([
      receptionService.getReadiness(appointmentId),
      receptionService.getPrecheckinContext(appointmentId),
    ]);
    return {
      precheck,
      readiness: {
        ...baseReadiness,
        ready: baseReadiness.ready && precheck.ready,
        issues: [...baseReadiness.issues, ...precheck.issues],
        has_document_pending: precheck.has_document_pending,
      },
    };
  }, []);

  const openCheckin = async (appointment: Appointment) => {
    const sequence = ++checkinValidationSequence.current;
    try {
      setCheckingIn(true); setCheckinTarget(appointment); setReadiness(null); setPrecheckContext(null); setCanReleaseByException(false); setExceptionReason(""); setPriority("normal");
      const patient = patients.find((item) => item.id === appointment.patientId);
      const {
        plan,
        insurer,
        billingType: resolvedBillingType,
      } = resolveReceptionPayer(
        patient,
        insurancePlans,
        insuranceCompanies,
        insuranceCatalogReady,
      );
      const isInsurance = resolvedBillingType === "convenio";
      const sourceAppointment = dbAppointments.find((item) => item.id === appointment.id);
      const serviceId = Number(sourceAppointment?.service_id);
      const appointmentTypeId = Number(sourceAppointment?.appointment_type_id);
      if (
        !sourceAppointment
        || !Number.isSafeInteger(serviceId)
        || serviceId <= 0
        || !Number.isSafeInteger(appointmentTypeId)
        || appointmentTypeId <= 0
      ) {
        throw new Error(
          "Agendamento sem serviço ou tipo válido. O preço não pode ser determinado.",
        );
      }
      const priceLookup = await priceTableService.findPrice(
        serviceId,
        appointmentTypeId,
        plan?.id ? Number(plan.id) : null,
        sourceAppointment?.company_id || activeCompanyId,
      );
      if (sequence !== checkinValidationSequence.current) return;
      assertReceptionPriceFound(priceLookup.found);
      const estimatedAmount = Math.max(
        0,
        (isInsurance
          ? parseCatalogAmount(priceLookup.vl_convenio, "valor do convênio")
          : parseCatalogAmount(priceLookup.vl_particular, "valor particular"))
          + parseCatalogAmount(priceLookup.vl_material, "material")
          + parseCatalogAmount(priceLookup.vl_medicamento, "medicamento")
          + parseCatalogAmount(priceLookup.vl_taxa, "taxa")
          + parseCatalogAmount(priceLookup.vl_diaria, "diária")
          + parseCatalogAmount(priceLookup.vl_gases, "gases"),
      );
      setWorkflowKey(getOrCreateWorkflowKey(appointment.id, activeCompanyId, unitId));
      setBillingType(isInsurance ? "convenio" : "particular");
      setInsuranceId(isInsurance ? String(plan?.insurance_company_id) : "");
      setGrossAmount(estimatedAmount.toFixed(2).replace(".", ","));
      setValidatedBillingQuote({
        billingType: resolvedBillingType,
        insuranceId: insurer?.id ?? null,
        totalGrossAmount: estimatedAmount,
      });
      setCreateReceivable(!isInsurance && estimatedAmount > 0);
      setReceivableType(isInsurance ? "copayment" : "private");
      setReceivableAmount(
        estimatedAmount > 0
          ? estimatedAmount.toFixed(2).replace(".", ",")
          : "",
      );
      setReceivableDueDate(today);
      const [checkinReadiness, exceptionCapability] = await Promise.all([
        fetchCheckinReadiness(appointment.id),
        receptionService.getExceptionCapability(appointment.id),
      ]);
      if (sequence !== checkinValidationSequence.current) return;
      setPrecheckContext(checkinReadiness.precheck);
      setReadiness(checkinReadiness.readiness);
      setCanReleaseByException(exceptionCapability);
    } catch (err) {
      if (sequence !== checkinValidationSequence.current) return;
      setCheckinTarget(null); setPrecheckContext(null); setCanReleaseByException(false); toast({ title: "Erro ao validar check-in", description: (err as Error).message, variant: "destructive" });
    } finally {
      if (sequence === checkinValidationSequence.current) setCheckingIn(false);
    }
  };
  const openCheckinRef = useRef(openCheckin);
  openCheckinRef.current = openCheckin;

  useEffect(() => {
    if (!requestedAppointmentId || loading) return;

    const appointment = appointments.find(
      (item) => item.id === requestedAppointmentId,
    );
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("appointment");
    setSearchParams(nextParams, { replace: true });

    if (!appointment) {
      toast({
        title: "Agendamento não disponível na Recepção",
        description: "Confirme a unidade ativa e tente novamente pela Agenda.",
        variant: "destructive",
      });
      return;
    }

    void openCheckinRef.current(appointment);
  }, [appointments, loading, requestedAppointmentId, searchParams, setSearchParams, toast]);

  const confirmCheckin = async () => {
    if (!checkinTarget || !readiness) return;
    if (!readiness.ready && !canReleaseByException) {
      toast({ title: "Seu perfil não possui permissão para liberar este atendimento por exceção", variant: "destructive" });
      return;
    }
    if (!readiness.ready && exceptionReasonLength < 20) {
      toast({ title: "Descreva a justificativa da exceção com pelo menos 20 caracteres", variant: "destructive" });
      return;
    }
    try {
      setCheckingIn(true);
      const totalGrossAmount = parseCurrency(grossAmount);
      if (billingType === "convenio" && !insuranceId) throw new Error("Selecione o convênio da pré-conta");
      const submittedInsuranceId = billingType === "convenio"
        ? Number(insuranceId)
        : null;
      if (
        submittedInsuranceId !== null
        && (!Number.isSafeInteger(submittedInsuranceId) || submittedInsuranceId <= 0)
      ) {
        throw new Error("Convênio inválido para a pré-conta");
      }
      assertReceptionBillingIntegrity(validatedBillingQuote, {
        billingType,
        insuranceId: submittedInsuranceId,
        totalGrossAmount,
      });
      assertReceptionReceivableRequired(billingType, createReceivable);
      const pendingAmount = createReceivable ? parseCurrency(receivableAmount) : 0;
      if (createReceivable) {
        assertReceptionReceivableIntegrity(
          billingType,
          totalGrossAmount,
          receivableType,
          pendingAmount,
        );
      }
      const appointmentId = Number(checkinTarget.id);
      if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
        throw new Error("Identificador do agendamento inválido");
      }
      const result = await receptionWorkflowService.run({
        appointmentId,
        idempotencyKey: workflowKey,
        priority,
        exceptionReason: readiness.ready ? undefined : exceptionReason.trim(),
        billing: {
          type: billingType,
          accountType: "ambulatorial",
          insuranceId: submittedInsuranceId ?? undefined,
          totalGrossAmount,
        },
        receivable: createReceivable ? {
          type: receivableType,
          amount: pendingAmount,
          dueDate: receivableDueDate,
        } : undefined,
      });
      const ticket = result.checkin?.ticket;
      const billingAccountId = result.workflow.billing_account_id;
      if (
        !billingAccountId
        || !result.checkin?.checkin_id
        || !result.checkin.ticket_id
        || !ticket
      ) {
        throw new Error("Check-in concluído sem conta e senha persistidas");
      }
      setCheckinReceipt({
        appointmentId: checkinTarget.id,
        patientName: checkinTarget.patientName,
        billingType,
        billingAccountId,
        financialTransactionId: result.workflow.financial_transaction_id,
        ticket,
        totalGrossAmount,
      });
      clearWorkflowKey(checkinTarget.id, activeCompanyId, unitId);
      toast({
        title: ticket ? `Entrada concluída · Senha ${ticket}` : "Entrada e conta do atendimento concluídas",
        description: billingType === "convenio"
          ? "A conta foi aberta e seguirá para conferência do faturamento."
          : "A conta foi aberta e o recebimento deve ser confirmado no Caixa.",
      });
      setCheckinTarget(null); setReadiness(null); setPrecheckContext(null); setCanReleaseByException(false); setValidatedBillingQuote(null); await loadAll();
    } catch (err) { toast({ title: "Check-in bloqueado", description: (err as Error).message, variant: "destructive" }); }
    finally { setCheckingIn(false); }
  };

  const searchWalkinPatients = async () => {
    try {
      setWalkinBusy(true);
      const rows = await patientsService.search(walkinSearch);
      setWalkinPatients(rows);
      if (rows.length === 0) {
        toast({ title: "Nenhum paciente encontrado" });
      }
    } catch (err) {
      toast({ title: "Erro ao buscar paciente", description: friendlyError(err, "Buscar paciente"), variant: "destructive" });
    } finally {
      setWalkinBusy(false);
    }
  };

  const createWalkin = async () => {
    if (unitId === null) return;
    try {
      setWalkinBusy(true);
      const result = await receptionCompletionService.createWalkin(
        walkinPatientId,
        unitId,
        Number(walkinTypeId),
        Number(walkinProfessionalId),
        Number(walkinServiceId),
        getOrCreateWalkinKey(activeCompanyId, unitId),
        walkinNotes,
      );
      if (
        !Number.isSafeInteger(Number(result.appointment_id))
        || Number(result.appointment_id) <= 0
      ) {
        throw new Error("Atendimento espontâneo retornou agendamento inválido");
      }
      setWalkinOpen(false);
      setWalkinSearch("");
      setWalkinPatients([]);
      setWalkinPatientId("");
      setWalkinNotes("");
      setWalkinHandoffAppointmentId(String(result.appointment_id));
      await loadAll();
      toast({
        title: result.idempotent
          ? `Atendimento espontâneo #${result.appointment_id} retomado`
          : `Atendimento espontâneo #${result.appointment_id} criado`,
        description: "O mesmo atendimento seguirá para o check-in transacional.",
      });
    } catch (err) {
      toast({ title: "Atendimento espontâneo não criado", description: friendlyError(err, "Criar atendimento espontâneo"), variant: "destructive" });
    } finally {
      setWalkinBusy(false);
    }
  };

  useEffect(() => {
    if (!walkinHandoffAppointmentId || loading) return;
    const appointment = appointments.find(
      (item) => item.id === walkinHandoffAppointmentId,
    );
    if (!appointment) return;
    setWalkinHandoffAppointmentId(null);
    clearWalkinKey(activeCompanyId, unitId);
    void openCheckinRef.current(appointment);
  }, [
    activeCompanyId,
    appointments,
    loading,
    unitId,
    walkinHandoffAppointmentId,
  ]);

  const openPending = (item: ReceptionPendingItem) => {
    setPendingTarget(item); setPendingStatus(item.status); setPendingProtocol(item.protocol_number || "");
    setAuthorizationNumber(""); setAuthorizationPassword(""); setAuthorizationValidUntil(""); setPendingDetail(item.description || "");
  };

  const savePending = async () => {
    if (!pendingTarget || !pendingStatus) return;
    if (
      pendingTarget.kind === "authorization"
      && ["autorizada", "parcialmente_autorizada"].includes(pendingStatus)
      && !authorizationNumber.trim()
    ) {
      toast({ title: "Informe o número da autorização", variant: "destructive" });
      return;
    }
    if (pendingTarget.kind === "authorization" && pendingStatus === "negada" && !pendingDetail.trim()) {
      toast({ title: "Informe o motivo da negativa", variant: "destructive" });
      return;
    }
    if (
      pendingTarget.kind === "eligibility"
      && !ELIGIBILITY_STATUSES.some((status) => status === pendingStatus)
    ) {
      toast({ title: "Status de elegibilidade inválido", variant: "destructive" });
      return;
    }
    try {
      setCheckingIn(true);
      if (pendingTarget.kind === "authorization") await receptionService.updateAuthorization(pendingTarget.id, { status: pendingStatus, protocol: pendingProtocol, authorizationNumber, password: authorizationPassword, validUntil: authorizationValidUntil, reason: pendingDetail });
      else {
        const status = pendingStatus as EligibilityStatus;
        const detail = pendingDetail.trim() || undefined;
        await receptionService.updateEligibility(pendingTarget.id, {
          status,
          protocol: pendingProtocol,
          resultDetail: status !== "liberado_excecao" && status !== "bloqueado"
            ? detail
            : undefined,
          exceptionReason: status === "liberado_excecao" ? detail : undefined,
          blockReason: status === "bloqueado" ? detail : undefined,
        });
      }
      toast({ title: "Pendência atualizada e auditada" }); setPendingTarget(null); await loadAll();
    } catch (err) { toast({ title: "Erro ao atualizar pendência", description: (err as Error).message, variant: "destructive" }); }
    finally { setCheckingIn(false); }
  };

  const transitionQueue = async (ticket: ReceptionQueueTicket, status: ReceptionQueueTicket["status"]) => {
    try {
      setQueueUpdatingId(ticket.id);
      await receptionService.transitionQueueTicket(ticket.id, status, "Atualização pela recepção");
      toast({ title: `Senha ${formatReceptionQueueTicketLabel(ticket)} atualizada` });
      await loadAll();
    } catch (err) {
      toast({ title: "Erro ao atualizar fila", description: friendlyError(err, "Atualizar fila"), variant: "destructive" });
    } finally { setQueueUpdatingId(null); }
  };

  const openTransfer = (ticket: ReceptionQueueTicket) => {
    const firstDestination = queueUnits.find((unit) => Number(unit.id) !== Number(ticket.unit_id));
    setTransferTarget(ticket);
    setTransferUnitId(firstDestination?.id ? String(firstDestination.id) : "");
  };

  const transferQueue = async () => {
    if (!transferTarget || !transferUnitId) return;
    try {
      setQueueUpdatingId(transferTarget.id);
      await receptionService.transitionQueueTicket(transferTarget.id, "transferred", "Transferência pela recepção", Number(transferUnitId));
      toast({ title: `Senha ${formatReceptionQueueTicketLabel(transferTarget)} transferida` });
      setTransferTarget(null);
      await loadAll();
    } catch (err) {
      toast({ title: "Erro ao transferir senha", description: friendlyError(err, "Transferir senha"), variant: "destructive" });
    } finally { setQueueUpdatingId(null); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  const filtered = sorted.filter((a) => {
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.toLowerCase();
    const cpfDigits = q.replace(/\D/g, "");
    const patientCpfDigits = a.patientCpf?.replace(/\D/g, "") ?? "";
    return a.patientName.toLowerCase().includes(q)
      || (cpfDigits.length > 0 && patientCpfDigits.includes(cpfDigits));
  });

  const scheduled = filtered.filter((a) => a.status === "scheduled" || a.status === "confirmed");
  const waiting = filtered.filter((a) => a.status === "waiting");
  const inProgress = filtered.filter((a) => a.status === "in_progress");
  const completed = filtered.filter((a) => a.status === "completed");
  const calledQueueItems = queueItems.filter((ticket) => ticket.status === "called").slice(0, 8);
  const getPatient = (pid: string) => patients.find((p) => p.id === pid);
  const isLate = (a: Appointment) => { const now = new Date(); const [h, m] = a.time.split(":").map(Number); const s = new Date(); s.setHours(h, m, 0, 0); return now > s && (a.status === "scheduled" || a.status === "confirmed"); };

  const renderCard = (a: Appointment, actions: React.ReactNode) => {
    const pat = getPatient(a.patientId);
    const late = isLate(a);
    const age = pat?.birth_date ? calculateAge(pat.birth_date) : null;
    return (
      <Card key={a.id} className={`hover:shadow-md transition-shadow ${late ? "border-l-4 border-l-destructive" : a.status === "waiting" ? "border-l-4 border-l-warning" : a.status === "in_progress" ? "border-l-4 border-l-success" : ""}`}>
        <CardContent className="p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="text-center min-w-[48px]"><p className="text-sm font-bold text-primary">{a.time}</p><p className="text-[10px] text-muted-foreground">{a.duration}min</p></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={`Ver agendamentos de ${a.patientName}`}
                  onClick={() => setHistoryPatient({ id: a.patientId, name: a.patientName })}
                >
                  {a.patientName}
                </button>
                {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                {a.typeLabel && <AppointmentTypeBadge type={a.type} />}
              </div>
              <p className="text-xs text-muted-foreground">{a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {pat?.phone || "Telefone não informado"} · {pat?.insurance_plan_id ? `Convênio #${pat.insurance_plan_id}` : "Particular"}
              </p>
              {(late || pat?.allergies || pat?.clinical_alerts) && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {late && <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />Atrasado</span>}
                  {pat?.allergies && <span className="text-[10px] text-destructive flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />{pat.allergies}</span>}
                  {pat?.clinical_alerts && <span className="text-[10px] text-warning flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />{pat.clinical_alerts}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <AppointmentStatusBadge status={a.status as AppointmentStatusForBadge} />
            {actions}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Entrada do paciente"
        description={`${sorted.length} pacientes hoje · chegada, pagador, pendências e encaminhamento`}
        actions={
          <Button type="button" onClick={() => setWalkinOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Atendimento espontâneo
          </Button>
        }
      />

      {warnings.length > 0 && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Recepção carregada parcialmente</p>
              <p className="text-xs text-muted-foreground">
                Não foi possível carregar: {warnings.join(", ")}. As demais operações continuam disponíveis.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadAll()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando Chegada" count={scheduled.length} color="text-primary" bg="bg-primary/5 border-primary/20" />
        <StatusCard icon={<Check className="h-4 w-4" />} label="Sala de Espera" count={waiting.length} color="text-warning" bg="bg-warning/5 border-warning/20" />
        <StatusCard icon={<Stethoscope className="h-4 w-4" />} label="Em Atendimento" count={inProgress.length} color="text-success" bg="bg-success/5 border-success/20" />
        <StatusCard icon={<UserCheck className="h-4 w-4" />} label="Finalizados" count={completed.length} color="text-muted-foreground" bg="bg-muted/50" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-base font-semibold">Fila de recepção</h2>
        </CardHeader>
        <CardContent className="space-y-2">
          {queueItems.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma senha emitida para esta unidade hoje.</p> : queueItems.map((ticket) => {
            const label = formatReceptionQueueTicketLabel(ticket);
            const accessibleLabel = formatReceptionQueueTicketLabel(ticket, "accessible");
            const activeQueueState = ["waiting", "called", "transferred"].includes(ticket.status);
            const slaOverdue = activeQueueState && new Date(ticket.sla_due_at).getTime() < Date.now();
            return <div key={ticket.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <div className="min-w-0"><p className="font-medium text-sm">{label} · Paciente #{ticket.patient_id ?? "-"}</p><p className="text-xs text-muted-foreground">{ticket.sector} · {ticket.priority} · {ticket.status}</p><p className={`text-[11px] ${slaOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>{slaOverdue ? "SLA vencida" : `SLA até ${new Date(ticket.sla_due_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}{ticket.transferred_to_unit_id ? ` · Unidade #${ticket.transferred_to_unit_id}` : ""}</p></div>
              <div className="flex items-center gap-1 shrink-0">
                {ticket.status === "waiting" && <><Button aria-label={`Transferir senha ${accessibleLabel}`} size="sm" variant="outline" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => openTransfer(ticket)}><ArrowRightLeft className="mr-1 h-3 w-3" />Transferir</Button><Button aria-label={`Chamar senha ${accessibleLabel}`} size="sm" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => void transitionQueue(ticket, "called")}><PhoneCall className="mr-1 h-3 w-3" />Chamar</Button></>}
                {ticket.status === "called" && <><Button aria-label={`Devolver senha ${accessibleLabel} para a fila`} size="sm" variant="outline" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => void transitionQueue(ticket, "waiting")}><RotateCcw className="mr-1 h-3 w-3" />Devolver</Button><Button aria-label={`Concluir senha ${accessibleLabel}`} size="sm" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => void transitionQueue(ticket, "completed")}><Check className="mr-1 h-3 w-3" />Concluir</Button></>}
                {ticket.status === "called" && <Button aria-label={`Transferir senha ${accessibleLabel}`} size="sm" variant="outline" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => openTransfer(ticket)}><ArrowRightLeft className="mr-1 h-3 w-3" />Transferir</Button>}
                {ticket.status === "transferred" && <Button aria-label={`Chamar senha transferida ${accessibleLabel}`} size="sm" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => void transitionQueue(ticket, "called")}><PhoneCall className="mr-1 h-3 w-3" />Chamar</Button>}
              </div>
            </div>;
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Volume2 className="h-4 w-4 text-primary" />
            Painel de chamadas
          </h2>
        </CardHeader>
        <CardContent className="space-y-3" aria-live="polite">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando" count={queueSummary.waiting} color="text-primary" bg="bg-primary/5 border-primary/20" />
            <StatusCard icon={<PhoneCall className="h-4 w-4" />} label="Chamadas ativas" count={queueSummary.called} color="text-success" bg="bg-success/5 border-success/20" />
            <StatusCard icon={<ArrowRightLeft className="h-4 w-4" />} label="Transferidas" count={queueSummary.transferred} color="text-warning" bg="bg-warning/5 border-warning/20" />
            <StatusCard icon={<AlertTriangle className="h-4 w-4" />} label="SLA vencida" count={queueSummary.overdue} color="text-destructive" bg="bg-destructive/5 border-destructive/20" />
          </div>
          {calledQueueItems.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma senha chamada no momento.</p> : <div className="space-y-1">{calledQueueItems.map((ticket) => { const label = formatReceptionQueueTicketLabel(ticket); const accessibleLabel = formatReceptionQueueTicketLabel(ticket, "accessible"); return <div key={ticket.id} className="flex items-center justify-between rounded-md border px-3 py-2"><span className="font-semibold">{label}</span><span className="text-xs text-muted-foreground">{ticket.sector} · chamada ativa</span><Button aria-label={`Concluir senha ${accessibleLabel}`} size="sm" variant="outline" className="h-7 text-xs" disabled={queueUpdatingId === ticket.id} onClick={() => void transitionQueue(ticket, "completed")}><Check className="mr-1 h-3 w-3" />Concluir</Button></div>; })}</div>}
        </CardContent>
      </Card>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label="Buscar paciente na recepção"
          placeholder="Buscar paciente..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Tabs defaultValue="queue">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger className="min-w-0 whitespace-normal text-xs sm:text-sm" value="queue">
            Fila ({scheduled.length + waiting.length})
          </TabsTrigger>
          <TabsTrigger className="min-w-0 whitespace-normal text-xs sm:text-sm" value="attending">
            Em Atendimento ({inProgress.length})
          </TabsTrigger>
          <TabsTrigger className="min-w-0 whitespace-normal text-xs sm:text-sm" value="done">
            Finalizados ({completed.length})
          </TabsTrigger>
          <TabsTrigger className="min-w-0 whitespace-normal text-xs sm:text-sm" value="pending">
            Pendências ({pendingItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-3 space-y-2">
          {[...scheduled, ...waiting].length === 0 ? (
            <EmptyState icon={UserCheck} title="Nenhum paciente na fila" />
          ) : (
            [...scheduled, ...waiting].map((a) => renderCard(a,
              a.status === "scheduled" || a.status === "confirmed" ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={checkingIn} onClick={() => void openCheckin(a)}><Check className="mr-1 h-3 w-3" />Check-in</Button>
              ) : a.status === "waiting" && canOpenClinicalTriage ? (
                <Button size="sm" className="h-7 text-xs" disabled={Boolean(preparingTriageId)} onClick={() => void openClinicalTriage(a)}><Stethoscope className="mr-1 h-3 w-3" />{preparingTriageId === a.id ? "Encaminhando..." : "Encaminhar à triagem"}</Button>
              ) : null
            ))
          )}
        </TabsContent>

        <TabsContent value="attending" className="mt-3 space-y-2">
          {inProgress.length === 0 ? <EmptyState icon={Stethoscope} title="Nenhum atendimento em andamento" /> :
            inProgress.map((a) => renderCard(a,
              canOpenClinicalTriage ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/attendance/${a.id}`)}>
                <Stethoscope className="mr-1 h-3 w-3" />Retomar atendimento
              </Button> : null
            ))
          }
        </TabsContent>

        <TabsContent value="done" className="mt-3 space-y-2">
          {completed.length === 0 ? <EmptyState icon={UserCheck} title="Nenhum atendimento finalizado" /> :
            completed.map((a) => renderCard(a, null))
          }
        </TabsContent>

        <TabsContent value="pending" className="mt-3 space-y-2">
          {pendingItems.length === 0 ? <EmptyState icon={Check} title="Nenhuma pendência administrativa" /> : pendingItems.map((item) => <Card key={`${item.kind}-${item.id}`}><CardContent className="p-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{item.patient_name || `Paciente #${item.patient_id || "-"}`}</p><p className="text-xs text-muted-foreground">Agendamento #{item.appointment_id || "-"} · {item.kind === "authorization" ? "Autorização" : "Elegibilidade"} · {item.status}</p><p className="text-xs">{item.description || "Sem observação"}</p></div><Button size="sm" variant="outline" onClick={() => openPending(item)}>Resolver</Button></CardContent></Card>)}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(checkinTarget)} onOpenChange={(open) => { if (!open && !checkingIn) { setCheckinTarget(null); setReadiness(null); setPrecheckContext(null); setCanReleaseByException(false); setValidatedBillingQuote(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Entrada do paciente</DialogTitle><DialogDescription>{checkinTarget?.patientName} · {checkinTarget?.time} · {checkinTarget?.doctorName}</DialogDescription></DialogHeader>
          {!readiness ? <p role="status" className="text-sm text-muted-foreground">Validando cadastro, convênio e autorização...</p> : <div className="space-y-4">
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <div className="border-l-2 border-primary pl-3"><strong className="block text-foreground">1. Conferir</strong><span className="text-muted-foreground">Cadastro, documentos e autorização</span></div>
              <div className="border-l-2 border-primary pl-3"><strong className="block text-foreground">2. Definir pagador</strong><span className="text-muted-foreground">Particular ou convênio e valor</span></div>
              <div className="border-l-2 border-primary pl-3"><strong className="block text-foreground">3. Confirmar entrada</strong><span className="text-muted-foreground">Abrir conta e encaminhar o paciente</span></div>
            </div>
            <div role={readiness.ready ? "status" : "alert"} className={`rounded-md border p-3 ${readiness.ready ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}><p className="text-sm font-medium">{readiness.ready ? "Paciente liberado para check-in" : "Pendências bloqueiam o check-in"}</p>{readiness.issues.map((issue) => <p key={`${issue.type}-${issue.description}`} className="text-xs text-destructive mt-1">{issue.description}</p>)}</div>
            <div className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-semibold">Pagador, pré-conta e documentos</h3>
                <p className="text-xs text-muted-foreground">A recepção prepara e vincula os artefatos. Nenhum pagamento é confirmado nesta tela.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reception-billing-type">Fonte pagadora</Label>
                  <Select value={billingType} disabled>
                    <SelectTrigger id="reception-billing-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="particular">Particular — encaminhar ao Caixa</SelectItem>
                      <SelectItem value="convenio">Convênio — preparar faturamento</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {billingType === "particular"
                      ? "O título fica pendente para o Caixa confirmar Pix, cartão, dinheiro ou transferência."
                      : "A conta e a guia seguem para conferência e faturamento do convênio."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reception-gross-amount">Valor bruto da pré-conta</Label>
                  <Input id="reception-gross-amount" inputMode="decimal" value={grossAmount} readOnly />
                  <p className="text-xs text-muted-foreground">
                    Valor calculado pela tabela vigente. Ajustes exigem correção cadastral antes do check-in.
                  </p>
                </div>
                {billingType === "convenio" && (
                  <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="reception-insurance">Convênio</Label>
                      <Select value={insuranceId} disabled>
                        <SelectTrigger id="reception-insurance"><SelectValue placeholder="Selecione o convênio" /></SelectTrigger>
                        <SelectContent>
                          {insuranceCompanies.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reception-insurance-card">Carteirinha</Label>
                      <Input id="reception-insurance-card" value={precheckContext?.insurance_card_number || "Não informada"} readOnly />
                    </div>
                    {precheckContext?.authorization_required && (
                      <div className="space-y-2 sm:col-span-2 rounded-md border p-3">
                        <p className="text-sm font-medium">Autorização do procedimento</p>
                        <p className="text-xs">Número: {precheckContext.authorization_number || "Não informado"}</p>
                        <p className="text-xs">Senha: {precheckContext.authorization_password || "Não informada"}</p>
                        <p className="text-xs">Validade: {precheckContext.authorization_valid_until || "Não informada"}</p>
                        <p className="text-xs">Procedimento: {precheckContext.authorization_procedure_desc || `#${precheckContext.authorization_procedure_id || "não vinculado"}`}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Fluxo TISS</p>
                <p className="text-xs text-muted-foreground">
                  A Recepção abre a pré-conta. A guia SP/SADT e o XML são gerados pelo Faturamento somente após conferência e aprovação.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="reception-create-receivable"
                  checked={createReceivable}
                  disabled={billingType === "particular"}
                  onCheckedChange={(checked) => setCreateReceivable(Boolean(checked))}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="reception-create-receivable">Gerar título pendente</Label>
                  <p className="text-xs text-muted-foreground">
                    {billingType === "particular"
                      ? "Obrigatório no particular: o Caixa confirma a forma de pagamento e registra a baixa."
                      : "Quando houver coparticipação, o título seguirá ao Financeiro sem baixa presumida."}
                  </p>
                </div>
              </div>
              {createReceivable && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="reception-receivable-type">Natureza</Label>
                    <Select value={receivableType} onValueChange={(value) => setReceivableType(value as typeof receivableType)}>
                      <SelectTrigger id="reception-receivable-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="copayment">Coparticipação</SelectItem>
                        <SelectItem value="private">Particular</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reception-receivable-amount">Valor</Label>
                    <Input id="reception-receivable-amount" inputMode="decimal" value={receivableAmount} onChange={(event) => setReceivableAmount(event.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reception-receivable-due-date">Vencimento</Label>
                    <Input id="reception-receivable-due-date" type="date" value={receivableDueDate} onChange={(event) => setReceivableDueDate(event.target.value)} />
                  </div>
                </div>
              )}
            </div>
            {checkinTarget && (
              <ReceptionPatientOperationsPanel
                patientId={checkinTarget.patientId}
                appointmentId={checkinTarget.id}
                unitId={checkinTarget.unitId}
                mode="checkin"
                documentIssues={readiness.issues.filter((issue) => issue.type === "document")}
                onOperationCompleted={async () => {
                  const refreshed = await fetchCheckinReadiness(checkinTarget.id);
                  setPrecheckContext(refreshed.precheck);
                  setReadiness(refreshed.readiness);
                }}
              />
            )}
            <div className="space-y-2"><Label htmlFor="reception-priority">Prioridade da senha</Label><Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}><SelectTrigger id="reception-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="legal">Prioridade legal</SelectItem><SelectItem value="urgent">Urgente</SelectItem></SelectContent></Select></div>
            {!readiness.ready && canReleaseByException && (
              <div className="space-y-2">
                <Label htmlFor="reception-exception-reason">Justificativa da exceção *</Label>
                <Textarea
                  id="reception-exception-reason"
                  aria-describedby="reception-exception-help reception-exception-count"
                  value={exceptionReason}
                  onChange={(event) => setExceptionReason(event.target.value)}
                  placeholder="Descreva o motivo, a decisão e o risco assumido"
                />
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span id="reception-exception-help">Mínimo de 20 caracteres.</span>
                  <span id="reception-exception-count" role="status">{exceptionReasonLength}/20</span>
                </div>
              </div>
            )}
            {!readiness.ready && !canReleaseByException && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                Resolva as pendências antes do check-in. Seu perfil não possui permissão para liberar este atendimento por exceção.
              </div>
            )}
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => { setCheckinTarget(null); setReadiness(null); setPrecheckContext(null); setCanReleaseByException(false); }} disabled={checkingIn}>Cancelar</Button><Button onClick={() => void confirmCheckin()} disabled={checkingIn || !readiness || !workflowKey || (!readiness.ready && (!canReleaseByException || exceptionReasonLength < 20))}>{checkingIn ? "Processando..." : !readiness ? "Validando check-in..." : readiness.ready ? "Confirmar entrada e abrir conta" : "Liberar entrada por exceção"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={walkinOpen} onOpenChange={(open) => { if (!walkinBusy) setWalkinOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Atendimento espontâneo</DialogTitle>
            <DialogDescription>Localize o paciente e defina os dados mínimos. A mesma operação será retomada em caso de falha e seguirá para o check-in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                aria-label="Buscar paciente para atendimento espontâneo"
                value={walkinSearch}
                onChange={(event) => setWalkinSearch(event.target.value)}
                placeholder="Nome, CPF, telefone ou e-mail"
                onKeyDown={(event) => { if (event.key === "Enter") void searchWalkinPatients(); }}
              />
              <Button type="button" variant="outline" onClick={() => void searchWalkinPatients()} disabled={walkinBusy || walkinSearch.trim().length < 2}>
                Buscar
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Paciente</Label>
                <Select value={walkinPatientId} onValueChange={setWalkinPatientId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                  <SelectContent>{walkinPatients.map((patient) => <SelectItem key={patient.id} value={patient.id}>{patient.name} · {patient.cpf || "sem CPF"}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de atendimento</Label>
                <Select value={walkinTypeId} onValueChange={setWalkinTypeId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                  <SelectContent>{appointmentTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Profissional</Label>
                <Select value={walkinProfessionalId} onValueChange={setWalkinProfessionalId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o profissional" /></SelectTrigger>
                  <SelectContent>{professionals.map((professional) => <SelectItem key={professional.id} value={professional.id}>{professional.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Serviço</Label>
                <Select value={walkinServiceId} onValueChange={setWalkinServiceId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o serviço" /></SelectTrigger>
                  <SelectContent>{services.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="walkin-notes">Observação</Label>
              <Textarea id="walkin-notes" value={walkinNotes} onChange={(event) => setWalkinNotes(event.target.value)} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWalkinOpen(false)} disabled={walkinBusy}>Cancelar</Button>
            <Button type="button" onClick={() => void createWalkin()} disabled={walkinBusy || !walkinPatientId || !walkinTypeId || !walkinProfessionalId || !walkinServiceId}>
              {walkinBusy ? "Criando..." : "Criar atendimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(checkinReceipt)} onOpenChange={(open) => { if (!open) setCheckinReceipt(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Entrada concluída e conta aberta</DialogTitle>
            <DialogDescription>
              {checkinReceipt?.patientName} · Atendimento #{checkinReceipt?.appointmentId}
            </DialogDescription>
          </DialogHeader>
          {checkinReceipt && (
            <div className="space-y-4">
              <div className="rounded-md border border-success/30 bg-success/5 p-4">
                <p className="text-sm font-semibold">
                  {checkinReceipt.ticket ? `Senha ${checkinReceipt.ticket}` : "Paciente encaminhado para atendimento"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Conta {checkinReceipt.billingAccountId} · {checkinReceipt.totalGrossAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Próxima etapa</p>
                <p className="text-sm text-muted-foreground">
                  {checkinReceipt.billingType === "convenio"
                    ? "O atendimento alimentará esta conta. Após a execução e os documentos obrigatórios, o Faturamento confere a guia TISS, fecha a conta e prepara o envio ao convênio."
                    : "O atendimento está vinculado à conta particular. O Caixa deve confirmar Pix, cartão, dinheiro ou transferência antes de registrar a baixa."}
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setCheckinReceipt(null)}>Fechar</Button>
            <div className="flex flex-wrap gap-2">
              {checkinReceipt?.billingType === "convenio" && canOpenBilling && (
                <Button onClick={() => {
                  navigate(`/billing-accounts?account=${checkinReceipt.billingAccountId}&appointment=${checkinReceipt.appointmentId}`);
                  setCheckinReceipt(null);
                }}>
                  <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
                  Ver conta no faturamento
                </Button>
              )}
              {checkinReceipt?.billingType === "particular" && canOpenFinancial && (
                <Button onClick={() => {
                  const transaction = checkinReceipt.financialTransactionId
                    ? `&transaction=${checkinReceipt.financialTransactionId}`
                    : "";
                  navigate(`/financial?appointment=${checkinReceipt.appointmentId}${transaction}`);
                  setCheckinReceipt(null);
                }}>
                  <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
                  Abrir Caixa e recebimentos
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingTarget)} onOpenChange={(open) => { if (!open && !checkingIn) setPendingTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pendingTarget?.kind === "authorization" ? "Atualizar autorização" : "Atualizar elegibilidade"}</DialogTitle><DialogDescription>{pendingTarget?.patient_name} · Agendamento #{pendingTarget?.appointment_id || "-"}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Status</Label><Select value={pendingStatus} onValueChange={setPendingStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(pendingTarget?.kind === "authorization" ? AUTHORIZATION_STATUSES : ELIGIBILITY_STATUSES).map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Protocolo</Label><Input value={pendingProtocol} onChange={(event) => setPendingProtocol(event.target.value)} /></div>
            {pendingTarget?.kind === "authorization" && <><div className="grid grid-cols-2 gap-2"><div className="space-y-2"><Label>Número da autorização</Label><Input value={authorizationNumber} onChange={(event) => setAuthorizationNumber(event.target.value)} /></div><div className="space-y-2"><Label>Senha</Label><Input type="password" autoComplete="new-password" value={authorizationPassword} onChange={(event) => setAuthorizationPassword(event.target.value)} /></div></div><div className="space-y-2"><Label>Validade</Label><Input type="date" value={authorizationValidUntil} onChange={(event) => setAuthorizationValidUntil(event.target.value)} /></div></>}
            <div className="space-y-2">
              <Label>
                {pendingTarget?.kind === "eligibility"
                  && pendingStatus === "liberado_excecao"
                  ? "Justificativa da exceção"
                  : pendingTarget?.kind === "eligibility"
                    && pendingStatus === "bloqueado"
                    ? "Motivo do bloqueio"
                    : "Detalhe do resultado"}
              </Label>
              <Textarea value={pendingDetail} onChange={(event) => setPendingDetail(event.target.value)} />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPendingTarget(null)} disabled={checkingIn}>Cancelar</Button><Button onClick={() => void savePending()} disabled={checkingIn}>{checkingIn ? "Salvando..." : "Salvar atualização"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => { if (!open && queueUpdatingId === null) setTransferTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferir senha</DialogTitle><DialogDescription>{transferTarget ? `${formatReceptionQueueTicketLabel(transferTarget)} · selecione a unidade de destino` : "Selecione a unidade de destino"}</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Unidade de destino</Label><Select value={transferUnitId} onValueChange={setTransferUnitId}><SelectTrigger><SelectValue placeholder="Selecione uma unidade" /></SelectTrigger><SelectContent>{queueUnits.filter((unit) => Number(unit.id) !== Number(transferTarget?.unit_id)).map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name} ({unit.code})</SelectItem>)}</SelectContent></Select></div>
          <DialogFooter><Button variant="outline" onClick={() => setTransferTarget(null)} disabled={queueUpdatingId !== null}>Cancelar</Button><Button onClick={() => void transferQueue()} disabled={!transferUnitId || queueUpdatingId !== null}>{queueUpdatingId !== null ? "Transferindo..." : "Confirmar transferência"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {historyPatient && (
        <ReceptionPatientAppointmentsSheet
          open
          onOpenChange={(open) => {
            if (!open) setHistoryPatient(null);
          }}
          patientId={historyPatient.id}
          patientName={historyPatient.name}
        />
      )}
    </div>
  );
}

function StatusCard({ icon, label, count, color, bg }: { icon: React.ReactNode; label: string; count: number; color: string; bg: string }) {
  return (
    <Card className={bg}>
      <CardContent className="p-3 flex items-center gap-2">
        <div className={color}>{icon}</div>
        <div>
          <p className={`text-lg font-bold leading-tight ${color}`}>{count}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
